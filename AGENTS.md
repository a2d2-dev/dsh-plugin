# AGENTS.md

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on a2d2-dev/dsh-plugin, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Verification URLs

The human cannot reach loopback. Every URL handed over for verification — a
DSH web instance, a preview build, a proxy — must use the host address
`10.126.126.12`, never `127.0.0.1` or `localhost`. When a service binds
loopback only, publish it on the host address first (the `dsh-dev-web-proxy`
socat pattern) and print the `10.126.126.12` URL.

## UI changes

修改界面布局、文案、按钮、菜单或空状态前，先阅读并遵循
[UI 设计规则](docs/agents/ui-design.md)。检查同一流程中的同类控件，避免只修截图中的单个位置。
