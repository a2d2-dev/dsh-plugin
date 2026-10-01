# Wake Checklist

Run this checklist at every wakeup. Finish each step before moving to the next one.

## 1. Name the Wake Source

Classify the wakeup as one of:

- DSH subagent settlement: a dispatched child finished and returned a report.
- A2D2 subtask completion: `complete_task` notified this parent main session.
- LF message: LF supplied new input, an answer, an interrupt, or a correction.

Completion: the source type, payload, mentioned issue numbers, and mentioned session ids are identified.

## 2. Rehydrate Durable State

Read the task issue with `gh issue view <issue> --comments`. Use the body status block for current station, main session, open questions, and active handoffs; use the latest timeline comments for dispatches, decisions, handoffs, and results.

Read child issue state with `gh` for every child relevant to the current step. Check labels to distinguish `a2d2:sub` root subtasks from `ready-for-agent` implementation subtasks.

Read the project A2D2 task documents or panel state for the recorded main session, parent issue, handoff edge, task completion state, and known subagent sessions. Inspect the relevant child session/report when the wake source names one.

Completion: current station, parent/child issue state, main session, handoff state, active delegates, and next unblocked work are known from durable sources.

## 3. Handle the Source

For a DSH subagent settlement, verify the report before accepting it: inspect git state, commits, diff base, command output, artifacts, PR state, and issue status. Then record the subagent result on the task issue, decide whether review, rework, accounting, or closure is next, and dispatch or act accordingly.

For an A2D2 subtask completion, read the child issue and any linked PR/result evidence, confirm the child task is actually accepted, then update the parent issue timeline with the child result. Continue with the next unblocked child, parent-level review, or parent completion.

For an LF message, apply the new information to the current task state. If it answers an open question, closes a decision, changes scope, or redirects the station, sync the task issue in the matching category below before continuing.

Completion: the wake source has produced exactly one next state: accepted result, rework dispatch, review dispatch, opened subtask, station continuation, handoff, completion, or a specific pending LF answer required by SOUL.

## 4. Sync the Task Issue

Keep the issue body status current: current station, main session, unresolved questions, active child work, handoff state, and the next intended action.

Write timeline comments only for these five categories:

- Station switch: from station, to station, reason, and route source.
- One-way-door Q&A: question, LF answer, and resulting action.
- Decision: link `CONTEXT.md` or an ADR; summarize only the pointer and effect.
- Handoff: source session, successor session when known, and handoff document path.
- Subagent dispatch/result: issue, station, Agent kind, session id, branch or PR, verification evidence, and outcome.

Completion: the body status and any needed timeline comment match the durable state, with no process transcript copied into the issue.

## 5. Choose and Execute the Next Move

Continue design work in the main session while the task is in grill, to-spec, or to-tickets.

For a ready implementation/review/diagnosis child, call `dispatch_subagent` with a prompt built from `ceo/DISPATCH_TEMPLATES.md` and the current issue evidence.

For a child that still needs design, create the GitHub issue, attach it under the parent, label it `a2d2:sub`, comment the parent handoff/spec pointer as needed, then call `open_subtask`.

For accepted work, close the task issue with `gh` after final evidence is synced, then call `complete_task` so the parent main session wakes.

For a main-session handoff, prepare the handoff only after the task issue points to the current durable state; the successor can resume from the issue and handoff document.

Completion: a tool call, `gh` update, dispatch, handoff, or direct reply has been executed, or the session is explicitly waiting on the named LF answer required by SOUL.
