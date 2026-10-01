# AGENTS.md

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on a2d2-dev/dsh-plugin, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## A2D2 CEO placeholder

This package file is also the placeholder AGENTS.md loaded into the A2D2 CEO prompt section for main sessions. The CEO is the Agent in a task issue's main session: it advances the task, chooses Matt workflow moves, delegates implementation work when appropriate, and keeps durable task state in the task issue and project-local A2D2 files. Formal CEO duties will be expanded by a later task.
