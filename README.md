# agent-context-kit

A repository- and tool-agnostic layout for AI coding-agent instruction files, built to spend as few tokens per session as possible. Works with Claude Code and Codex today; Cursor, Copilot and Gemini CLI are covered by one setting or one generated file each.

## The model: three tiers

| Tier | Loaded | Lives in | Budget |
|---|---|---|---|
| 1 Always | every session, every tool | `AGENTS.md` at repo root | 80 lines |
| 2 On touch | when an agent edits under a directory, or a file matching a glob | `<dir>/AGENTS.md`; `.claude/rules/*.md` with `paths:` | 150 / 100 lines |
| 3 On demand | only when the agent follows a link | `docs/*.md` | none |

Cost is not the sum of files. It is the **ancestor chain**: touching one file loads every tier-2 file from the root down to it, and they stay in context for the session. Keep the chain root → leaf under about 8k tokens. `agents-lint` prints the chain cost for every directory.

## Rules

1. **Links are pointers, not imports.** Never write `@path` in an instruction file. Claude Code expands it eagerly (4 hops); every other tool ignores it. The single exception is the shim below.
2. **Content lives in `AGENTS.md`.** `CLAUDE.md` is a one-line shim containing exactly `@AGENTS.md`. The root `CLAUDE.md` may add Claude-only extras (plugins, skills, hooks) under that line.
3. **Every nested `AGENTS.md` has a `CLAUDE.md` shim beside it.** Claude Code lazy-loads only files literally named `CLAUDE.md`.
4. **Tier 2 is for what an agent must know *whenever* it edits there.** "How to do X" (setup, adding a service, running a stack) is tier 3: put it in `docs/` and leave a one-line pointer.
5. **The root `AGENTS.md` tells agents to read the nearest `AGENTS.md` before editing.** Codex loads only the root-to-cwd chain at startup, so this line is what reaches nested guidance there.
6. **Cross-cutting concerns (tests, Dockerfiles, config files) are glob rules**, canonical in `.claude/rules/`. Generate other tools' formats from them; never hand-maintain two copies.

## Why: verified tool behaviour (2026-09-18)

| Tool | Loaded at start | Lazy on touch | Glob rules | Reads `AGENTS.md` |
|---|---|---|---|---|
| Claude Code | root `CLAUDE.md`, `~/.claude/CLAUDE.md`, `.claude/rules/*.md` without `paths:` | nested `CLAUDE.md` chain; rules with `paths:` | `.claude/rules/*.md`, `paths:` | no; shim needed |
| Codex | `AGENTS.md` chain root → cwd, 32 KiB cap, once | no | no | yes, nested |
| Cursor | `.cursor/rules/*.mdc` with `alwaysApply` | `globs:` rules; nested `AGENTS.md` | `.cursor/rules/*.mdc`, `globs:` | yes, nested |
| Copilot | `.github/copilot-instructions.md` | nearest `AGENTS.md` | `.github/instructions/*.instructions.md`, `applyTo:` (cloud agent + code review) | yes, nested; `CLAUDE.md` root only |
| Gemini CLI | `GEMINI.md` chain | yes | no | via `context.fileName` setting |

Two findings from testing inside Claude Code, started at the repo root:

- A nested `CLAUDE.md` containing `@AGENTS.md` **is** injected when a file in that directory is first read, and the import **is** expanded. The shim works.
- An `@path` import inside a `.claude/rules/*.md` file is **not** expanded, whether relative to the rule or to the repo. Rules must inline their content.

Sources: [Claude Code memory docs](https://code.claude.com/docs/en/memory.md), [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Cursor rules](https://cursor.com/docs/context/rules), [Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions).

## Layout

```
repo/
  AGENTS.md                 tier 1: identity, hard rules, map, commands
  CLAUDE.md                 "@AGENTS.md" + Claude-only extras
  .agents-context.json      lint budgets (optional)
  .claude/rules/tests.md    tier 2, glob-scoped (canonical)
  .cursor/rules/tests.mdc   generated, only if Cursor is used
  .github/instructions/…    generated, only if Copilot is used
  .gemini/settings.json     {"context":{"fileName":["AGENTS.md"]}}, only if Gemini is used
  docs/e2e-stack.md         tier 3: runbooks, reference
  src/api/
    AGENTS.md               tier 2, directory-scoped
    CLAUDE.md               "@AGENTS.md"
```

## Getting the kit

Clone once beside your repos, or run straight from GitHub via the `bin` entries in `package.json`:

```bash
git clone https://github.com/JohannSig/AgentContextKit ../agent-context-kit
# or, without cloning, from inside any repo:
npx -y -p github:JohannSig/AgentContextKit agents-lint .
```

Clone for migrations: lint runs many times, and an agent needs `MIGRATION.md` on disk.

## Scripts

Zero dependencies, Node 18+. Run from anywhere; pass the target repo root.

```bash
node scripts/agents-init.mjs <repo> --name "Repo"          # root AGENTS.md, CLAUDE.md, config
node scripts/agents-init.mjs <repo> --area src/api          # nested AGENTS.md + shim
node scripts/agents-init.mjs <repo> --rule tests            # glob rule skeleton
node scripts/agents-lint.mjs <repo> [--strict]              # budgets, imports, shims, dead links, chain cost
node scripts/agents-sync.mjs <repo> --cursor --copilot      # generate other formats; add --check in CI
```

`agents-init` never overwrites. `agents-lint` exits 1 on errors; `--strict` also fails on warnings. Put `agents-lint --strict` and `agents-sync --check` in CI once a repo is migrated.

`.agents-context.json` at the repo root (dropped by `agents-init`) tunes lint: `ignore` lists directory names to skip (defaults cover `node_modules`, `bin`, `obj`, `dist`), `budgets` sets line and chain limits. Raise `chainTokens` for deep monorepos, lower it for small libraries.

## Adopting in a new repo

1. `agents-init <repo> --name …`, fill in the root `AGENTS.md`: what the repo is, hard rules, a map table, build/test commands. Stop at 80 lines.
2. For each area an agent will edit, `agents-init --area <dir>` and write only what it must know whenever it edits there.
3. Anything procedural goes to `docs/<topic>.md` with a one-line pointer in the nearest `AGENTS.md`.
4. `agents-lint <repo>`; fix until clean.
5. Only if a second tool is in use: `agents-sync` for Cursor/Copilot, or copy `templates/gemini-settings.json`.

## Applying to a repo that already has `CLAUDE.md` files

On a branch, never `main`:

1. `agents-lint .` and keep the chain table as the before snapshot.
2. `agents-init . --name "<Repo>"` to add whatever is missing; existing files are left alone.
3. Split and classify sections. This is editorial; let a coding agent do it with the recipe as its brief (prompt in [MIGRATION.md](MIGRATION.md#3-split)).
4. Rename and shim: `git mv <dir>/CLAUDE.md <dir>/AGENTS.md`, then write `@AGENTS.md` into a new `<dir>/CLAUDE.md`.
5. `agents-lint . --strict` clean, then verify in a fresh session as described in [MIGRATION.md](MIGRATION.md#5-verify).
6. Add the strict lint (and `agents-sync --check` if Cursor/Copilot are used) to CI.

Full recipe with the classification table: [MIGRATION.md](MIGRATION.md).
