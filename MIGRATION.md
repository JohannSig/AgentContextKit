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

**Prefer many small pages to one big one.** A reference section over ~3k tokens (a controller catalogue, an entity table, a long procedure) shouldn't become one big doc: an agent that needs a single row would load all of it. Make `docs/<topic>.md` an index (a table of page → what it covers) and put one page per topic (per controller, per prompt kind, per tool group) in `docs/<topic>/`. Move rows and paragraphs verbatim (a table row becomes a `## Title` section) and keep the old path as the index so existing links still work. Set `docs.include` so the pages fall under the size budget and the index-completeness check.

**Check `###` headings too.** Splitting on `##` leaves any `###` block sitting under an unrelated `##` untouched, and those are often feature notes that were appended over time. Scan every `###` under a section you kept.

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
- `agents-verify <repo> --base <ref before the migration>` reports nothing missing. A paragraph counts as present if it appears anywhere in the current instruction files or docs pages (link targets and whitespace are ignored), so moved text passes and a deleted or reworded paragraph is listed. Fix each entry or accept the loss on purpose.
- In Claude Code, from the repo root, ask it to read one file in a migrated directory, then run `/context`. The nested `CLAUDE.md` should be listed and the `AGENTS.md` content should be visible to it.
- In Codex, from the repo root, the root `AGENTS.md` alone loads; confirm the "nearest `AGENTS.md`" line is present.

## 6. Lock it in

Run `agents-lint <repo> --write-baseline` and commit `.agents-context.baseline.json`, and make sure `.agents-context.json` sets budgets just above today's sizes. From then on a file that grows needs an explicit baseline update in the same PR. See "Guardrails" in the README.

## Worked example (Anvil, 2026-09-18, after migration)

Ancestor chain when an agent first touches a file under the directory, including the old ~3.5k root file:

| Directory | Before | After |
|---|---|---|
| `Anvil.Api/Mcp` | 49.1k | 5.2k |
| `Anvil.Api` | 37.7k | 4.3k |
| `Anvil.Runner` | 32.3k | 3.1k |
| `Anvil.Web` | 22.8k | 4.0k |
| root (always loaded) | 3.5k | 1.6k |

What got it there: reference sections (controller catalogue, entity/enum tables, prompt rules) moved to `docs/`, then the big pages split into 100+ per-topic pages behind indexes. The line budget never mattered: the worst file had 121 lines and 34k tokens. That is why the token budgets and the baseline exist. The first version missed one appended feature note sitting as a `###` under an unrelated `##`.

## Worked example (Regla, 2026-09-18, before migration)

| Chain to | Files | Tokens | Main contributors |
|---|---|---|---|
| `src/dotnet/Domains/Work` | 4 | 23.8k | `src/dotnet` 6.1k, `Domains` 8.3k, `Work` 6.4k |
| `src/dotnet/Domains/CompanyPortal` | 4 | 23.5k | same ancestors + 6.0k |
| `src/dotnet/Tests/E2E/…` | 3 | 13.6k | `src/dotnet` 6.1k, E2E 4.5k |

Tier-3 candidates found by the classification: in `src/dotnet` the E2E, Docker and CI-pipeline sections (~4k of 6.1k); in `Domains` the integration-test, observability and adding-a-domain sections (~5k of 8.3k). Target after split: root 1.5k + dotnet 1.5k + Domains 2.5k + leaf 2.5k ≈ 8k, a 3x reduction on the always-injected part of every backend session.
