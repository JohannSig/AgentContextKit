import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

/** Create a throwaway repo directory from {relativePath: content}. */
export function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-kit-test-'));
  put(dir, files);
  return dir;
}
export function put(dir, files) {
  for (const [p, c] of Object.entries(files)) {
    const f = join(dir, p);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, c);
  }
}

export function run(script, args, opts = {}) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8', ...opts });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
export const lint = (repo, ...args) => run('agents-lint.mjs', [repo, ...args]);

export function git(dir, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** A minimal repo that passes `agents-lint --strict`. */
export const cleanRepo = () => ({
  'AGENTS.md': '# Repo\n\nBefore editing under a directory, read the nearest `AGENTS.md` at or above it.\n',
  'CLAUDE.md': '@AGENTS.md\n',
});

/** n short lines (~60 bytes each) so token budgets trip without tripping line-length checks. */
export const shortLines = (n) => Array.from({ length: n }, (_, i) => `line ${i} lorem ipsum dolor sit amet consectetur adipiscing`).join('\n') + '\n';

export const config = (o) => JSON.stringify(o);
