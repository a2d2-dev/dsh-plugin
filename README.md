# dsh-a2d2

English | [中文](README.zh.md)

This repository holds the **A²D² DeepSeek Harness plugin**: the components that land A²D² inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) as one installable plugin.

**A²D² — Agentic Agile Driven Development — is a development methodology** that hands the rhythm of agile development to agents: a high-quality model chairs architecture and decisions, a multi-model orchestration carries execution, and the sessions of one piece of work stay tied together as it moves. The methodology is larger than this plugin (it spans workflow skills and multi-model orchestration too); this repository is only its concrete landing on the DSH side. As that landing grows, further DSH-side components live here under the same `a2d2` namespace.

What the plugin gives DSH today:

- **Task aggregation** — a task groups the sessions belonging to one piece of work and records the handoff edges between them, so related sessions keep a relationship a person can read, review, and commit. The data lives in project-local documents, and no session's durable format changes to carry it.
- **Session handoff** — `/handoff` moves work from a long, expensive session to a fresh one without losing the thread: the handing-off session writes bounded continuation content, and the successor continues from it.
- **A floating indicator** — an at-a-glance orb by the composer that tracks context length and cost, and warns when a session approaches the smart zone so the next phase boundary can choose its outcome.

> `A²D²` is the brand and display form; `a2d2` is the technical identifier — package name, directories, and service names all use it, because `²` cannot appear in an npm package name. The package is `@deepseek-ai/dsh-a2d2`.

The rest of this document is the plugin's behavior contract and known limits, kept per component below.

## Plugin (namespace: `a2d2`)

The package contributes two mount rows. `ctx.a2d2` is the task store and declares no service, so it loads in any profile; the command row declares `commands` and `a2d2`, so only a profile that composes both gets `/handoff`. Cordis refuses to load a plugin whose declared services are absent, which is why the two are split rather than registered conditionally from one row. The floating orb needs no row of its own: it drives that same command through the session it already sits on.

```yaml
- id: a2d2
  name: '@deepseek-ai/dsh-a2d2'
- id: a2d2-command
  name: '@deepseek-ai/dsh-a2d2/command'
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

The configuration keys belong to the `a2d2` row. Every method takes the caller's session cwd and resolves the project root itself, so callers carry no project bookkeeping. `list` reads the project's tasks, `resolve` returns the task a new session inherits, `create` mints an id and writes a document, `registerMember` records a session as a member with an optional handoff edge, and `prepareHandoff` / `takeHandoff` write and consume a handoff document.

### Station model settings

The plugin also registers a live settings namespace, `a2d2-station-models`, stored in DSH's `settings.yaml`. It is separate from the plugin row above because users should be able to reorder station model candidates without restarting the host.

```yaml
a2d2-station-models:
  consult:
    - claude-bray/claude-fable-5-1
    - codex/gpt-6
  stations:
    grill:
      - claude-bray/claude-fable-5-1
      - codex/gpt-6
    implement:
      - codex/gpt-5.5
      - claude-bray/claude-opus-5-5
```

`consult` and every station entry are ordered `provider/model` candidate lists. Empty lists and malformed routes are rejected by the settings schema. Thinking stations (`grill`, `to-spec`, `to-tickets`, `code-review`, `triage`, `wayfinder`, `improve-codebase-architecture`) default to `claude-bray/claude-fable-5-1` then `codex/gpt-6`; coding stations (`implement`, `prototype`, `diagnosing-bugs`) default to `codex/gpt-5.5` then `claude-bray/claude-opus-5-5`. `handoff`, roadbed, and standalone skills are intentionally not listed because this ticket does not switch models for them. If `code-review` and `implement` share the same first candidate the host logs a warning, but keeps the setting.

### A2D2 configuration page

The browser bundle registers an independent DSH settings section, **A2D2 配置**. Its first block, **Matt 流程**, reuses the highway map drawing and shows the main road, ramps, service areas, roadbed, and standalone area. The model table then lets the user edit ordered candidates for configurable stations plus the separate `consult` row; `handoff`, roadbed stations, and standalone skills are shown as `不切模型`.

The page never writes arbitrary settings namespaces from the browser. It calls this plugin's own trusted route, `/a2d2/api/config`, which uses the same host/origin/fetch trust fence as the next-step consult route and exposes only `a2d2-station-models`. Requests are capped at 64 KiB, invalid JSON is rejected, and writes must include the revision returned by a completed read. Saves replace the whole station model table with that revision; a missing revision is rejected without writing, a stale save is rejected as a conflict, the page reloads the latest value, and schema failures such as an empty list or malformed route are reported without persisting anything.

Model candidates are added from DSH's host model catalog (`llm.models`) so the page cannot create a typo-only route. Each existing candidate has a **Test** action that performs exactly one tiny host-side call (`reply OK`, small output budget) and classifies the result as normal, refusal, rate-limited, or error with the reason; an empty response is reported as error. There is no background probing.

## Task documents

One YAML document per task, under `<projectRoot>/.dsh/a2d2/tasks/<id>.yaml`. `<projectRoot>/.dsh/` is the established project-local root — the same anchor `skill-filesystem` uses for `.dsh/skills` — and the plugin's short name namespaces this store, keeping the plugin's footprint one directory even when it later owns further kinds of state.

```yaml
version: 1
id: ship-the-store
name: Ship the store
goal: land phase one
state: active
createdAt: 2026-09-20T00:00:00.000Z
sessions:
  - id: session-a
  - id: session-b
    handoffFrom: session-a
```

A document is a file a person may hand-edit and commit, so validation runs at that boundary and fails loudly rather than degrading: an unsupported `version`, an `id` that disagrees with the filename, an unknown `state`, a blank name, or a non-sequence `sessions` each reject the document instead of yielding an empty task. A missing tasks directory is valid empty state, and `list` does not swallow a malformed document that a person can see in their own working tree.

Writes are atomic and serialized through the document's own file lock. `create` derives the id from the name; a name with no ASCII stem (for example a Chinese one) falls back to a timestamp stem, because the id only has to be unique and safe while the name a person reads lives in the document.

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

Opening the card also requests a one-off consultation for the current session, without adding a consultation turn to session history. New hosts return a highway location (`zone`, `station`, `phaseDone`, and optional `returnTo`), a recommended next station and move, and 2-4 move-labeled candidates. The card renders the status block first, then a vertical mini highway for the main Matt road (`grill` -> `to-spec` -> `to-tickets` -> `implement` -> `code-review`), with passed/current/next/ahead state, Chinese station roles, and the first station model candidate that is present in this session's DSH model directory. Service areas and ramps show notes such as "绕道中：prototype，完成后 handoff 回 grill" or "匝道：wayfinder，并入 to-spec"; standalone and off-road locations show a placard instead of highlighting the main road. Under the map, the next line reads like `→ /to-spec · Continue（reason）· fable-5-1`, or `本阶段未完成 · 继续` while `phaseDone` is false. Older hosts that do not return `location` still degrade to the old one-sentence **当前位置** plus chips.

When the `a2d2-orchestrator` skill is installed, the host quotes only its front-matter description to the consultation; if the current context shows `ready-for-agent` tickets ready to implement, the model is asked to include one **编排实施全部工单** chip beside the per-ticket `/implement` chip. That chip is an ordinary `move: "continue"` candidate for the `implement` station, so it follows the same composer-fill behavior and model-switch rules as any other continue chip. The former `ceo-team` skill directory is still read as a fallback when `a2d2-orchestrator` is absent.

The host also checks the project that owns the session cwd before asking the model: either `CONTEXT.md` or `CONTEXT-MAP.md` must exist, and `docs/agents/issue-tracker.md` must exist. The response carries `preconditions.missing`, and the prompt envelope records the same host fact so the model does not have to infer setup state. When anything is missing, the card shows a top placard, **首次使用前：/setup-matt-pocock-skills**, listing the missing items. The host also forces `/setup-matt-pocock-skills` to the first chip after parsing the model output; if the model already proposed it, that chip is moved to the front, otherwise it is inserted, and the list is capped at four chips. Configured projects and older hosts with no `preconditions` field show no setup placard.

The consultation does not reuse the current session route: it tries the `a2d2-station-models.consult` candidates in order, falling back on provider errors, rate limits, refusals, or empty output. Malformed non-empty JSON is not retried because that is a protocol failure, not route availability. The response includes `answeredBy`, `fallbacks`, and the current station model table; the card footer shows "由 X 生成" and names the fallback reason when one occurred. A continue chip shows its side effect up front: `切到 X` when the first directory-present station candidate differs from the current session model, otherwise `保持当前模型`. Clicking it selects that model through the shared DSH `modelDirectories` service before filling and focusing the composer; if the service is missing or selection fails, the chip still fills the composer and reports the reason. A subagent chip never changes this session's model, but appends `子代理使用 X` to the filled input when the directory can resolve the target station model. A clear chip shows `新会话 · X` (or `新会话 · 默认模型` when no target station candidate is present), creates a blank session in the same workspace, selects the target station model against that new session's own directory, opens it, and fills that session's composer; if session creation or a required model-directory capability is missing, it falls back to filling this session and reports why. Compact and handoff chips open the existing handoff card, with compact using a "保留什么" focus prompt and both carrying the next-station model target into the confirmed handoff. Chips never call the session command face or send on the user's behalf.

The bottom of the boundary card has an always-available **其他走法** foldout. It lists the non-continue moves — clear, subagent, compact, and handoff — as general entrances. Clear follows the same blank-session sequence as a clear chip, but without a station target it keeps the new session's default model; subagent prepares editable composer text; compact and handoff open the handoff card. This keeps handoff reachable without putting it back on the orb as a peer to **下一步**.

The card explicitly shows loading and route errors. If the host could not read the `ask-matt` skill, it still returns degraded candidates and the card marks them with **未读到 ask-matt skill**. If generation fails, the route's error message is shown and the consultation can be retried; every request replaces the prior candidate state instead of accumulating chips.

### One-click handoff

The handoff card is opened from a handoff or compact chip, or from **其他走法**. It is a confirm card the plugin draws itself (no DSH command modal exists): a focus field and **创建并交接** / **取消**. Confirming performs the whole handoff in one gesture — it no longer fills the composer and waits for a send:

1. the browser runs `/handoff <focus>` on the session it sits on, through that session's own command face, which is what makes the host write the skeleton and queue the turn that writes the continuation content;
2. the browser waits for that turn, reading the session's own `running` state over the session transport — not a timer, and not another plugin's rendered DOM, either of which would report the session as finished at the wrong moment;
3. the browser finds the session's workspace and `connectWorkspace`s a fresh successor session;
4. when a handoff or compact chip carried a next-station target, the browser reads `modelDirectories.directoryFor(successor)`, selects the first configured station model present in that successor's catalog, and reports any selection failure without stopping the handoff;
5. the browser focuses the successor session;
6. the successor inherits the handing-off session's title, incremented in the same style a fork numbers a peer (`Ship the store` → `Ship the store (1)`), so a handoff chain reads as one named piece of work rather than several sessions with an identical name. A source with no title, or a rejected rename, leaves the successor on its automatic title — a title-only loss never stops a handoff whose continuation content already landed;
7. the successor runs `/handoff take <session-id>`, which is what makes the host inject the continuation content as its first prompt.

A wait that ends without the turn having run, or with it still running, stops the sequence and names the step that failed; the take would refuse an unwritten summary anyway, so a half-finished handoff cannot look like a finished one. The orb reaches only services the client already composes — the session face and the workspaces service — and needs no host route of its own, so the gesture adds no HTTP surface. When the session belongs to no workspace there is no successor to create, and when either service is absent the orb falls back to the older behavior of appending the literal `/handoff ` to the draft and focusing the textarea, leaving the send to the user. An existing draft is preserved rather than replaced.

The circle is positioned and colored with literals rather than theme variables: this bundle's stylesheet is applied before the theme's own tokens exist, so a variable it cannot see resolves to nothing and leaves the text unreadable against the shell.

Occupancy comes from the same `contextPressure` projection the composer's own ContextMeter reads, preferring `projectedTokens` so a compaction registers immediately. The ratios, the route's capacity, and its resolved price travel to the browser as the `a2d2Indicator` session projection, because a browser bundle cannot read this plugin's configuration, cannot see which model the session is routed to, and a compiled-in number would not be configurable per deployment. The price is resolved host-side by folding the session's `request/header`: the client has no model identity to look up. When a profile composes no projection registry, or the table prices no matching route, the key or the price is absent and the indicator shows tokens without a cost rather than a guessed figure. The indicator renders nothing until a provider reports both a numerator and a route capacity, so a fresh session shows no circle until its first request.

## Subagent models (task management plus)

The same browser bundle also registers a sidebar tab with better-sidebar: it lists every direct child of the open session together with the model that child is *actually* routed to.

It exists because a child's route is otherwise invisible. A session's own model is the one the user picked; a delegated child runs whatever the composition in force when it was created declared, and nothing in the shell surfaces it — so children pinned to another model spend that model's budget unobserved.

Both halves of every row are host folds the browser only reads: the child list from the session list's subagent catalog, and each route from that session's own `a2d2Indicator` projection. That is why `route` is now published with the projection, having previously been a host-side lookup for pricing alone. A client holds no adapter registry, and a child's `request/header` lives in the child's own log and never in its parent's, so no parent-session fold can produce a child's route; this is the feature's only host-side change.

Only the catalog is asked for: the host publishes it per selected parent rather than streaming it, so the tab re-requests it every five seconds while visible. Projection updates arrive on their own. A row whose route differs from the session's own is drawn in amber with a `⚠`, and the header reads `N subagents · M running · K off-route`. A child that has not issued a request yet reads "route unknown (no request yet)" rather than a guess.

better-sidebar is an optional peer, read softly through `ctx.get('betterSidebar')` and kept out of `inject`: a deployment without it registers the indicator alone and skips this tab rather than failing the whole bundle. The added host surface area is zero — no new route, no new RPC, and no change to `webServer`'s HTTP surface.

## Model Experience

### Task aggregation

#### What the model sees

Nothing. Tasks, membership, and handoff edges reach no prompt, tool schema, or provider request; the model cannot observe which task its session belongs to.

#### Token effect

None. Aggregation writes files and reads them back; it adds no tokens to any request.

#### KV Cache effect

None. No request content changes, so no cache entry is invalidated.

### `/handoff`

#### What the model sees

The command result itself never reaches the model — command results are rendered to the dispatching UI only. Two host-submitted messages do: preparing queues the verbatim handoff skill source plus a parameter envelope as one ordinary prompt of the handing-off session, and taking queues the handoff document's body as the successor's first prompt, both through `agent.followup`. The envelope names the document path and content markers; the successor's message carries the continuation content with the fixed sections around it.

#### Token effect

The successor's first request carries the handoff document body — the continuation content plus the fixed sections — and every later turn of that session carries it too, as ordinary conversation history. Its size is whatever the writing agent produced, bounded by the envelope's approximate 4000-character parameter rather than by a plugin budget. Preparing also adds one turn to the handing-off session's own history, so every later request of that session carries the injected skill source and envelope as well.

#### KV Cache effect

The successor's prompt prefix is new, so its first request populates the cache instead of reading it. The source session's cache is untouched.

### Subagent models

#### What the model sees

Nothing. The tab is a read-only browser view: it registers no tool, writes no prompt section, and injects no context, and a child is never told it is being observed. Publishing the route changes the projection value a client receives, not the content of any request.

#### Token effect

None. The list reads projection values already in flight and a catalog response, and adds no tokens to any provider request.

#### KV Cache effect

None. No session's request content changes.

## Known Limitations and Deferred Work

- **No task sidebar** — tasks are visible only in their documents; nothing lists a project's tasks or a task's members in the shell. The floating orb now creates the successor session and switches focus (through `connectWorkspace` + `sessions.open`, not a `session.create` the browser lacks), so a one-click handoff no longer needs two pasted lines, but a session that belongs to no workspace still has no successor to create and falls back to filling the draft.
- **The indicator cannot place the caret** — it focuses the textarea and appends the command, but no sanctioned caret API exists for an out-of-tree plugin, so the caret position after insertion is the textarea's own.
- **Continuation content is only as good as the turn that wrote it** — the plugin can verify that something was written, never that it is accurate, complete, or free of the secrets the patterns miss. A session that never runs the turn leaves a document `take` refuses.
- **Documents are version 2** — a document written by an earlier build declares version `1`, carried a transcript projection instead of a summary, and is refused rather than read. An existing project has to run `/handoff` again before its handoff is takeable.
- **Recency is approximated** — `resolve` returns the newest `active` task, because a document carries no activity timestamp of its own. Deriving recency from member sessions is the intended refinement.
- **Members are never verified** — the store records session ids and never checks that a session exists, because a document is committable and crosses machines. A consumer must render a member whose session is missing rather than failing on it.
- **A handoff is not discoverable from the task** — `take` needs only the handed-off session id, which the source side prints, but nothing lists a task's open handoffs or reports that one is still unwritten.
- **Host filesystem only** — project-root discovery and document I/O use Node filesystem calls directly rather than `ctx.fs`, so a deployment whose workspace lives behind a provider is not covered yet.
- **Project-root resolution is duplicated** — `resolveProjectRoot` repeats the marker walk that `agent-instructions` already exports as `findProjectRoot`; importing it would drag that package's agent, tool, and LLM dependencies into a store that needs none. Consolidating the walk into a shared utility is the intended follow-up.
- **The subagent list depends on better-sidebar** — the tab can only register into a sidebar that accepts one, so a deployment without better-sidebar has no list at all while the indicator is unaffected. Mounting the same reading on a native DSH seat is the intended follow-up.
- **The subagent list covers direct children only** — the catalog is published per selected parent, so descendants nested below a child are absent even though the host can enumerate the whole tree.
- **A route comes from the child's own newest `request/header`** — a child shows as unknown until it issues its first request, and the list can never say what a child is running *right now*, only which route its last request used.
- **The catalog is a request, not a stream** — a newly delegated child appears up to five seconds late, and the tab does not refresh while it is not visible.
