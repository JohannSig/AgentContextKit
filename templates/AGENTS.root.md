# <Repo name> — agent instructions

<One paragraph: what this repo is, what lives here, production status.>

## How context is organized

- This file is always loaded. Keep it under 80 lines.
- Every area has its own `AGENTS.md`. **Before editing under a directory, read the nearest `AGENTS.md` at or above it.** Some tools load it for you; others do not.
- Cross-cutting rules (per file type, not per directory) live in `.claude/rules/`.
- Runbooks and deep reference live in `docs/`. Follow a link only when the task needs it.
- Links are pointers, not imports. Never use `@path` imports in any instruction file.
- **Where new knowledge goes.** A rule an agent must follow *whenever* it edits an area: 1–3 lines in that area's `AGENTS.md`. How something works, reference tables, history: the matching `docs/` page (list new pages in its index). Never append change logs or "task N did X" prose to an `AGENTS.md`; adding a section means moving one out. `agents-lint --strict` enforces token budgets and a growth baseline, so growth needs an explicit, reviewed baseline update.

## Hard rules

- <Rule that applies to every task, e.g. branch strategy.>
- <Rule that applies to every task, e.g. never commit secrets.>

## Map

| Area | Guide | Read when |
|---|---|---|
| <path> | [`AGENTS.md`](<path>/AGENTS.md) | editing anything under `<path>` |
| <topic> | [`docs/<topic>.md`](docs/<topic>.md) | <task that needs it> |

## Commands

```bash
<build>
<test>
<lint>
```
