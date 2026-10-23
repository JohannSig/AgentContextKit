// Checks that catch instruction-file rot that the budgets alone do not: copies of the repo being scanned, rules that never load, docs nobody can find,
// unfilled template placeholders, change-log sections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRepo, config, lint, makeRepo, run } from './helpers.mjs';

test('copies of the repo under .claude/worktrees are not scanned, and a path entry in ignore skips just that path', () => {
  const copy = {
    '.claude/worktrees/w1/AGENTS.md': cleanRepo()['AGENTS.md'], '.claude/worktrees/w1/CLAUDE.md': '@AGENTS.md\n',
    '.claude/worktrees/w1/svc/AGENTS.md': '# s\n', '.claude/worktrees/w1/svc/CLAUDE.md': '@AGENTS.md\n',
  };
  const r = lint(makeRepo({ ...cleanRepo(), ...copy }), '--strict');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /AGENTS\.md: 1 /);
  const vendor = { 'vendor/old/AGENTS.md': '# <Old>\n', 'vendor/new/AGENTS.md': '# New\n', 'vendor/new/CLAUDE.md': '@AGENTS.md\n' };
  const skipped = lint(makeRepo({ ...cleanRepo(), ...vendor, '.agents-context.json': config({ ignore: ['vendor/old'] }) }), '--strict');
  assert.equal(skipped.code, 0, skipped.out);
  assert.match(skipped.out, /AGENTS\.md: 2 /);
  assert.equal(lint(makeRepo({ ...cleanRepo(), ...vendor }), '--strict').code, 1);
});

test('a rule whose paths: patterns match no file is reported (it would silently never load)', () => {
  const rule = (glob) => `---\npaths:\n  - "${glob}"\n---\n# T\n\n- x\n`;
  const files = { ...cleanRepo(), 'src/a.test.ts': '', 'test/b.test.ts': '' };
  assert.equal(lint(makeRepo({ ...files, '.claude/rules/t.md': rule('**/*.test.ts') }), '--strict').code, 0);
  assert.equal(lint(makeRepo({ ...files, '.claude/rules/t.md': rule('src/*.test.ts') }), '--strict').code, 0);
  const bad = lint(makeRepo({ ...files, '.claude/rules/t.md': rule('srcs/**/*.ts') }), '--strict');
  assert.equal(bad.code, 1);
  assert.match(bad.out, /\.claude\/rules\/t\.md: 'paths:' pattern 'srcs\/\*\*\/\*\.ts' matches no file/);
});

test('a docs page that no instruction file links to, directly or through other pages, is reported', () => {
  const cfg = { '.agents-context.json': config({ docs: { include: ['docs/**/*.md'] } }) };
  const lost = lint(makeRepo({ ...cleanRepo(), ...cfg, 'docs/lost.md': '# Lost\n' }), '--strict');
  assert.equal(lost.code, 1);
  assert.match(lost.out, /docs\/lost\.md: not linked from any AGENTS\.md/);
  const linked = makeRepo({
    ...cleanRepo(), 'AGENTS.md': cleanRepo()['AGENTS.md'] + '\nSee [index](docs/README.md).\n', ...cfg,
    'docs/README.md': '# Index\n\n[a](a.md)\n', 'docs/a.md': '# A\n\n[b](deep/b.md)\n', 'docs/deep/b.md': '# B\n',
  });
  assert.equal(lint(linked, '--strict').code, 0, lint(linked).out);
  const viaRule = makeRepo({ ...cleanRepo(), ...cfg, 'src/x.ts': '', '.claude/rules/r.md': '---\npaths: ["src/*.ts"]\n---\n# R\n\nsee [a](../../docs/a.md)\n', 'docs/a.md': '# A\n' });
  assert.equal(lint(viaRule, '--strict').code, 0, lint(viaRule).out);
});

test('unfilled template placeholders are reported; code, HTML tags and prose are not', () => {
  const area = (body) => ({ ...cleanRepo(), 'svc/AGENTS.md': body, 'svc/CLAUDE.md': '@AGENTS.md\n' });
  const bad = lint(makeRepo(area('# <Area name>\n\n- <Convention an agent would otherwise get wrong.>\n\n| <path> | x |\n')), '--strict');
  assert.equal(bad.code, 1);
  assert.match(bad.out, /svc\/AGENTS\.md: 3 template placeholder\(s\) not filled in, first at line 1: <Area name>/);
  const ok = lint(makeRepo(area('# Svc\n\nUse `Map<string, number>` and write a<b when c>d. Line break:<br>\n\n```\n<build>\n<test>\n```\n\n<br>\n<details>\n')), '--strict');
  assert.equal(ok.code, 0, ok.out);
  const fresh = makeRepo({});
  run('agents-init.mjs', [fresh, '--name', 'Demo']);
  assert.match(lint(fresh).out, /AGENTS\.md: \d+ template placeholder\(s\) not filled in/);
});

test('a change-log or history heading in an instruction file is reported', () => {
  const bad = lint(makeRepo({ ...cleanRepo(), 'AGENTS.md': cleanRepo()['AGENTS.md'] + '\n## Changelog\n\n- did a thing\n' }), '--strict');
  assert.equal(bad.code, 1);
  assert.match(bad.out, /AGENTS\.md: line \d+: 'Changelog' reads like a change log/);
  assert.equal(lint(makeRepo({ ...cleanRepo(), 'AGENTS.md': cleanRepo()['AGENTS.md'] + '\n## Release process\n\nsteps\n' }), '--strict').code, 0);
});
