#!/usr/bin/env node
// agents-lint.mjs — validate an agent-context layout (AGENTS.md + CLAUDE.md shims + .claude/rules).
// Usage: node agents-lint.mjs [repoRoot] [--strict] [--quiet]
// Exit 1 on errors (or on warnings with --strict).
import { basename, dirname, join, resolve } from 'node:path';
import {
  loadConfig, walk, read, lines, tokens, rel, SHIM, findImports, findLocalLinks,
  parseFrontmatter, existsSync, fileSize,
} from './lib.mjs';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const quiet = args.includes('--quiet');
const root = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const cfg = loadConfig(root);
const B = cfg.budgets;
const issues = [];
const err = (file, msg) => issues.push({ level: 'error', file: rel(root, file), msg });
const warn = (file, msg) => issues.push({ level: 'warn', file: rel(root, file), msg });

const agents = [], claudes = [], rules = [];
for (const p of walk(root, cfg.ignore)) {
  const name = basename(p);
  const r = rel(root, p);
  if (name === 'AGENTS.md') agents.push(p);
  else if (name === 'CLAUDE.md') claudes.push(p);
  else if (/^(?:.*\/)?\.claude\/rules\/.+\.md$/.test(r)) rules.push(p);
}

const isRoot = (p) => dirname(p) === root;
const isShim = (content) => content.trim() === SHIM;
const checkLinks = (p, c) => {
  for (const { line, target } of findLocalLinks(c)) {
    if (/[<>]/.test(target)) { warn(p, `line ${line}: template placeholder '${target}' not filled in.`); continue; }
    const abs = target.startsWith('/') ? join(root, target) : join(dirname(p), target);
    if (!existsSync(abs)) err(p, `line ${line}: dead link '${target}'.`);
  }
};

// --- AGENTS.md checks ---------------------------------------------------------
for (const p of agents) {
  const c = read(p);
  const n = lines(c);
  const budget = isRoot(p) ? B.rootAgentsLines : B.areaAgentsLines;
  if (n > budget) warn(p, `${n} lines, budget ${budget}. Move task-specific sections to docs/ and link them.`);
  for (const { line, token } of findImports(c)) err(p, `line ${line}: '${token}' looks like an @import. Use a plain link; imports load eagerly in Claude Code and are ignored by other tools.`);
  checkLinks(p, c);
  if (!isRoot(p)) {
    const shim = join(dirname(p), 'CLAUDE.md');
    if (!existsSync(shim)) err(p, `no CLAUDE.md shim beside it; Claude Code will not load this file. Create CLAUDE.md containing exactly '${SHIM}'.`);
  } else if (!/nearest\s+`?AGENTS\.md`?/i.test(c)) {
    warn(p, `root AGENTS.md should tell agents to read the nearest AGENTS.md before editing (Codex does not lazy-load nested files).`);
  }
}
if (!agents.some(isRoot)) {
  if (claudes.some(isRoot)) warn(join(root, 'AGENTS.md'), `missing. Root CLAUDE.md exists — legacy Claude-only layout. See MIGRATION.md.`);
  else err(join(root, 'AGENTS.md'), `missing. Run agents-init.mjs.`);
}

// --- CLAUDE.md checks ---------------------------------------------------------
for (const p of claudes) {
  const c = read(p);
  const sibling = join(dirname(p), 'AGENTS.md');
  if (isRoot(p)) {
    if (existsSync(sibling)) {
      const first = c.split(/\r?\n/).find((l) => l.trim() !== '');
      if (first?.trim() !== SHIM) err(p, `first non-empty line must be '${SHIM}' so shared guidance is loaded.`);
      const n = lines(c);
      if (n > B.rootClaudeLines) warn(p, `${n} lines, budget ${B.rootClaudeLines}. Only Claude-specific extras belong here.`);
      for (const { line, token } of findImports(c).filter((i) => i.token !== SHIM)) err(p, `line ${line}: extra @import '${token}'. Only '${SHIM}' is allowed.`);
      checkLinks(p, c);
    }
    continue;
  }
  if (existsSync(sibling)) {
    if (!isShim(c)) err(p, `must contain exactly '${SHIM}' when AGENTS.md exists beside it; move content into AGENTS.md.`);
  } else {
    warn(p, `legacy nested CLAUDE.md (${lines(c)} lines, ~${tokens(fileSize(p))} tok) with no AGENTS.md. Rename to AGENTS.md and add a shim. See MIGRATION.md.`);
    for (const { line, token } of findImports(c)) err(p, `line ${line}: '${token}' looks like an @import.`);
    checkLinks(p, c);
  }
}

// --- .claude/rules checks -----------------------------------------------------
for (const p of rules) {
  const c = read(p);
  const fm = parseFrontmatter(c);
  if (!fm.hasFrontmatter || fm.paths === null) warn(p, `no 'paths:' frontmatter — this rule is loaded at every session start. Intentional?`);
  else if (fm.paths.length === 0) err(p, `'paths:' is empty.`);
  const n = lines(fm.body);
  if (n > B.ruleLines) warn(p, `${n} lines, budget ${B.ruleLines}.`);
  for (const { line, token } of findImports(fm.body)) err(p, `line ${line}: '${token}' — @imports inside rules are NOT expanded by Claude Code (verified 2026-09). Inline the content or link it.`);
  checkLinks(p, fm.body);
}

// --- Chain cost report --------------------------------------------------------
// For every directory holding a content file, sum every content file on the path from root.
// Content file = AGENTS.md if present, else a non-shim CLAUDE.md (legacy).
const contentDirs = new Map(); // dir -> {bytes, agentsBytes}
for (const p of agents) contentDirs.set(dirname(p), { bytes: fileSize(p), agentsBytes: fileSize(p) });
for (const p of claudes) {
  const d = dirname(p);
  if (contentDirs.has(d) || isShim(read(p))) continue;
  contentDirs.set(d, { bytes: fileSize(p), agentsBytes: 0 });
}
const rows = [];
for (const [d] of contentDirs) {
  let cur = d, total = 0, codex = 0, depth = 0;
  for (;;) {
    const e = contentDirs.get(cur);
    if (e) { total += e.bytes; codex += e.agentsBytes; depth++; }
    if (cur === root) break;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  rows.push({ dir: rel(root, d), files: depth, tokens: tokens(total) });
  if (tokens(total) > B.chainTokens) warn(join(d, 'AGENTS.md'), `chain to here costs ~${tokens(total)} tokens (${depth} files), budget ${B.chainTokens}. Slim the ancestors or move sections to docs/.`);
  if (codex > B.codexChainBytes) warn(join(d, 'AGENTS.md'), `AGENTS.md chain is ${codex} bytes; Codex stops loading at ${B.codexChainBytes}.`);
}

// --- Output -------------------------------------------------------------------
if (!quiet) {
  console.log(`agent-context lint — ${root}`);
  console.log(`  AGENTS.md: ${agents.length}   CLAUDE.md: ${claudes.length}   rules: ${rules.length}\n`);
  if (rows.length) {
    console.log('  Ancestor-chain cost when an agent first touches a file under:');
    const w = Math.max(9, ...rows.map((r) => r.dir.length));
    console.log(`  ${'directory'.padEnd(w)}  files  ~tokens`);
    for (const r of rows.sort((a, b) => b.tokens - a.tokens)) console.log(`  ${r.dir.padEnd(w)}  ${String(r.files).padStart(5)}  ${String(r.tokens).padStart(7)}`);
    console.log('');
  }
}
const errors = issues.filter((i) => i.level === 'error');
const warns = issues.filter((i) => i.level === 'warn');
for (const i of issues) console.log(`${i.level === 'error' ? 'ERROR' : 'WARN '} ${i.file}: ${i.msg}`);
console.log(`\n${errors.length} error(s), ${warns.length} warning(s)`);
process.exit(errors.length || (strict && warns.length) ? 1 : 0);
