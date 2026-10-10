# Agent Reasoning Effort Verification

Date: 2026-10-10. Feature issue: https://github.com/a2d2-dev/dsh-plugin/issues/105.

## Scope

Each Agent or consult model candidate can carry `reasoningEffort`. Legacy string candidates remain valid. The exact model's declared effort identifiers are used; no global effort enum is invented. Dispatch, subtask-root creation, consultation fallback, probes, and browser-created/handed-off Agent sessions carry the selected effort. Browser startup now uses trusted host-local selection, not the DSH picker that also persists a host default.

The settings namespace fix from issue #90 is included because reading the Loader's internal `include:a2d2` id instead of its public options id disabled saving. A regression test stamps both ids and verifies reads and writes to `a2d2`.

## Automated Verification

- `pnpm test`: 38 files, 603 tests passed.
- `pnpm typecheck`: passed for host and client.
- `pnpm build`: passed for host and browser artifacts.
- `git diff --check`: passed.

New coverage includes schema validation, immutable defaults, mixed old/new candidates, malformed and unsupported effort, independent Agent settings, hot effort changes at dispatch, subtask root creation, per-candidate consult fallback, probe requests, host-local initialization without saving defaults, same-Agent idempotence, and include-entry settings identity.

## Browser Component Verification

The actual `A2d2ConfigSection` was bundled with React in an isolated static fixture. Its HTTP face is mocked; these are component tests, not live deployment evidence.

Reproduce the fixture:

```bash
node --experimental-strip-types scripts/build-agent-effort-ui.mjs
```

Open `tmp/agent-effort-ui/index.html` in a browser.

Observed:

- Engineer Opus candidate changed to `medium`; reviewer retained `high`.
- Save sent revision 1 and the structured engineer candidate with `reasoningEffort: medium`.
- Save completed and the effort options remained available.
- Probe sent `route: claude-bray/claude-opus-5-5` and `reasoningEffort: medium`.
- Models without declared efforts had disabled selectors.
- Desktop at 1280px and mobile at 390px: no horizontal document overflow; effort controls and buttons had distinct non-overlapping bounds.

Screenshots:

- [Desktop](desktop.png)
- [Mobile](mobile.png)

The highway's pre-existing narrow-label issue is tracked separately in #92. This change only adjusts candidate rows for the added effort selector.

## Live GUI Status

The existing GUI at http://127.0.0.1:3080 was inspected. A read-only `settings.get` returned HTTP 200 but had neither an effort catalog nor a settings revision, confirming the running host still has the previous plugin code. Rebuilding the package did not replace that host module. No replacement GUI server was started and the existing host was not restarted, because other sessions are active. Loading the new host build is still required before live end-to-end acceptance; after that one-time code activation, configuration edits themselves are hot.
