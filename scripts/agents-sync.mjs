#!/usr/bin/env node
// agents-sync.mjs — generate tool-specific glob-scoped rule files from the canonical .claude/rules/*.md.
// Usage: node agents-sync.mjs [repoRoot] --cursor --copilot [--check]
//   --cursor   emit .cursor/rules/<name>.mdc            (frontmatter: description, globs, alwaysApply)
//   --copilot  emit .github/instructions/<name>.instructions.md (frontmatter: applyTo)
//   --check    do not write; exit 1 if any generated file is missing or differs
// Codex has no glob-scoped rules; the root AGENTS.md pointer line covers it.
import { basename, dirname, join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig, walk, read, rel, parseFrontmatter, existsSync } from './lib.mjs';

const args = process.argv.slice(2);
const root = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const want = { cursor: args.includes('--cursor'), copilot: args.includes('--copilot') };
const check = args.includes('--check');
if (!want.cursor && !want.copilot) {
  console.error('nothing to do: pass --cursor and/or --copilot');
  process.exit(2);
}
const cfg = loadConfig(root);
const HEADER = (src) => `<!-- GENERATED from ${src} by agents-sync.mjs — edit the source, not this file. -->\n`;

const rules = [...walk(root, cfg.ignore)].filter((p) => /^\.claude\/rules\/.+\.md$/.test(rel(root, p)));
if (!rules.length) console.log('no rules found under .claude/rules/');

let drift = 0;
const emit = (target, content) => {
  const r = rel(root, target);
  if (check) {
    if (!existsSync(target)) { console.log(`MISSING ${r}`); drift++; }
    else if (read(target) !== content) { console.log(`DRIFT   ${r}`); drift++; }
    else console.log(`ok      ${r}`);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`wrote   ${r}`);
};

for (const p of rules) {
  const src = rel(root, p);
  const name = basename(p, '.md');
  const fm = parseFrontmatter(read(p));
  const body = fm.body.replace(/^\s+/, '');
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name;
  const globs = fm.paths?.length ? fm.paths : null;

  if (want.cursor) {
    const front = globs
      ? `---\ndescription: ${JSON.stringify(title)}\nglobs: ${globs.join(',')}\nalwaysApply: false\n---\n`
      : `---\ndescription: ${JSON.stringify(title)}\nalwaysApply: true\n---\n`;
    emit(join(root, '.cursor', 'rules', `${name}.mdc`), front + HEADER(src) + body);
  }
  if (want.copilot) {
    const front = `---\napplyTo: ${JSON.stringify(globs ? globs.join(',') : '**')}\n---\n`;
    emit(join(root, '.github', 'instructions', `${name}.instructions.md`), front + HEADER(src) + body);
  }
}
if (check && drift) { console.log(`\n${drift} file(s) out of sync — run without --check to regenerate.`); process.exit(1); }
