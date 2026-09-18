# Migrating an existing `CLAUDE.md` tree

For a repo that already has a root `CLAUDE.md` and nested `CLAUDE.md` files. History is preserved with `git mv`; behaviour in Claude Code is unchanged until step 4, so this can land in one PR or several.

## 1. Measure

```bash
node scripts/agents-lint.mjs <repo>
```

Read the chain table. Anything above ~8k tokens is the target. The fattest chains are usually caused by one or two **intermediate** files (e.g. `src/backend/CLAUDE.md`) that every deeper directory inherits.

## 2. Classify every section

For each `##` section in each file, ask in order:

| Question | Yes → |
|---|---|
| Must every task in the whole repo obey this? | root `AGENTS.md` → Hard rules (rare; a handful of lines) |
| Must an agent know this whenever it edits *anything* in this directory? | stays in this directory's `AGENTS.md` |
| Does it apply to a file *type* across the tree (tests, Dockerfiles, appsettings, locale JSON)? | `.claude/rules/<topic>.md` with `paths:` |
| Is it "how to do X": setup, running a stack, adding a service/domain/test, CI details, re-scaffold commands? | `docs/<topic>.md`, one-line pointer left behind |
| Is it a table of facts looked up occasionally (status codes, GAP registry, port lists)? | `docs/<topic>.md`, pointer left behind |

Typical intermediate-file content that is almost always tier 3: E2E/integration test procedures, Docker/compose layout, CI pipeline notes, observability configuration, "adding a new X" checklists, local setup values.

## 3. Split

For each file, largest chain first:

1. Create `docs/<topic>.md` per tier-3 section; move the text verbatim, then trim.
2. Replace it in the source file with one row in a pointer table: `| <task> | [docs/<topic>.md](…) |`.
3. Move glob-scoped sections to `.claude/rules/<topic>.md`; add `paths:` frontmatter.
4. Re-run lint; stop when the chain is under budget and each file is under its line budget.

Do not rewrite prose while moving it. Moving and trimming are separate commits; it keeps review honest.

This step is editorial and suits a coding agent working inside the target repo. A brief that has worked:

```
Read ../agent-context-kit/MIGRATION.md and README.md. Migrate this repo's CLAUDE.md tree
following that recipe: run the lint, classify every section of every CLAUDE.md using the
table in step 2, move tier-3 sections to docs/ with a one-line pointer, then git mv each
CLAUDE.md to AGENTS.md and add the shim. Move and trim in separate commits. Stop when
agents-lint --strict is clean. Do not rewrite prose while moving it.
```

Review the result as ordinary diffs; `git mv` plus cuts keeps history attached to the content.

## 4. Rename and shim

Per nested directory:

```bash
git mv <dir>/CLAUDE.md <dir>/AGENTS.md
printf '@AGENTS.md\n' > <dir>/CLAUDE.md
```

Root:

```bash
git mv CLAUDE.md AGENTS.md
```

Then create a new root `CLAUDE.md` from `templates/CLAUDE.root.md` and move any Claude-only content (plugin install, skill names, hook notes) from `AGENTS.md` into it. Add the line "Before editing under a directory, read the nearest `AGENTS.md` at or above it" to the root `AGENTS.md`.

Fix relative links: paths inside a moved section are now relative to `docs/`. Lint reports every dead link.

## 5. Verify

- `agents-lint <repo> --strict` is clean.
- In Claude Code, from the repo root, ask it to read one file in a migrated directory, then run `/context`. The nested `CLAUDE.md` should be listed and the `AGENTS.md` content should be visible to it.
- In Codex, from the repo root, the root `AGENTS.md` alone loads; confirm the "nearest `AGENTS.md`" line is present.

## Worked example (Regla, 2026-09-18, before migration)

| Chain to | Files | Tokens | Main contributors |
|---|---|---|---|
| `src/dotnet/Domains/Work` | 4 | 23.8k | `src/dotnet` 6.1k, `Domains` 8.3k, `Work` 6.4k |
| `src/dotnet/Domains/CompanyPortal` | 4 | 23.5k | same ancestors + 6.0k |
| `src/dotnet/Tests/E2E/…` | 3 | 13.6k | `src/dotnet` 6.1k, E2E 4.5k |

Tier-3 candidates found by the classification: in `src/dotnet` the E2E, Docker and CI-pipeline sections (~4k of 6.1k); in `Domains` the integration-test, observability and adding-a-domain sections (~5k of 8.3k). Target after split: root 1.5k + dotnet 1.5k + Domains 2.5k + leaf 2.5k ≈ 8k, a 3x reduction on the always-injected part of every backend session.
