# <Repo name> — agent instructions

<One paragraph: what this repo is, what lives here, production status.>

## How context is organized

- This file is always loaded. Keep it under 80 lines.
- Every area has its own `AGENTS.md`. **Before editing under a directory, read the nearest `AGENTS.md` at or above it.** Some tools load it for you; others do not.
- Cross-cutting rules (per file type, not per directory) live in `.claude/rules/`.
- Runbooks and deep reference live in `docs/`. Follow a link only when the task needs it.
- Links are pointers, not imports. Never use `@path` imports in any instruction file.

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
