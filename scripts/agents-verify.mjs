#!/usr/bin/env node
// agents-verify.mjs — prove a restructure lost no text. Every paragraph of every instruction file
// (AGENTS.md, CLAUDE.md, .claude/rules, managed docs pages) as of --base (default HEAD) must still
// appear somewhere in the current instruction files or docs pages. Run it after splitting or
// trimming; anything it reports was deleted or reworded, so either restore it or accept the loss.
// Usage: node agents-verify.mjs [repoRoot] [--base <git-ref>]
// Exit 1 if any paragraph is missing. Link targets are ignored so moved text with rebased links passes.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadConfig, walk, read, rel, matchesAny, SHIM } from './lib.mjs';

const args = process.argv.slice(2);
let root = '.', base = 'HEAD';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') base = args[++i];
  else if (!args[i].startsWith('--')) root = args[i];
}
root = resolve(root);
const cfg = loadConfig(root);
const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const tracked = (r) =>
  /(^|\/)(AGENTS|CLAUDE)\.md$/.test(r) || /(^|\/)\.claude\/rules\/.+\.md$/.test(r) ||
  (r.endsWith('.md') && matchesAny(cfg.docs.include, r) && !matchesAny(cfg.docs.exclude, r));
const ignored = (r) => r.split('/').some((seg) => cfg.ignore.includes(seg));
const norm = (s) => s.replace(/\r\n/g, '\n').replace(/\]\([^)]*\)/g, ']()').replace(/\\\|/g, '|').replace(/\s+/g, ' ').trim();

let corpus = '';
for (const p of walk(root, cfg.ignore)) if (tracked(rel(root, p))) corpus += '\n' + read(p);
corpus = norm(corpus);

const before = git('ls-tree', '-r', '-z', '--name-only', base).split('\0').filter((r) => r && tracked(r) && !ignored(r));
let checked = 0;
const missing = [];
for (const f of before) {
  for (const para of git('show', `${base}:${f}`).replace(/\r\n/g, '\n').split(/\n\n+/)) {
    const p = para.trim();
    // Skip what carries no prose: shims, lone headings, table rows, code fences, frontmatter.
    if (!p || p === SHIM || (/^#{1,6} /.test(p) && !p.includes('\n')) || p.startsWith('|') || p.startsWith('```') || /^---\n[\s\S]*\n---$/.test(p)) continue;
    checked++;
    if (!corpus.includes(norm(p))) missing.push({ file: f, text: norm(p).slice(0, 110) });
  }
}

for (const m of missing) console.log(`MISSING [${m.file}] ${m.text}`);
console.log(`\n${checked} paragraph(s) checked against ${base}, ${missing.length} not found`);
process.exit(missing.length ? 1 : 0);
