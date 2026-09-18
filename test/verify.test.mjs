import { test } from 'node:test';
import assert from 'node:assert/strict';
import { git, makeRepo, put, run } from './helpers.mjs';

const P1 = 'Rule one: always run the migrations tool before the seed step, in that order.';
const P2 = 'Reference detail: the controller table lists every route, its auth and its rate limit policy.';
const cfg = { '.agents-context.json': JSON.stringify({ docs: { include: ['docs/**/*.md'] } }) };

function committedRepo() {
  const repo = makeRepo({ ...cfg, 'AGENTS.md': `# R\n\n${P1}\n\n${P2}\n`, 'CLAUDE.md': '@AGENTS.md\n' });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  return repo;
}
const verify = (repo, ...a) => run('agents-verify.mjs', [repo, ...a]);

test('text moved into docs/ (with a rebased link and reflowed whitespace) is accounted for', () => {
  const repo = committedRepo();
  put(repo, {
    'AGENTS.md': `# R\n\n${P1}\n\nSee [docs/ref.md](docs/ref.md).\n`,
    'docs/ref.md': `# Ref\n\n${P2.replace(', its auth', ',\nits auth')}\n`,
  });
  const r = verify(repo);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 not found/);
});

test('a deleted paragraph is reported and fails', () => {
  const repo = committedRepo();
  put(repo, { 'AGENTS.md': `# R\n\n${P1}\n` });
  const r = verify(repo);
  assert.equal(r.code, 1);
  assert.match(r.out, /MISSING \[AGENTS\.md\] Reference detail: the controller table/);
});

test('--base compares against an earlier ref, not just HEAD', () => {
  const repo = committedRepo();
  put(repo, { 'AGENTS.md': `# R\n\n${P1}\n` });
  git(repo, 'commit', '-q', '-am', 'drop P2');
  assert.equal(verify(repo).code, 0); // HEAD already has the trimmed text
  assert.equal(verify(repo, '--base', 'HEAD~1').code, 1); // but the original is missing P2
});
