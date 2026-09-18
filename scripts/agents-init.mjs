#!/usr/bin/env node
// agents-init.mjs — scaffold the agent-context layout into a repository. Never overwrites.
// Usage:
//   node agents-init.mjs <repoRoot> [--name "Repo name"] [--gemini]   scaffold root files
//   node agents-init.mjs <repoRoot> --area <relative/dir> [--name "Area"] add a nested AGENTS.md + CLAUDE.md shim
//   node agents-init.mjs <repoRoot> --rule <name>                    add a path-scoped rule skeleton
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { read, existsSync } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const T = join(here, '..', 'templates');
const args = process.argv.slice(2);
const root = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const opt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const area = opt('--area');
const rule = opt('--rule');
const name = opt('--name');

const put = (target, content) => {
  if (existsSync(target)) { console.log(`skip    ${target} (exists)`); return; }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`created ${target}`);
};
const tpl = (file, subs = {}) => Object.entries(subs).reduce((s, [k, v]) => s.replaceAll(k, v), read(join(T, file)));

if (area) {
  const dir = join(root, area);
  put(join(dir, 'AGENTS.md'), tpl('AGENTS.area.md', { '<Area name>': name ?? basename(dir) }));
  put(join(dir, 'CLAUDE.md'), read(join(T, 'CLAUDE.shim.md')));
} else if (rule) {
  put(join(root, '.claude', 'rules', `${rule}.md`), tpl('rule.md', { '<Rule name>': name ?? rule }));
} else {
  put(join(root, 'AGENTS.md'), tpl('AGENTS.root.md', { '<Repo name>': name ?? basename(root) }));
  put(join(root, 'CLAUDE.md'), read(join(T, 'CLAUDE.root.md')));
  put(join(root, '.agents-context.json'), read(join(T, 'agents-context.json')));
  if (args.includes('--gemini')) put(join(root, '.gemini', 'settings.json'), read(join(T, 'gemini-settings.json')));
  console.log('\nnext: fill in AGENTS.md, then add areas with --area <dir> and run agents-lint.mjs');
}
