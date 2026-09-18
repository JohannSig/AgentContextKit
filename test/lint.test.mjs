import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanRepo, config, lint, makeRepo, put, run, shortLines } from './helpers.mjs';

const area = (body) => ({ 'svc/AGENTS.md': `# Svc\n\n${body}`, 'svc/CLAUDE.md': '@AGENTS.md\n' });

test('a minimal repo passes strict', () => {
  const r = lint(makeRepo(cleanRepo()), '--strict');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 error\(s\), 0 warning\(s\)/);
});

test('an area AGENTS.md over its token budget warns even when its line count is fine', () => {
  const repo = makeRepo({
    ...cleanRepo(), ...area(shortLines(220)),
    '.agents-context.json': config({ budgets: { areaAgentsLines: 1000 } }),
  });
  const r = lint(repo, '--strict');
  assert.equal(r.code, 1);
  assert.match(r.out, /svc\/AGENTS\.md.*areaAgentsTokens budget 3000/);
});

test('the root AGENTS.md has its own, smaller token budget', () => {
  const repo = makeRepo({ ...cleanRepo(), 'AGENTS.md': cleanRepo()['AGENTS.md'] + shortLines(140), '.agents-context.json': config({ budgets: { rootAgentsLines: 1000 } }) });
  assert.match(lint(repo).out, /AGENTS\.md.*rootAgentsTokens budget 2000/);
});

test('a single very long line is reported, a line just under the limit is not', () => {
  const long = lint(makeRepo({ ...cleanRepo(), ...area('x'.repeat(900) + '\n') }));
  assert.match(long.out, /1 line\(s\) over 800 chars \(longest 900, line 3\)/);
  const ok = lint(makeRepo({ ...cleanRepo(), ...area('x'.repeat(799) + '\n') }));
  assert.doesNotMatch(ok.out, /over 800 chars/);
});

test('docs are not linted unless docs.include is configured', () => {
  const repo = makeRepo({ ...cleanRepo(), 'docs/a.md': '# A\n\nsee [gone](missing.md)\n' });
  assert.equal(lint(repo, '--strict').code, 0);
});

test('docs pages: dead links are errors and oversize pages warn', () => {
  const repo = makeRepo({
    ...cleanRepo(),
    'docs/a.md': '# A\n\nsee [gone](missing.md)\n\n' + shortLines(30),
    '.agents-context.json': config({ docs: { include: ['docs/**/*.md'] }, budgets: { docsPageTokens: 100 } }),
  });
  const r = lint(repo);
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR docs\/a\.md: line 3: dead link 'missing\.md'/);
  assert.match(r.out, /WARN\s+docs\/a\.md: ~\d+ tokens, docsPageTokens budget 100/);
});

test('docs.exclude keeps historical pages out of the checks', () => {
  const repo = makeRepo({
    ...cleanRepo(),
    'docs/old/spec.md': '# Old\n\n[dead](nope.md)\n',
    '.agents-context.json': config({ docs: { include: ['docs/**/*.md'], exclude: ['docs/old/**'] } }),
  });
  assert.equal(lint(repo, '--strict').code, 0);
});

test('a page in a split directory that its index does not link is reported', () => {
  const cfg = { '.agents-context.json': config({ docs: { include: ['docs/**/*.md'] } }) };
  const partial = makeRepo({ ...cleanRepo(), ...cfg, 'docs/x.md': '# X\n\n[a](x/a.md)\n', 'docs/x/a.md': '# A\n', 'docs/x/b.md': '# B\n' });
  assert.match(lint(partial).out, /docs\/x\.md: does not link 'docs\/x\/b\.md'/);
  const full = makeRepo({ ...cleanRepo(), ...cfg, 'docs/x.md': '# X\n\n[a](x/a.md) [b](x/b.md)\n', 'docs/x/a.md': '# A\n', 'docs/x/b.md': '# B\n' });
  assert.equal(lint(full, '--strict').code, 0);
});

test('baseline: writing, then growth past the slack fails, growth within it does not', () => {
  const repo = makeRepo({ ...cleanRepo(), ...area(shortLines(40)) });
  const w = lint(repo, '--write-baseline');
  assert.equal(w.code, 0);
  const baseline = JSON.parse(readFileSync(join(repo, '.agents-context.baseline.json'), 'utf8'));
  assert.deepEqual(Object.keys(baseline.files), ['AGENTS.md', 'svc/AGENTS.md']); // shims are not tracked
  assert.equal(lint(repo, '--strict').code, 0);

  put(repo, area(shortLines(40) + 'one more line\n')); // a few tokens: inside the default 50-token slack
  assert.equal(lint(repo, '--strict').code, 0);

  put(repo, area(shortLines(80))); // ~600 tokens more
  const grown = lint(repo, '--strict');
  assert.equal(grown.code, 1);
  assert.match(grown.out, /svc\/AGENTS\.md: grew from ~\d+ to ~\d+ tokens/);

  assert.equal(lint(repo, '--write-baseline').code, 0); // deliberate re-baseline, visible in the diff
  assert.equal(lint(repo, '--strict').code, 0);
});

test('baseline: a new instruction file must be added to the baseline', () => {
  const repo = makeRepo(cleanRepo());
  lint(repo, '--write-baseline');
  put(repo, area('# tiny\n'));
  const r = lint(repo, '--strict');
  assert.equal(r.code, 1);
  assert.match(r.out, /svc\/AGENTS\.md: not in \.agents-context\.baseline\.json/);
});

test('without a baseline file the ratchet is off', () => {
  assert.equal(lint(makeRepo({ ...cleanRepo(), ...area(shortLines(40)) }), '--strict').code, 0);
});

test('init scaffolds the new budgets, docs linting and the where-new-knowledge-goes rule', () => {
  const repo = makeRepo({});
  const r = run('agents-init.mjs', [repo, '--name', 'Demo']);
  assert.equal(r.code, 0, r.out);
  const cfg = JSON.parse(readFileSync(join(repo, '.agents-context.json'), 'utf8'));
  assert.equal(cfg.budgets.areaAgentsTokens, 3000);
  assert.deepEqual(cfg.docs.include, ['docs/**/*.md']);
  assert.match(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), /Where new knowledge goes/);
});
