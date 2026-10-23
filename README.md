# dsh-a2d2

English | [中文](README.zh.md)

This repository holds the **A²D² DeepSeek Harness plugin**: the components that land A²D² inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) as one installable plugin.

**A²D² — Agentic Agile Driven Development — is a development methodology** that hands the rhythm of agile development to agents: a high-quality model chairs architecture and decisions, a multi-model orchestration carries execution, and the sessions of one piece of work stay tied together as it moves. The methodology is larger than this plugin (it spans workflow skills and multi-model orchestration too); this repository is only its concrete landing on the DSH side. As that landing grows, further DSH-side components live here under the same `a2d2` namespace.

What the plugin gives DSH today:

- **Task aggregation** — a task groups the sessions belonging to one piece of work and records the handoff edges between them, so related sessions keep a relationship a person can read, review, and commit. The data lives in project-local documents, and no session's durable format changes to carry it. A task bound to a task issue also records its main session — the one session executing it — which a session sets with the `bind_main_session` tool. A main session can open design-heavy subtasks as root main sessions with `open_subtask`, dispatch continuable subagents with `dispatch_subagent`, or declare its own task done with `complete_task`, using the stage Agent table for Agent identity and model selection.
- **Session handoff** — `/handoff` moves work from a long, expensive session to a fresh one without losing the thread: the handing-off session writes bounded continuation content, and the successor continues from it.
- **A floating indicator** — an at-a-glance orb by the composer that tracks context length and cost, and warns when a session approaches the smart zone so the next phase boundary can choose its outcome.
- **A²D² panel** — a better-sidebar tab for the open session's project tasks, member handoff tree, and main-session subagent route tree.
- **GitHub watch** — `github_watch` lets a session wait on a pull request without polling: when the PR merges, closes, finishes CI, or gets a review decision, the session receives a message, even if it was idle.
- **Notifications** — when a task issue's main session stops for LF, one A²D²-worded message reaches LF's phone through an installed `notifier` provider.

> `A²D²` is the brand and display form; `a2d2` is the technical identifier — package name, directories, and service names all use it, because `²` cannot appear in an npm package name. The package is `dsh-a2d2`.

## Install

### Desktop users: install a built plugin package

Desktop users do not need to compile the official desktop application or install Node.js or pnpm. The plugin maintainer should build and provide `dsh-a2d2-0.0.1.tgz`. After downloading it, open the installation entry in Desktop's plugin manager and enter the local file's **absolute path**. Follow any restart or reload prompt, then select models available in your host under **Settings → A2D2 配置**. This package already contains the build output and needs no Git build approval.

Download from [v0.0.1](https://github.com/a2d2-dev/dsh-plugin/releases/tag/v0.0.1): choose the `dsh-a2d2-0.0.1.tgz` asset, not GitHub's automatic Source code archives. The host capability requirements below still apply; this prerelease has not passed full functionality acceptance on official Desktop.

### Maintainers: build the distributable

The following commands are for the plugin maintainer:

`lib/` is build output and git-ignored, so a checkout contains no runnable plugin until it is built. `pnpm pack` runs the `prepack` hook (build plus the entrypoint assertion), so packing always produces a complete tarball:

```console
git clone https://github.com/a2d2-dev/dsh-plugin.git dsh-a2d2
cd dsh-a2d2
pnpm install
pnpm build                       # optional: pnpm pack's prepack builds too
pnpm pack                        # -> dsh-a2d2-0.0.1.tgz
dsh plugin --profile web add "$(pwd)/dsh-a2d2-0.0.1.tgz"
```

Install the tarball by its absolute path. Whether the packed artifact is complete is what `pnpm verify:pack-exports` (below) checks.

> **Build local directories before installing them.** An unbuilt source directory has no `lib/` and fails with `ERR_MODULE_NOT_FOUND`. For a Git URL, pnpm runs this package's `prepack` build hook while preparing the package, subject to the consuming project's build authorization; see below. After changing local sources, run `pnpm pack` again and install the new tarball.

### Official Desktop: authorize Git builds

`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` means pnpm requires authorization before running the plugin's build. `Lockfile passes supply-chain policies` is a separate check. The `prepack` hook generates `lib/`; deleting it or skipping scripts does not produce a working plugin.

[Issue #205](https://github.com/a2d2-dev/dsh-plugin/issues/205) was reported on official Desktop `0.2.1-rc.2`, whose [release manifest specifies pnpm 11.28.5](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/apps/desktop/package.json). The source checkout's development pnpm version, 10.26.2, can differ from Desktop's installer version.

1. Wait for the failed installation to finish and record the complete Git approval key and target directory from the error; do not edit configuration during an active installation.
2. Open the **target profile's** `pnpm-workspace.yaml`: normally `~/.dsh/profiles/desktop/pnpm-workspace.yaml`; in #205 it is `/Users/pengwu/.dsh/profiles/desktop/pnpm-workspace.yaml`. Do not edit the plugin source repository's configuration instead.
3. Preserve existing settings and approvals. Merge the printed entry into the existing `allowBuilds` mapping, or add that section if absent; do not create duplicate top-level keys. Only approve the repository and commit after deciding to trust its build scripts. The exact entry for the commit reported in #205 is:

   ```yaml
   allowBuilds:
     dsh-a2d2@git+https://github.com/a2d2-dev/dsh-plugin.git#dc944315c3d4a4d21e32b4f81fbb5d6521b2d141: true
   ```

4. Save and click **Retry** in Desktop's failed-install dialog, or reopen plugin installation if the dialog was dismissed. To install that exact commit, use this pinned URL:

   ```text
   git+https://github.com/a2d2-dev/dsh-plugin.git#dc944315c3d4a4d21e32b4f81fbb5d6521b2d141
   ```

   Optional CLI route: register Desktop's command through the application menu **Manage dsh Command… → Install**, fully quit the application (⌘Q on macOS), run the command below, then reopen Desktop. A separately npm-installed `dsh` cannot manage this desktop profile. The UI retry above needs no CLI registration.

   ```sh
   dsh plugin --profile desktop add 'git+https://github.com/a2d2-dev/dsh-plugin.git#dc944315c3d4a4d21e32b4f81fbb5d6521b2d141'
   ```

The approval identifies a repository and commit. If a later install reports another commit, review and use the **complete key from that error** instead of a wildcard. To revoke it, remove only the corresponding entry. Build authorization does not establish compatibility of every plugin feature; host capability requirements still apply as described under “Installation and development”.

To avoid building from Git during profile installation, build a tarball in the source checkout as shown above and install its absolute path through Desktop's original installation entry. The CLI equivalent is `dsh plugin --profile desktop add /absolute/path/dsh-a2d2-0.0.1.tgz`. A built tarball already contains the output and needs no Git prepare approval.

The rest of this document is the plugin's behavior contract and known limits, kept per component below.

## Installation and development

Requires Node.js 22 or later, pnpm 10.26.2, and a DSH host using the 0.2.0-rc.2 API family. Session creation and handoff additionally require the host's public `sessionController.selectLocalModel` capability. A version string alone does not prove that capability is installed; hosts without it are rejected. The minimum released DSH version providing it has not yet been verified, so end-to-end compatibility with an unmodified public host is a release gate.

The checked upstream [session-controller source at `687f282e`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/index.ts) does not define `selectLocalModel`. Session initialization compatibility is therefore an unresolved upstream release blocker, not a verified stock-host feature.

Build from source:

```sh
git clone https://github.com/a2d2-dev/dsh-plugin.git
cd dsh-plugin
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm verify:pack-exports
pnpm pack --out /absolute/path/to/output
```

Install the generated tarball in an existing DSH web profile:

```sh
dsh plugin --profile web add /absolute/path/to/output/dsh-a2d2-0.0.1.tgz
```

The package and browser bundle are named `dsh-a2d2`; this project does not publish under the `@deepseek-ai` scope. Registry publication and a clean-host end-to-end install are not yet verified. Configure Agent candidates using provider/model routes actually available in your host; the example defaults are not bundled model providers. Optional workflow skills (`ask-matt`, `handoff`) must be installed separately; see `skillsRoot` below. GitHub features also need the `gh` CLI and authentication.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). Third-party dependencies retain their own licenses; see [release requirements](docs/releasing.md).

## Plugin (namespace: `a2d2`)

The package contributes eight mount rows. `ctx.a2d2` is the task store and declares no service, so it loads in any profile; the command row declares `commands` and `a2d2`, so only a profile that composes both gets `/handoff`; the base tools row declares `tools` and `a2d2`, so only a profile that composes both gets `bind_main_session` and `dispatch_subagent`; the open-subtask tools row additionally declares `agents` and `llm`, because `open_subtask` creates a root session and selects the model from the Agent assigned to the `grill` stage; the complete-task tools row declares `agents`, because `complete_task` may resume a parent task's main session before sending the notification; the CEO prompt row declares `agents`, `systemPrompt`, and `a2d2`, so only a profile that composes live Agents and system prompt assembly gets scoped main-session guidance; the Agent prompt row uses the same services to assemble engineer/reviewer configuration for recorded Agent sessions; the GitHub watch row declares `tools`, `agents`, `sessions`, and `sessionController`, so only a profile that can wake sessions gets `github_watch`. The dispatch tool looks up `subagents` only when it runs, so profiles without the subagent service still load the base tools row and keep `bind_main_session` available. Cordis refuses to load a plugin whose declared services are absent, which is why the rows are split rather than registered conditionally from one row. The floating orb needs no row of its own: it drives that same command through the session it already sits on.

Before publishing, run `pnpm verify:pack-exports`. It exports only git-tracked files with `git archive HEAD` into a temporary clean tree (asserting `lib/` is absent), then runs `pnpm pack` inside that tree so `prepack` builds from scratch. It asserts the tarball's file list carries every explicit `exports` target — types and the client bundle included — plus `dsh.plugin.json` and `cordis.patch.yml`, then installs that same tarball into an empty temporary project and imports every Node entry declared in `package.json` exports. The check therefore covers the empty-shell tarball (a checkout packed without a build) as well as missing hashed build chunks such as the shared handoff chunk before a release is cut. Because it verifies the committed `HEAD`, a dirty working tree is rejected: commit or stash first.

```yaml
- id: a2d2
  name: 'dsh-a2d2'
- id: a2d2-command
  name: 'dsh-a2d2/command'
- id: a2d2-tools
  name: 'dsh-a2d2/tools'
- id: a2d2-open-subtask-tools
  name: 'dsh-a2d2/open-subtask-tools'
- id: a2d2-complete-task-tools
  name: 'dsh-a2d2/complete-task-tools'
- id: a2d2-ceo-prompt
  name: 'dsh-a2d2/ceo-prompt'
- id: a2d2-agent-prompt
  name: 'dsh-a2d2/agent-prompt'
- id: a2d2-github-watch
  name: 'dsh-a2d2/github-watch'
```

| Key | Default | Contract |
|---|---|---|
| `root` | derived per call | Absolute project root. When set, the session cwd no longer selects the store. A relative value fails at load. |
| `projectMarkers` | `['.git']` | Directory entries that identify a project root while walking upward from a session cwd. An empty list fails at load. |
| `skillsRoot` | `~/.agents/skills` | Explicit absolute directory containing installed skills; omitted to probe conventional locations. The host reads `handoff/SKILL.md` and its declared local markdown resources from here. |
| `suggestedSkills` | `['implement', 'tdd', 'code-review']` | Deprecated compatibility key. It remains accepted but is no longer rendered or consumed. |
| `handoffWarnTokens` | `150000` | Context length, in tokens, at which the floating indicator warns that the session is approaching the smart zone. A value at or below 0 fails at load, and a value above `handoffCriticalTokens` fails at load. |
| `handoffCriticalTokens` | `1000000` | Context length at which the indicator is critical. |
| `modelPrices` | `{}` | Per-million-token rates the indicator's cost line uses, keyed `provider/model` and then bare `model`. A negative or non-finite rate fails at load. |
| `currency` | `¥` | Currency symbol the rates are quoted in. |

The configuration keys belong to the `a2d2` row. Every method takes the caller's session cwd and resolves the project root itself, so callers carry no project bookkeeping. `list` reads the project's tasks, `resolve` returns the task a new session inherits, `create` mints an id and writes a document, `registerMember` records a session as a member with an optional handoff edge, `prepareHandoff` / `takeHandoff` write and consume a handoff document, `bindMainSession` binds a session as the main session of a task issue, `openSubtask` opens a subtask issue as a new root main session, `completeTask` marks a task issue done and notifies its parent main session when one exists, and `taskOfMainSession` / `mainSessionOfIssue` answer which task a session is the main session of and which session is a task issue's main session.

### Stage Agent settings

The plugin also exposes live stage Agent settings in DSH's `settings.yaml`. The persisted section is keyed by the plugin profile entry id, and this plugin owns the `stageAgents` value inside that section. Users can change stage assignments, Agent model candidates, and consult candidates without restarting the host.

```yaml
<profile entry id>:
  stageAgents:
    stages:
      grill: ceo
      to-spec: ceo
      to-tickets: ceo
      implement: engineer
      code-review: reviewer
      prototype: ceo
      handoff: ceo
      diagnosing-bugs: ceo
      triage: ceo
      wayfinder: ceo
      improve-codebase-architecture: ceo
      domain-modeling: ceo
      codebase-design: ceo
    agents:
      ceo:
        - claude-bray/claude-fable-5-1
        - codex/gpt-6
      engineer:
        - codex/gpt-5.5
        - claude-bray/claude-opus-5-5
      reviewer:
        - claude-bray/claude-fable-5-1
        - codex/gpt-6
    consult:
      - claude-bray/claude-fable-5-1
      - codex/gpt-6
```

`stages` covers the closed Matt highway stages and maps each one to `ceo`, `engineer`, or `reviewer`; standalone skills use CEO by policy and are not stored in the table. `agents` and `consult` are ordered `provider/model` candidate lists. Empty lists, malformed routes, unknown stages, and unknown Agent names are rejected by the settings schema. Defaults assign `implement` to engineer, `code-review` to reviewer, and every other closed stage to CEO. CEO, reviewer, and consult default to `claude-bray/claude-fable-5-1` then `codex/gpt-6`; engineer defaults to `codex/gpt-5.5` then `claude-bray/claude-opus-5-5`. If reviewer and engineer share the same first candidate the host logs a Chinese warning, but keeps the setting.

### Subagent reasoning effort

Open **Settings → A2D2 配置 → Agent model candidates** to select reasoning effort beside each model. Options come from the exact provider/model's declared efforts, not a shared hard-coded enum. CEO, engineer, reviewer, and consult are independent. Saving affects subsequent creation or dispatch, never existing sessions. Models without declared efforts have a disabled selector. Missing model metadata is shown separately as unavailable, not as a declaration of no efforts. Any explicit effort requires verifiable metadata for that exact route: missing metadata, unknown routes, and empty effort declarations are rejected before saving or probing, without reporting success or silently ignoring the effort. Legacy route strings can still be saved without effort metadata.

Legacy `provider/model` strings keep DSH's existing omission/default/inheritance behavior. For independent effort, use a structured candidate under `stageAgents.agents`:

```yaml
engineer:
  - route: claude-bray/claude-opus-5-5
    reasoningEffort: medium
reviewer:
  - route: claude-bray/claude-opus-5-5
    reasoningEffort: high
```

`stageAgents.consult` accepts the same candidate objects. Do not append `@medium` to a route string. Browser-created and handoff sessions install their model through the trusted host route, using session-local selection rather than DSH's default-saving picker. Repeating the same Agent registration does not change an existing session's model or effort. Probes send the currently selected effort; their result identity includes effort so a changed setting cannot reuse a different effort's result.

The minimum host capability for browser-created and handoff session initialization is the public `ctx.sessionController.selectLocalModel({ sessionId, provider, model, reasoningEffort? }): Promise<{ selected: ModelSelection }>` API. It must apply selection only to that session and never save host defaults. Hosts without this method are explicitly rejected; there is no fallback to the default-saving `selectModel` or private Agent/registry mutation.

Initialization is serialized per session, with independent sessions free to proceed. Agent identity is recorded only after local model installation succeeds; a failed installation leaves no identity record and can be retried, including by an already queued request. After success, repeated same-Agent initialization does not reinstall a model, preserving any manual session selection; a different Agent is rejected before installation.

### Session Agent assembly

Main sessions are CEO by task binding and are not written to a separate Agent ledger. `dispatch_subagent` records its child session as the Agent assigned to the requested stage, and the authenticated browser route `/a2d2/api/session-agent` records sessions created by chips as `ceo`, `engineer`, or `reviewer`. That route is POST-only, uses the same DSH browser authentication and 64 KiB JSON body limit as `/a2d2/api/consult` and `/a2d2/api/config`, rejects unknown session ids, illegal Agent values, task issue main sessions, and attempts to rewrite an already recorded session to a different Agent, and writes the project-local `.dsh/a2d2/session-agents.yaml` ledger. Recording the same session as the same Agent is idempotent. `ctx.a2d2.agentOfSession(cwd, session)` returns `ceo` for task issue main sessions, the ledger value for recorded non-main sessions, and `undefined` for ordinary unrecorded sessions.

Engineer and reviewer sessions get a scoped `a2d2:agent` system prompt section when the `agent-prompt` row is composed. The section reads `~/.dsh/a2d2/agents/<engineer|reviewer>.md` first and `<projectRoot>/.dsh/a2d2/agents/<engineer|reviewer>.md` second, marking the project configuration as priority over global configuration. The files are reread on every system prompt assembly, skipped when missing or empty, and the section renders as empty when both levels are absent so a file created later changes the next request. User-authored Agent configuration is treated as literal prompt text, so `{{...}}` examples are preserved rather than interpolated. These files are not written into session history. CEO keeps the existing `a2d2:ceo` section and SOUL behavior, with the same literal treatment for SOUL text.

### A2D2 configuration page

The browser bundle registers an independent DSH settings section, **A2D2 配置**. The page draws the full Matt highway with one Agent selector for every closed stage. The standalone area is shown as **CEO（任意 skill）** and is not editable. Below the map, the page edits four ordered candidate lists: CEO, engineer, reviewer, and consult.

The page never writes arbitrary settings namespaces from the browser. It calls this plugin's own route, `/a2d2/api/config`. Like every A²D² browser route (`/a2d2/api/config`, `/a2d2/api/consult`, `/a2d2/api/session-agent`, `/a2d2/api/tasks`), it first asks DSH's `connection` service (`requestRejection`), which applies the same Host/Origin fence and browser login check as DSH's own channels: a request without the DSH login cookie is refused `401` (`unauthenticated`), one from an untrusted authority or origin `403` (`untrusted`), before any body is read. A Host or Origin header alone is never enough, because any non-browser client can forge it. A profile without the `connection` service registers none of these routes. The browser half sends the login cookie automatically (same-origin `fetch`), so a signed-in DSH page needs nothing extra. Requests are capped at 64 KiB, invalid JSON is rejected, and writes must include the revision returned by a completed read. Saves replace the whole `stageAgents` value with that revision: `stages`, `agents`, and `consult` are all required, `stages` must cover every closed highway stage, `agents` must include `ceo`, `engineer`, and `reviewer`, and unknown top-level keys inside `stageAgents` such as the old `stations` shape are rejected. A missing revision is rejected without writing, a stale save is rejected as a conflict, the route returns the latest value, and schema failures such as an empty list or malformed route are reported without persisting anything.

Model candidates are added from DSH's host model catalog (`llm.models`) so the page cannot create a typo-only route. Each existing candidate has a **Test** action that performs exactly one tiny host-side call (`reply OK`, small output budget) and classifies the result as normal, refusal, rate-limited, or error with the reason; an empty response is reported as error. There is no background probing.

## Task documents

One YAML document per task, under `<projectRoot>/.dsh/a2d2/tasks/<id>.yaml`. `<projectRoot>/.dsh/` is the established project-local root — the same anchor `skill-filesystem` uses for `.dsh/skills` — and the plugin's short name namespaces this store, keeping the plugin's footprint one directory even when it later owns further kinds of state.

```yaml
version: 2
id: issue-45
issue:
  number: 45
  parent: 41
  mainSession: session-b
name: Bind the main session
state: active
createdAt: 2026-10-01T00:00:00.000Z
sessions:
  - id: session-a
  - id: session-b
    handoffFrom: session-a
```

A task bound to a task issue is identified by the issue number — `issue-<number>.yaml`, so a project holds at most one document per task issue. Its `issue` mapping records the `number`, the `parent` task issue when the task is a subtask, the `mainSession`, and, while a main-session handoff is prepared but not yet taken, `handoff.source`. The task's completion is its `state: done`. A task bound to no task issue (for example one `/handoff` created) has no `issue` mapping and an id derived from its name.

The document is version 2. A version 1 document predates task issues: it still reads, as a task bound to none, and the next write turns it into version 2.

A document is a file a person may hand-edit and commit, so validation runs at that boundary and fails loudly rather than degrading: an unsupported `version`, an `id` that disagrees with the filename, an unknown `state`, a blank name, a non-sequence `sessions`, or an `issue` whose `number` or `parent` is not a positive integer, whose document id is not `issue-<number>`, or whose `mainSession` is not one of the `sessions` each reject the document instead of yielding an empty task. A missing tasks directory is valid empty state, and `list` does not swallow a malformed document that a person can see in their own working tree.

Writes are atomic and serialized through the document's own file lock. `create` derives the id from the name; a name with no ASCII stem (for example a Chinese one) falls back to a timestamp stem, because the id only has to be unique and safe while the name a person reads lives in the document.

## Main session

`bind_main_session` binds the calling session as the main session of a task issue (ADR 0003). Its parameters are `issue`, `parent_issue` (set only for a subtask), and `title`, which names the task when it is first recorded (default `Task issue #<number>`); the session id and its cwd come from the calling agent. The tool only hands these to `ctx.a2d2.bindMainSession`, which owns the rules:

- The first binding writes `issue-<number>.yaml` with the session as `mainSession` and as the first member.
- A task issue has one main session at a time: another session's binding is refused, naming the current main session; a successor takes over only through a handoff.
- A session is the main session of at most one task issue, so "which task does this session execute" has one answer.
- Binding again with the same arguments returns the recorded task unchanged; naming a different parent is refused.
- When the CEO prompt row is composed, a successful binding also installs the scoped `a2d2:ceo` system prompt section on a running Agent for that main session; Agents created or resumed later get the same section when their session is already the task issue's main session.
- A task bound to no task issue that already uses the `issue-<number>` id is refused rather than taken over, and so is a session that records no working directory.

## Open subtask

`open_subtask` lets a task issue's main session open a subtask issue as its own root main session (ADR 0005). Its only parameter is `issue`, the already-created subtask issue number. The caller's own task issue becomes the parent issue.

The service reads the Agent assigned to the `grill` stage, selects that Agent's first `provider/model` candidate that appears in the live DSH model directory, creates a new root Agent in the same project cwd with that provider/model, sends exactly one first prompt containing the subtask issue reference, the parent task issue reference, per-reference `gh issue view <number> --comments` read commands to run in the project directory, and the instruction to use `/grill-with-docs` as that task's main session, then reuses `bindMainSession` to record the new session as the subtask's main session. It refuses calls from sessions that are not task issue main sessions, and refuses a subtask issue that already has a main session.

## Complete task

`complete_task` lets a task issue's main session declare its own task done after acceptance. Its parameter is `summary`, the completion summary that a parent CEO should receive. The plugin writes only the project-local task document (`state: done`); it never calls GitHub, and closing the task issue remains the CEO's job.

Only the task issue's current main session can complete it. If the task has no parent issue, completion stops after the document write. If the task has a parent issue and that parent task has a main session, the plugin sends that parent main session one notification from the `a2d2-complete-task` source. The notification names only the child task issue (`#<number>`) and the completion summary, with no URL. When the parent main session is already loaded, the plugin calls `followup` on that live Agent; when it is not loaded, the plugin first calls DSH `agents.resume({ resumeSessionId })`, then calls `followup` on the resumed Agent.

## Notifications

When a task issue's main session stops and waits for LF, the plugin pushes one message to LF's phone through the optional `notifier` service (ADR 0010). A²D² decides whether a stop is a wait for LF and what the message says; delivery belongs to whichever plugin provides `notifier`. **Install exactly one provider**: a2d2-dev/dsh-feishu-connect (Feishu app bot) or dsh-notifier (many channels). Both provide the same service name and would compete, so never install both. Without a provider the plugin starts and runs as before and sends nothing; it reaches the service through a callback `ctx.inject(['notifier'], …)`, never a static `inject`, so a missing provider cannot hold startup.

Only a task issue's main session notifies; subagents and unbound sessions never do. Three waits trigger a message:

| Wait | Title | Content | Level | When |
|---|---|---|---|---|
| A turn ends (`completed`, `error`, `blocked`, `max-tokens`) | `#<issue> · 等你回复` | The turn's last assistant reply, cut to 300 characters, then the task issue link | `active` | 30 s after the turn ends; retracted when the session receives a `user/*` event or starts another turn first; not sent for a turn that called `complete_task` |
| `ask_user_question` is called | `#<issue> · 需要你决定` | The question texts, then the task issue link | `timeSensitive` | At once |
| `complete_task` succeeds | `#<issue> · 已完成` | The completion summary | `active` | At once; the turn it ran in then ends without `等你回复` |

A turn cancelled by `aborted`, and the after-the-fact `interrupted`/`forked` closers, send nothing. The link is `https://github.com/<owner>/<name>/issues/<issue>`, taken from the session cwd's `github.com` `origin`; without one the message has no link. The title carries no stage: the current stage lives only in the task issue's status, which the plugin does not read.

Every push is `ctx.notifier.push({ title, content, level }, { sourceName: 'dsh-a2d2', sessionId })`. `sessionId` lets the provider retract its own generic notice for the same wait, so the wait produces one message. The result is only logged; a failed, rejected, or throwing push never affects the session.

## Dispatch subagent

`dispatch_subagent` dispatches a continuable child subagent from the calling main session. Its parameters are `stage`, `issue`, and `prompt`; the parent Agent, session id, cwd, and cancellation signal come from the tool execution context. The tool only hands these to `ctx.a2d2.dispatchSubagent`, which owns the rules:

- Only a task issue's current main session can dispatch; ordinary sessions are refused.
- The child uses DSH's fresh `spawn` continuable provider.
- The stage maps to `ceo`, `engineer`, or `reviewer`; the child model is that Agent's first `provider/model` candidate that is present in DSH's host model catalog, read once at dispatch time so a settings change affects the next call without making the returned Agent disagree with the selected model.
- The child session id is preallocated and recorded as that stage Agent before DSH creates the child, so the `agent-prompt` row can assemble engineer/reviewer configuration into the child's first system prompt. `dispatch_subagent` never passes project Agent configuration through DSH's `persona` field.
- The result returns the child session id, the actual `provider/model`, and the stage Agent used (`ceo`, `engineer`, or `reviewer`).

## GitHub watch

`github_watch` takes `pr` and an optional `repo` (`owner/name`). When `repo` is omitted, it uses the `github.com` origin of the session's working directory. The PR states come from the A²D² hooks service at `https://hooks.a2d2.dev` (repository a2d2-dev/a2d2-services). The service reads GitHub as the a2d2-bot GitHub App, once per event for every subscriber, and pushes a PR's state over an outbound WebSocket whenever that state changes. The plugin therefore needs no public address, no webhook configuration, and never polls GitHub. Its only GitHub call is the ticket request, which sends the user's `gh auth token` (or `GH_TOKEN` / `GITHUB_TOKEN`) so the service can check read access.

- The call returns the PR's current state: open/closed/merged, CI rollup, and review decision. A PR that is already merged or closed ends the watch at once.
- The watch list and the state each session was last told live in `~/.dsh/a2d2/github-watches.json`. Each later state is compared with what that session was last told; only a difference injects a message. The message is a durable user-role notice with source `{ kind: 'a2d2-github-watch', repo, pr }` and a one-line summary such as `a2d2-dev/x#7: merged, CI passed`. Injection wakes an idle session.
- After DSH restarts, every stored watch reconnects. The snapshot the service returns is compared with the last-told state, so a change that happened while DSH was down is reported once, and nothing is reported when nothing changed.
- A watch ends after a merged, closed, or not-found state has been told. It also ends if its session no longer exists.
- On a repository without a2d2-bot, the call returns `not_installed` with the install link (`https://github.com/apps/a2d2-bot/installations/new`) and keeps no watch. If the app is removed later, watching sessions are told once and their watches end.
- When the service is unreachable, the connection retries with backoff (1 s up to 60 s). If the service has not answered within 20 s, the call returns `pending`, and the first state then arrives as a message.

| Key (row `a2d2-github-watch`) | Default | Contract |
|---|---|---|
| `relayUrl` | `https://hooks.a2d2.dev` | Base URL of the hooks service. |
| `homeDir` | `~/.dsh/a2d2` | Directory of `github-watches.json`. |

## `/handoff`

One command name covers both sides of the handoff, because the successor's session id exists only once that session exists.

```
/handoff [<focus>] [--task <task-id>] [--focus <focus>]
/handoff take <session-id>
```

| Invocation | Effect |
|---|---|
| `/handoff` | Starts a handoff of the current session, with no stated focus. |
| `/handoff <focus>` | The same, with the next session's purpose recorded. |
| `/handoff --task <task-id>` | Hands off within a named task instead of the resolved default. |
| `/handoff take <session-id>` | Reads that session's handoff document, joins the current session to the task the handed-off session belongs to, and submits the document body as this session's first prompt. |

Preparing is two steps, because only the handing-off session holds the state that may still live in the conversation. The command writes the document's skeleton — front matter plus the fixed sections — and then queues one ordinary turn of that session asking its agent to write continuation content into the document. Until that turn finishes the document parses as `unwritten` rather than as a handoff, so content that was never written cannot be taken. Taking is one step: `take` derives the task from the handed-off session's own membership, so the successor needs only the session id it continues.

The source side resolves the project's newest `active` task and creates one when the project has none, naming it after the focus (or the project directory when there is no focus). The task document is compiled into the project, so a handoff needs a task to belong to; requiring a person to write that file by hand first would make the command unusable until they did.

The source session joins the task immediately. The successor joins when it takes the handoff, because a session that is never opened leaves nothing to point at — the document stays the only record of the intent. Both registrations are idempotent, so a retried command neither duplicates a member nor replaces the edge the first attempt recorded.

When the source session is a task issue's `mainSession`, prepare also marks the task issue as handing off by writing `issue.handoff.source` while keeping `issue.mainSession` on the source. A task that was prepared but never taken therefore keeps its CEO. A successful `take` moves `issue.mainSession` to the successor, clears `issue.handoff`, and still records the ordinary member `handoffFrom` edge. If the source session is not a task issue's main session, handoff behavior is unchanged.

Malformed input fails loudly rather than degrading into a focus: an unknown option (`--fucos`), an option left without a value, an option given twice, a task id that is not a document id, and a `take` invocation missing an argument or carrying a third one each return an error with the usage line.

Redaction is best-effort and runs on the way into the successor's prompt. A secret-bearing name with an assigned value, a `Bearer` token, a URL password, and a provider-prefixed token (`sk-`, `ghp_`, …) are replaced by a placeholder naming how many characters were removed; when that pass changes the summary, the document is rewritten from the redacted text, so the committed file and the prompt agree. A secret the patterns do not recognize — an unlabelled random string, for example — reaches the document unchanged, so a handoff of a session that handled credentials is not safe to commit without reading it. The writing agent is also told to redact secrets, which is a second, weaker guard rather than a substitute for reading the file.

## Handoff documents

One markdown document per handed-off session, under `<projectRoot>/.dsh/a2d2/handoffs/<session-id>.md`. Two writers own different halves. The plugin owns the YAML front matter it parses back — the source session, the task, the timestamp, the focus, and an optional visible skill-source degradation marker — plus the fixed sections of the body. The handing-off session's own agent owns the continuation content between two HTML-comment markers. It decides whether that content is a pointer to durable state, a compact account of conversational state, or a mixture. The body is what the successor receives as its first prompt, so it carries only what that session needs: the `take` line that finishes a handoff belongs to the source side, which reads it from that command's own result before a successor exists.

`/handoff take` validates the document at this file boundary: an unsupported `version`, a `source` that disagrees with the session it was looked up by, an unknown front-matter field, a body with no summary region, and a summary still carrying its placeholder each reject it. A missing document is a failure too, never an empty continuation, because a fresh clone may simply not have the file yet.

`.dsh/` is not gitignored (only `.dsh-build/` is), so both task and handoff documents enter version control — which is the point of keeping them in the workspace. The document therefore carries the summary into the repository, which is why the plugin redacts it before the successor reads it, and why the file is worth reading before committing.

### The continuation-writing turn

The host reads `handoff/SKILL.md` from `skillsRoot`, follows local markdown references in its body in declaration order, and injects those files verbatim. A parameter-only envelope follows with the document path, marker pair, focus, and approximate 4000-character limit; skill rules are not restated there. If `SKILL.md` is unavailable, the turn uses one minimal continuation requirement and the skeleton records `skillSource: unavailable`, making the degradation visible rather than substituting embedded fallback knowledge. The document version remains `2`: a document written by an earlier build declares version `1` and is refused rather than read for content it does not contain.

## Derived handoff edges

Only one direction of a handoff edge is stored: a member's `handoffFrom`, naming the session it was handed off from. `successorsOf` derives the opposite direction from the same document, so the two directions cannot disagree, and `handedOff` reports whether a session currently has a successor at all.

`handedOff` reports a continuation, never that a session is finished. Handing off is not terminal: a real workflow hands off to run something elsewhere and then hands back, so the source session stays usable and may itself acquire several successors.

## The indicator orb

The package also ships a browser bundle (`exports["./client"]`, `dsh.client.platform: 'web'`) mounted on the bare `dsh-a2d2` row — a subpath row can never be a client row, and the bundle's registered id must equal the entry name, which is why the id is the package name.

It renders one fixed circle beside the composer showing the session's context length (`453K`, `1.2M`) and, when the route has a configured rate, its estimated input cost. The **background** carries the reading: green below the warn length, amber at it, red at critical. The default warn length is 150K tokens. Amber means the session is approaching the smart zone: at the next phase boundary, choose among the five workflow outcomes; handoff is only one of them. Hovering gives the full figures — exact tokens, capacity, percent, and the cost with the currency it is quoted in — and reveals one boundary action above the circle: **下一步**. Handoff is no longer a peer orb action.

### Boundary card

The **下一步** card opens with an instant status block answering "what is this session doing right now": running (with the in-flight tool and how long it has run), waiting on you (a pending approval — naming the tool and reason — or question), possibly stuck (running, not streaming, and no new turn or tool call for 10 minutes), errored, idle (with when the last turn ended), or not started — plus queued messages and context occupancy. It reads only the conversation snapshot the client already holds, never calls a model, and stays live while the card is open — so the card is useful while the consultation below is still generating.

Opening the card also requests a one-off consultation for the current session, without adding a consultation turn to session history. New hosts return a highway location (`zone`, `station`, `phaseDone`, and optional `returnTo`), a recommended next station and move, 2-4 move-labeled candidates, `stageAgents: { stages, agents }`, and `sessionAgent` when the session is recorded as `ceo`, `engineer`, or `reviewer`. The card renders the status block first, then a vertical mini highway for the main Matt road (`grill` -> `to-spec` -> `to-tickets` -> `implement` -> `code-review`), with passed/current/next/ahead state, Chinese station roles, and the configured Agent for each stage. Service areas and ramps show notes such as "绕道中：prototype，完成后 handoff 回 grill" or "匝道：wayfinder，并入 to-spec"; standalone and off-road locations show a placard instead of highlighting the main road. Under the map, the next line reads like `→ /to-spec · Continue（reason）· CEO`, or `本阶段未完成 · 继续` while `phaseDone` is false. Older hosts that do not return `location` still degrade to the old one-sentence **当前位置** plus chips.

The next-step consultation does not read `a2d2-orchestrator` or the former `ceo-team` skill. Its envelope carries the current session material, host-checked project facts, context facts, the highway catalog, the stage Agent table, this session's Agent when known, and the verbatim `ask-matt` source; candidate intents are generated from that material like ordinary chips. Installing or removing those orchestration skills therefore does not change the consultation envelope or add an extra all-tickets implementation chip.

The host also checks the project that owns the session cwd before asking the model: either `CONTEXT.md` or `CONTEXT-MAP.md` must exist, and `docs/agents/issue-tracker.md` must exist. The response carries `preconditions.missing`, and the prompt envelope records the same host fact so the model does not have to infer setup state. When anything is missing, the card shows a top placard, **首次使用前：/setup-matt-pocock-skills**, listing the missing items. The host also forces `/setup-matt-pocock-skills` to the first chip after parsing the model output; if the model already proposed it, that chip is moved to the front, otherwise it is inserted, and the list is capped at four chips. A model-provided chip whose input is exactly `/setup-matt-pocock-skills` is the only `continue` candidate exempt from the cross-Agent continue rule, matching the host-inserted setup chip. Configured projects and older hosts with no `preconditions` field show no setup placard.

The consultation does not reuse the current session route: it tries the stage Agent settings `consult` candidates in order, falling back on provider errors, rate limits, refusals, or empty output. Malformed non-empty JSON is not retried because that is a protocol failure, not route availability; this includes a `phaseDone: true` answer that tries to `continue` into a target whose Agent differs from this session's Agent, or tries to `continue` when the session has no recorded Agent, except for the exact setup chip described above. The response includes `answeredBy`, `fallbacks`, `stageAgents: { stages, agents }`, and, when known, `sessionAgent`; the card footer shows "由 X 生成" and names the fallback reason when one occurred. The browser derives every highway label from `stageAgents`: stage -> Agent -> that Agent's first candidate present in the session model directory, displaying labels such as `工程师 · gpt-5.5` or `工程师 · 无可用模型`. The same table drives the chips (ADR 0007). A chip never sends anything and never switches this session's model; it only prepares by move, and writes its side effect on itself:

- **continue** fills this session's composer and focuses it. It carries no side-effect label, because it only appears when the next stage's Agent is this session's Agent.
- **subagent** fills this session's composer with the instruction plus a line naming the subagent's Agent, and the chip reads e.g. `子代理 · 评审`.
- **clear** creates a session in the same workspace, records it as the next stage's Agent through `/a2d2/api/session-agent`, where the host selects that Agent's first catalog-present candidate and its effort locally without saving a global default, opens it, and fills its composer. The chip reads e.g. `新会话 · 工程师（gpt-5.5）` (`新会话 · 工程师` until this session's directory has loaded). When none of the Agent's candidates is in the directory the chip reads `工程师无可用模型`, and clicking only fills this session's composer and says why. A failed creation also falls back to filling this session; a failed registration or model selection on the new session is reported and does not stop the fill.
- **compact** and **handoff** open the handoff card; the one-click handoff below records and starts the successor as the next stage's Agent before take.

A standalone skill's Agent is CEO, on the chips and on the next-stage line alike. Older hosts that send no `stageAgents` get no Agent: clear creates a session with its default model (`新会话 · 默认模型`) and records nothing.

The bottom of the boundary card has an always-available **其他走法** foldout. It lists the non-continue moves — clear, subagent, compact, and handoff — as general entrances. Clear follows the same blank-session sequence as a clear chip, but without a stage target it records no Agent and keeps the new session's default model; subagent prepares editable composer text; compact and handoff open the handoff card. This keeps handoff reachable without putting it back on the orb as a peer to **下一步**.

The card explicitly shows loading and route errors. If the host could not read the `ask-matt` skill, it still returns degraded candidates and the card marks them with **未读到 ask-matt skill**. If generation fails, the route's error message is shown and the consultation can be retried; every request replaces the prior candidate state instead of accumulating chips.

### One-click handoff

The handoff card is opened from a handoff or compact chip, or from **其他走法**. It is a confirm card the plugin draws itself (no DSH command modal exists): a focus field and **创建并交接** / **取消**. Confirming performs the whole handoff in one gesture — it no longer fills the composer and waits for a send:

1. the browser runs `/handoff <focus>` on the session it sits on, through that session's own command face, which is what makes the host write the skeleton and queue the turn that writes the continuation content;
2. the browser waits for that turn, reading the session's own `running` state over the session transport — not a timer, and not another plugin's rendered DOM, either of which would report the session as finished at the wrong moment;
3. the browser finds the session's workspace and `connectWorkspace`s a fresh successor session;
4. when a handoff or compact chip carries a next-stage target, the browser resolves that stage's Agent through `stageAgents` (CEO for a standalone skill), records the successor and installs its candidate and effort locally through `/a2d2/api/session-agent`, without changing the host default — all before take; a failed registration or selection is reported and the handoff continues;
5. the browser focuses the successor session;
6. the successor inherits the handing-off session's title, incremented in the same style a fork numbers a peer (`Ship the store` → `Ship the store (1)`), so a handoff chain reads as one named piece of work rather than several sessions with an identical name. A source with no title, or a rejected rename, leaves the successor on its automatic title — a title-only loss never stops a handoff whose continuation content already landed;
7. the successor runs `/handoff take <session-id>`, which is what makes the host inject the continuation content as its first prompt.

A wait that ends without the turn having run, or with it still running, stops the sequence and names the step that failed; the take would refuse an unwritten summary anyway, so a half-finished handoff cannot look like a finished one. The orb drives the handoff itself through services the client already composes — the session face and the workspaces service; its only host route is the Agent registration above, used when the handoff carries a next-stage target. When the session belongs to no workspace there is no successor to create, and when either service is absent the orb falls back to the older behavior of appending the literal `/handoff ` to the draft and focusing the textarea, leaving the send to the user. An existing draft is preserved rather than replaced.

The circle is positioned and colored with literals rather than theme variables: this bundle's stylesheet is applied before the theme's own tokens exist, so a variable it cannot see resolves to nothing and leaves the text unreadable against the shell.

Occupancy comes from the same `contextPressure` projection the composer's own ContextMeter reads, preferring `projectedTokens` so a compaction registers immediately. The ratios, the route's capacity, and its resolved price travel to the browser as the `a2d2Indicator` session projection, because a browser bundle cannot read this plugin's configuration, cannot see which model the session is routed to, and a compiled-in number would not be configurable per deployment. The price is resolved host-side by folding the session's `request/header`: the client has no model identity to look up. When a profile composes no projection registry, or the table prices no matching route, the key or the price is absent and the indicator shows tokens without a cost rather than a guessed figure. The indicator renders nothing until a provider reports both a numerator and a route capacity, so a fresh session shows no circle until its first request.

## A²D² panel

The same browser bundle also registers a better-sidebar tab with id `a2d2-panel` and title **A²D²**. better-sidebar is an optional peer, read softly through `ctx.get('betterSidebar')` and kept out of `inject`: a deployment without it registers the indicator alone and skips the tab rather than failing the whole bundle.

The upper half reads `/a2d2/api/tasks?session=<id>` and shows the tasks in the project that owns the open session's cwd. The browser never sends a path; the host looks up the session, resolves its cwd to a project root with the plugin's normal store rules, and returns `{ root, tasks }`. The route is read-only, GET-only, guarded by the same DSH browser authentication as the consult and config routes, and every failure is a JSON body (`400` invalid session id, `401` not signed in, `403` untrusted, `404` unknown session, `405` non-GET, `409` no working directory, `500` read failure).

Task cards are arranged as a task tree: a task issue whose `parent` points at another returned task issue renders under that parent, while missing parents, cycles, and tasks bound to no task issue stay as roots. Each task card shows state, goal, member sessions, and incoming handoff edges. A task bound to a task issue also shows a line with its issue number, its kind — main task (主任务) when it has no parent, subtask (子任务, with the parent's number) when it has one — and its main session, which opens the same way a member does; while `issue.handoff` is present, the same line carries a **交接中** marker. A task bound to no task issue shows no such line. Members are shaped into a tree from `handoffFrom`; missing parents, non-member parents, and cycle-closing edges become roots rather than hiding a session. The row containing the open session is marked as current. Member titles and clickability come from the shell's session list: a member id present in the list can be opened with `sessions.open`, while a missing one is rendered as a short id and stays inert. A successful empty read says the project has no tasks; a route/read failure is rendered as a failure row.

The lower half shows the subagent model topology rooted at the main session for the currently open session's durable parent chain. It expands known subagent catalogs recursively, so opening a child still shows its siblings, descendants, and main session. It exists because a child's route is otherwise invisible. A session's own model is the one the user picked; a delegated child runs whatever the composition in force when it was created declared, and nothing in the shell surfaces it — so children pinned to another model spend that model's budget unobserved.

Both halves of every row are host folds the browser only reads: the child list from the session list's subagent catalog, and each route from that session's own `a2d2Indicator` projection. That is why `route` is now published with the projection, having previously been a host-side lookup for pricing alone. A client holds no adapter registry, and a child's `request/header` lives in the child's own log and never in its parent's, so no parent-session fold can produce a child's route; this is the feature's only host-side change.

The panel re-reads the task route and the expanded subagent catalogs every five seconds while visible, and does not poll while hidden. Projection updates arrive on their own. A child whose route differs from its own parent is drawn in amber with a `⚠`, and the header reads `N subagents · M running · K off-route`, counted over the whole loaded tree. A child that has not issued a request yet reads "route unknown (no request yet)" rather than a guess.

## Model Experience

### Task aggregation

#### What the model sees

Nothing beyond the `bind_main_session` tool below for ordinary sessions. Tasks, membership, and handoff edges reach no prompt or provider request by themselves. Main sessions are different when the CEO prompt row is composed: see `a2d2:ceo`.

#### Token effect

None. Aggregation writes files and reads them back; it adds no tokens to any request.

#### KV Cache effect

None. No request content changes, so no cache entry is invalidated.

### `a2d2:ceo`

#### What the model sees

Only a task issue's main session receives the scoped `a2d2:ceo` system prompt section. The section is installed when the main-session Agent is created or resumed, and also when a running session is bound through `bind_main_session`. When `/handoff take` promotes a successor, the successor's live Agent receives the section immediately and the source Agent's section is removed. Its text is assembled from packaged `ceo/AGENTS.md` and `ceo/WAKE.md`, global SOUL at `~/.dsh/a2d2/SOUL.md`, and project SOUL at `<projectRoot>/.dsh/a2d2/SOUL.md`. Project SOUL is rendered last and labelled as priority over global SOUL. Missing SOUL files are named in the section instead of being skipped.

#### Token effect

Every request from a main-session CEO carries the rendered section. `ceo/AGENTS.md`, `ceo/WAKE.md`, and both SOUL files are reread on each assembly, so editing a SOUL file changes the next request's tokens. Ordinary sessions receive none of this section.

#### KV Cache effect

The section changes the main session's system prompt prefix. Because SOUL is dynamic, editing either SOUL file invalidates the previous prefix for the next main-session request; stable files then cache normally. Ordinary sessions keep their previous prefix.

### `bind_main_session`

#### What the model sees

One tool definition — name, a three-sentence description, and the `issue`, `parent_issue`, and `title` parameters — in every request of an agent whose profile composes the tools row. A call's result is one line naming the task issue, its parent when there is one, and the task document path; a refused binding returns the refusal reason as the tool error.

#### Token effect

The definition is about 685 characters of JSON, roughly 170 tokens by the four-characters-per-token estimate, on every request. Each call adds its arguments and its one-line result to the session's history.

#### KV Cache effect

The tool list is part of the request prefix, so composing the tools row changes that prefix once. The definition carries no per-session or per-turn content, so later requests reuse the cache as before.

### `open_subtask`

#### What the model sees

Profiles that compose the open-subtask tools row add one tool definition named `open_subtask` to agents that also have `tools`, `a2d2`, `agents`, and `llm`. A successful call returns the new root session id, task issue, parent issue, and selected `provider/model`. The created subtask session receives one ordinary first prompt with only the subtask issue reference, the parent task issue reference, per-reference `gh issue view <number> --comments` read commands to run in the project directory, and the `/grill-with-docs` main-session instruction.

#### Token effect

The tool definition is part of the caller's request prefix when the row is composed. A successful call adds its arguments and result to the caller's history; the created subtask session starts with the short first prompt described above.

#### KV Cache effect

Composing the open-subtask tools row changes the caller's tool-list prefix once. The new root session has its own prompt history and therefore its own cache path.

### `complete_task`

#### What the model sees

Profiles that compose the complete-task tools row add one tool definition named `complete_task` to agents that also have `tools`, `a2d2`, and `agents`. A successful call returns the task document id, task issue number, `done` state, whether a parent was notified, and, when applicable, the parent issue/main session and whether that parent was resumed. If a parent main session exists, that session receives one ordinary notification containing only the child task issue number and the completion summary.

#### Token effect

The tool definition is part of the caller's request prefix when the row is composed. A successful call adds its arguments and compact result to the caller's history; a notified parent session receives the short notification as ordinary conversation history.

#### KV Cache effect

Composing the complete-task tools row changes the caller's tool-list prefix once. The notification changes the parent main session's future prompt history; the task document write does not affect any request prefix by itself.

### `dispatch_subagent`

#### What the model sees

One additional tool definition in every request of an agent whose profile composes the base tools row. A call result names the child session id, actual `provider/model`, and stage Agent (`ceo`, `engineer`, or `reviewer`). Refusals, such as a non-main session caller or no catalog-present model for the stage Agent, return as tool errors. The child session is recorded as that stage Agent before DSH creates it; engineer/reviewer configuration reaches the child through scoped system prompt assembly, not through a `persona` request field.

#### Token effect

The definition is about 820 characters of JSON, roughly 205 tokens by the four-characters-per-token estimate, on every request in a base-tools-row profile. Each call adds its arguments and compact result to the parent session history; the child receives the supplied `prompt` as its first user message.

#### KV Cache effect

Adding the tool changes the tool-list prefix once for profiles that compose the base tools row. Stage Agent settings are read when the tool runs, not embedded in the parent request prefix, so changing them does not invalidate the parent's cache by itself. Engineer/reviewer Agent configuration is read by the child session's scoped system prompt section on each assembly, so changing those files affects that Agent's next request prefix rather than the parent's.

### `github_watch`

#### What the model sees

One additional tool definition in every request of an agent whose profile composes the GitHub watch row. A call result is one sentence: the current state and that a message will follow, or the install link, or that the PR is already finished. Each later change of a watched PR adds one user-role notice to that session: a few lines naming the change, the PR URL, the current state, and whether the watch continues. Nothing reaches sessions that watch nothing.

#### Token effect

The definition is about 590 characters of JSON, roughly 150 tokens by the four-characters-per-token estimate, on every request in a profile with the row. Each notice is about 300–450 characters (≈ 75–110 tokens), once per actual state change. Duplicate and no-op deliveries are dropped by the service and again by the plugin's comparison.

#### KV Cache effect

Adding the tool changes the tool-list prefix once for profiles that compose the row. A notice is appended at the end of the conversation like any user message, so it does not invalidate the cached prefix.

### `/handoff`

#### What the model sees

The command result itself never reaches the model — command results are rendered to the dispatching UI only. Two host-submitted messages do: preparing queues the verbatim handoff skill source plus a parameter envelope as one ordinary prompt of the handing-off session, and taking queues the handoff document's body as the successor's first prompt, both through `agent.followup`. The envelope names the document path and content markers; the successor's message carries the continuation content with the fixed sections around it.

#### Token effect

The successor's first request carries the handoff document body — the continuation content plus the fixed sections — and every later turn of that session carries it too, as ordinary conversation history. Its size is whatever the writing agent produced, bounded by the envelope's approximate 4000-character parameter rather than by a plugin budget. Preparing also adds one turn to the handing-off session's own history, so every later request of that session carries the injected skill source and envelope as well.

#### KV Cache effect

The successor's prompt prefix is new, so its first request populates the cache instead of reading it. The source session's cache is untouched.

### A²D² panel

#### What the model sees

Nothing. The panel is a read-only browser view: it registers no tool, writes no prompt section, and injects no context. Publishing the route changes the projection value a client receives, not the content of any request.

#### Token effect

None. The panel reads task documents through a host route, projection values already in flight, and a catalog response; it adds no tokens to any provider request.

#### KV Cache effect

None. No session's request content changes.

### Notifications

#### What the model sees

Nothing. Notifications observe session events and `complete_task` from the host; they register no tool, write no prompt section, and inject no context.

#### Token effect

None. A push goes to the `notifier` provider, never to a model provider.

#### KV Cache effect

None. No session's request content changes.

## Known Limitations and Deferred Work

- **The indicator cannot place the caret** — it focuses the textarea and appends the command, but no sanctioned caret API exists for an out-of-tree plugin, so the caret position after insertion is the textarea's own.
- **Continuation content is only as good as the turn that wrote it** — the plugin can verify that something was written, never that it is accurate, complete, or free of the secrets the patterns miss. A session that never runs the turn leaves a document `take` refuses.
- **Documents are version 2** — a document written by an earlier build declares version `1`, carried a transcript projection instead of a summary, and is refused rather than read. An existing project has to run `/handoff` again before its handoff is takeable.
- **Recency is approximated** — `resolve` returns the newest `active` task, because a document carries no activity timestamp of its own. Deriving recency from member sessions is the intended refinement.
- **Members are never verified** — the store records session ids and never checks that a session exists, because a document is committable and crosses machines. A consumer must render a member whose session is missing rather than failing on it.
- **Ordinary handoffs are not discoverable from the task** — a task issue can show that its main session is handing off, but `take` still needs the handed-off session id, which the source side prints. No interface lists every non-main handoff for a task or reports whether a handoff document is still unwritten.
- **Host filesystem only** — project-root discovery and document I/O use Node filesystem calls directly rather than `ctx.fs`, so a deployment whose workspace lives behind a provider is not covered yet.
- **Project-root resolution is duplicated** — `resolveProjectRoot` repeats the marker walk that `agent-instructions` already exports as `findProjectRoot`; importing it would drag that package's agent, tool, and LLM dependencies into a store that needs none. Consolidating the walk into a shared utility is the intended follow-up.
- **The subagent list depends on better-sidebar** — the tab can only register into a sidebar that accepts one, so a deployment without better-sidebar has no list at all while the indicator is unaffected. Mounting the same reading on a native DSH seat is the intended follow-up.
- **Subagent descendants are lazy** — the catalog is published per parent, so a newly discovered branch appears after that parent catalog refreshes while the panel is visible.
- **A route comes from the child's own newest `request/header`** — a child shows as unknown until it issues its first request, and the list can never say what a child is running *right now*, only which route its last request used.
- **The catalog is a request, not a stream** — a newly delegated child appears up to five seconds late, and the tab does not refresh while it is not visible.
