// Shared helpers for the agent-context kit. Zero dependencies. Node 18+.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';

export const DEFAULT_CONFIG = {
  budgets: {
    // Lines are a readability check only: one 2000-char line costs as much as twenty short ones, so
    // the token budgets below are what actually bound what an agent pays.
    rootAgentsLines: 80,
    areaAgentsLines: 150,
    ruleLines: 100,
    rootClaudeLines: 40,
    rootAgentsTokens: 2000,
    areaAgentsTokens: 3000,
    ruleTokens: 1500,
    maxLineChars: 800,
    docsPageTokens: 4000,
    baselineSlackTokens: 50,
    chainTokens: 8000,
    codexChainBytes: 32768,
  },
  ignore: ['node_modules', '.git', 'dist', 'build', 'bin', 'obj', '.anvil-worktrees'],
  // docs/ linting is opt-in: list glob patterns (relative to the repo root) for the pages you manage.
  docs: { include: [], exclude: [] },
  // Growth ratchet: written by `agents-lint --write-baseline`, checked whenever the file exists.
  baselineFile: '.agents-context.baseline.json',
};

export const SHIM = '@AGENTS.md';

export function loadConfig(root) {
  const p = join(root, '.agents-context.json');
  if (!existsSync(p)) return DEFAULT_CONFIG;
  const user = JSON.parse(readFileSync(p, 'utf8'));
  return {
    budgets: { ...DEFAULT_CONFIG.budgets, ...(user.budgets ?? {}) },
    ignore: user.ignore ?? DEFAULT_CONFIG.ignore,
    docs: { ...DEFAULT_CONFIG.docs, ...(user.docs ?? {}) },
    baselineFile: user.baselineFile ?? DEFAULT_CONFIG.baselineFile,
  };
}

export const posix = (p) => p.split(sep).join('/');
export const rel = (root, p) => posix(relative(root, p)) || '.';
export const tokens = (bytes) => Math.round(bytes / 4);
export const read = (p) => readFileSync(p, 'utf8');
export const lines = (s) => s.split(/\r?\n/).filter((l, i, a) => !(i === a.length - 1 && l === '')).length;

/** Glob (`*`, `**`, `?`) to RegExp over posix relative paths. `**` also matches across `/`. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
export const matchesAny = (patterns, relPath) => patterns.some((g) => globToRegExp(g).test(relPath));

/** Walk the tree, skipping ignored dir names. Yields absolute file paths. */
export function* walk(dir, ignore) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (ignore.includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, ignore);
    else if (e.isFile()) yield p;
  }
}

/** Strip fenced code blocks and inline code spans so their contents are not scanned. */
export function stripCode(md) {
  return md.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '').replace(/`[^`\n]*`/g, '');
}

/** Find `@path` import tokens (Claude Code semantics) outside code. Returns [{line, token}]. */
export function findImports(md) {
  const out = [];
  const src = stripCode(md).split(/\r?\n/);
  const re = /(?:^|[\s(])@((?:\.{1,2}|~)?\/[^\s)]+|[^\s)@]*\/[^\s)]+|[^\s)@]+\.md)/g;
  src.forEach((l, i) => {
    for (const m of l.matchAll(re)) out.push({ line: i + 1, token: '@' + m[1] });
  });
  return out;
}

/** Parse the minimal YAML frontmatter used by rule files. Returns {paths, hasFrontmatter, body, raw}. */
export function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { paths: null, hasFrontmatter: false, body: md, raw: '' };
  const raw = m[1];
  let paths = null;
  const inline = raw.match(/^paths:\s*\[(.*)\]\s*$/m);
  if (inline) {
    paths = inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  } else if (/^paths:\s*$/m.test(raw)) {
    paths = [];
    const after = raw.split(/^paths:\s*$/m)[1] ?? '';
    for (const l of after.split(/\r?\n/)) {
      const it = l.match(/^\s*-\s*(.+?)\s*$/);
      if (it) paths.push(it[1].replace(/^["']|["']$/g, ''));
      else if (l.trim() && !/^\s/.test(l)) break; // next top-level key
    }
  }
  return { paths, hasFrontmatter: true, body: m[2], raw };
}

/** Markdown links to local files: [{line, target}] with anchors/line suffixes stripped. */
export function findLocalLinks(md) {
  const out = [];
  stripCode(md).split(/\r?\n/).forEach((l, i) => {
    for (const m of l.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      let t = m[1];
      if (/^(https?:|mailto:|#)/i.test(t)) continue;
      t = t.replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '');
      if (t) out.push({ line: i + 1, target: t });
    }
  });
  return out;
}

export function fileSize(p) { return statSync(p).size; }
export { existsSync, join, resolve };
