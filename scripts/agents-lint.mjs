#!/usr/bin/env node
// agents-lint.mjs — validate an agent-context layout (AGENTS.md + CLAUDE.md shims + .claude/rules).
// Usage: node agents-lint.mjs [repoRoot] [--strict] [--quiet] [--write-baseline]
// Exit 1 on errors (or on warnings with --strict). --write-baseline records the current size of every
// instruction file in the baseline file (see README "Guardrails") and exits 0.
import { writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  loadConfig, walk, read, lines, tokens, rel, SHIM, findImports, findLocalLinks,
  parseFrontmatter, existsSync, fileSize, matchesAny,
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

const agents = [], claudes = [], rules = [], docsFiles = [];
for (const p of walk(root, cfg.ignore)) {
  const name = basename(p);
  const r = rel(root, p);
  if (name === 'AGENTS.md') agents.push(p);
  else if (name === 'CLAUDE.md') claudes.push(p);
  else if (/^(?:.*\/)?\.claude\/rules\/.+\.md$/.test(r)) rules.push(p);
  else if (r.endsWith('.md') && matchesAny(cfg.docs.include, r) && !matchesAny(cfg.docs.exclude, r)) docsFiles.push(p);
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

// A line budget alone does not bound cost (one 2000-char line = twenty short ones), so files are
// also held to a token budget and long lines are reported.
const tokenBudget = (p, t, limit, name) => {
  if (t > limit) warn(p, `~${t} tokens, ${name} budget ${limit}. Move task-specific sections to docs/ and link them.`);
};
const longLines = (p, c) => {
  const over = [];
  c.split(/\r?\n/).forEach((l, i) => { if (l.length > B.maxLineChars) over.push({ line: i + 1, len: l.length }); });
  if (!over.length) return;
  const worst = over.reduce((a, b) => (b.len > a.len ? b : a));
  warn(p, `${over.length} line(s) over ${B.maxLineChars} chars (longest ${worst.len}, line ${worst.line}). Long paragraphs hide their cost from line budgets: split them or move the detail to docs/.`);
};

// --- AGENTS.md checks ---------------------------------------------------------
for (const p of agents) {
  const c = read(p);
  const n = lines(c);
  const budget = isRoot(p) ? B.rootAgentsLines : B.areaAgentsLines;
  if (n > budget) warn(p, `${n} lines, budget ${budget}. Move task-specific sections to docs/ and link them.`);
  tokenBudget(p, tokens(fileSize(p)), isRoot(p) ? B.rootAgentsTokens : B.areaAgentsTokens, isRoot(p) ? 'rootAgentsTokens' : 'areaAgentsTokens');
  longLines(p, c);
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
  tokenBudget(p, tokens(Buffer.byteLength(fm.body)), B.ruleTokens, 'ruleTokens');
  longLines(p, fm.body);
  for (const { line, token } of findImports(fm.body)) err(p, `line ${line}: '${token}' — @imports inside rules are NOT expanded by Claude Code (verified 2026-09). Inline the content or link it.`);
  checkLinks(p, fm.body);
}

// --- docs/ checks (opt-in: "docs.include" in .agents-context.json) ---------------
for (const p of docsFiles) {
  const t = tokens(fileSize(p));
  if (t > B.docsPageTokens) warn(p, `~${t} tokens, docsPageTokens budget ${B.docsPageTokens}. Split it into per-topic pages behind an index.`);
  checkLinks(p, read(p));
}
// A split directory `docs/x/` must be fully listed in its index `docs/x.md`, or pages go stale unseen.
for (const idx of docsFiles) {
  const pages = docsFiles.filter((f) => dirname(f) === idx.replace(/\.md$/, ''));
  if (!pages.length) continue;
  const linked = new Set(findLocalLinks(read(idx)).map((l) => resolve(dirname(idx), l.target)));
  for (const pg of pages) if (!linked.has(pg)) warn(idx, `does not link '${rel(root, pg)}'. Every page in a split directory must be listed in its index.`);
}

// --- Growth baseline ----------------------------------------------------------
// Instruction files may not grow past their recorded size without the PR also updating the baseline,
// which makes the growth a visible, reviewed line in the diff instead of a silent drift.
const tracked = [...agents, ...claudes.filter((p) => !isShim(read(p))), ...rules];
const sizes = Object.fromEntries(tracked.map((p) => [rel(root, p), tokens(fileSize(p))]).sort(([a], [b]) => (a < b ? -1 : 1)));
const baselinePath = join(root, cfg.baselineFile);
if (args.includes('--write-baseline')) {
  const note = 'Written by agents-lint --write-baseline. An instruction file growing past its size here (plus slack) fails the lint; raise it deliberately in the PR that needs it.';
  writeFileSync(baselinePath, JSON.stringify({ note, files: sizes }, null, 2) + '\n');
  console.log(`wrote ${cfg.baselineFile} (${Object.keys(sizes).length} files)`);
  process.exit(0);
}
if (existsSync(baselinePath)) {
  const base = JSON.parse(read(baselinePath)).files ?? {};
  for (const [f, t] of Object.entries(sizes)) {
    if (!(f in base)) warn(join(root, f), `not in ${cfg.baselineFile}. New instruction file: run agents-lint --write-baseline and commit it so the addition is reviewed.`);
    else if (t > base[f] + B.baselineSlackTokens) warn(join(root, f), `grew from ~${base[f]} to ~${t} tokens (+${t - base[f]}). If that is intended, run agents-lint --write-baseline and commit the baseline so the growth is reviewed; otherwise move detail to docs/.`);
  }
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
  console.log(`  AGENTS.md: ${agents.length}   CLAUDE.md: ${claudes.length}   rules: ${rules.length}   docs pages: ${docsFiles.length}\n`);
  const biggest = Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (biggest.length) console.log('  Largest instruction files (~tokens): ' + biggest.map(([f, t]) => `${f} ${t}`).join(', ') + '\n');
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
