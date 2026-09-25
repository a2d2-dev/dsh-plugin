/**
 * The orb's one-click handoff orchestration, as a pure function over injected
 * capabilities so every branch is testable without a browser.
 *
 * Three owners share the sequence. This session's own agent writes the summary,
 * because only that session holds the conversation it summarises; the browser
 * creates the successor and switches focus to it, which no host service can do
 * on its behalf; and the host injects the handoff when that successor runs
 * `/handoff take`. Writing takes a whole turn, so the wait between asking for it
 * and creating the successor lives here, on the session's own `running` signal —
 * the host's answer to "this session is in a turn", published over the session
 * transport rather than inferred from a timer or from another plugin's rendered
 * markup. A failure at any step stops the sequence and reports which step
 * failed, so a half-finished handoff never looks like a finished one.
 *
 * @module @deepseek-ai/dsh-a2d2/client/orb-actions
 */

import type {
  ClientCommandResult,
  ClientSessionFace,
  ClientSessionsService,
  ClientWorkspacesService,
} from './context.ts'
import {
  modelCatalogRoutes,
  stationRouteDecision,
} from './consult-actions.ts'
import type {
  ClientModelDirectoryService,
  ConsultNewSessionModelTarget,
} from './consult-actions.ts'

/** What one confirmed handoff produced, or where it stopped. */
export type OrbHandoffOutcome =
  | { readonly ok: true; readonly successor: string }
  | { readonly ok: false; readonly stage: OrbHandoffStage; readonly error: string }

/** The step a failed handoff stopped at, named so the message can locate it. */
export type OrbHandoffStage = 'prepare' | 'summary' | 'workspace' | 'create' | 'take'

/**
 * How long the writing turn may take to start.
 *
 * The command is admitted before the host publishes the run, so the orb waits
 * for the turn to appear; a budget that expires here means the session never
 * picked the prompt up at all.
 */
export const ORB_TURN_START_TIMEOUT_MS = 30_000

/** How long the writing turn may take once it started, before the orb gives up. */
export const ORB_TURN_TIMEOUT_MS = 600_000

/** The capabilities the orchestration needs, injected so tests supply doubles. */
export interface OrbHandoffDeps {
  /** The sessions service, for driving both sessions and switching focus. */
  readonly sessions: ClientSessionsService
  /** The workspaces service, for finding the workspace and creating the successor. */
  readonly workspaces: ClientWorkspacesService
  /** Milliseconds to wait for the writing turn to start. */
  readonly startTimeoutMs?: number
  /** Milliseconds to wait for the writing turn to end once it started. */
  readonly turnTimeoutMs?: number
  /** Optional shared model directory service for selecting the successor's next-station model. */
  readonly modelDirectories?: ClientModelDirectoryService
  /** The next-station model target that should be selected on the successor before take. */
  readonly successorModel?: ConsultNewSessionModelTarget
  /** Non-fatal user-facing status reporter. */
  readonly notify?: (message: string) => void
}

/** How a wait for the writing turn ended. */
export type WritingTurnWait = 'finished' | 'never-started' | 'timeout'

/**
 * Find the workspace id that accounts a session.
 * @param workspaces - the workspaces service.
 * @param sessionId - the session to locate.
 * @returns the owning workspace id, or `undefined` when no workspace lists it.
 */
export function workspaceOf(workspaces: ClientWorkspacesService, sessionId: string): string | undefined {
  const items = workspaces.list.getSnapshot().items
  return items.find(item => item.sessionIds.includes(sessionId))?.workspaceId
}

/**
 * The `/handoff` line that starts a handoff of the orb's own session.
 *
 * The focus is free text to the command's grammar, so it is flattened onto one
 * line: the composer's newlines would otherwise split the invocation.
 * @param focus - what the successor session is for, absent for a generic handoff.
 * @returns the command line to run on the handing-off session.
 */
export function handoffLine(focus: string | undefined): string {
  const trimmed = focus?.trim()
  if (trimmed === undefined || trimmed === '') return '/handoff'
  return `/handoff ${trimmed.replace(/\s+/gu, ' ')}`
}

/**
 * Wait until the writing turn has run and finished.
 *
 * Two waits, because one is not enough: the turn may not have started when the
 * command was admitted, and a session that is idle now will stay idle until it
 * does — so the first wait is for the run to appear and the second for it to
 * end. Both read the same `running` fact, and both are bounded, so a session
 * that never runs the turn and a session that never stops it are reported
 * differently instead of hanging the orb.
 * @param session - the handing-off session's face.
 * @param deps - the injected budgets.
 * @returns how the wait ended.
 */
export async function awaitWritingTurn(
  session: ClientSessionFace,
  deps: Pick<OrbHandoffDeps, 'startTimeoutMs' | 'turnTimeoutMs'>,
): Promise<WritingTurnWait> {
  const started = await waitFor(
    () => session.getSnapshot().running,
    session,
    deps.startTimeoutMs ?? ORB_TURN_START_TIMEOUT_MS,
  )
  if (!started) return 'never-started'
  const finished = await waitFor(
    () => !session.getSnapshot().running,
    session,
    deps.turnTimeoutMs ?? ORB_TURN_TIMEOUT_MS,
  )
  return finished ? 'finished' : 'timeout'
}

/** Resolve true when the predicate holds, false when the budget expires first. */
function waitFor(
  predicate: () => boolean,
  session: ClientSessionFace,
  timeoutMs: number,
): Promise<boolean> {
  if (predicate()) return Promise.resolve(true)
  return new Promise<boolean>(resolve => {
    let unsubscribe: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      // A subscriber that fires during `subscribe` runs before the disposer is
      // assigned, which is why this is optional rather than captured.
      if (unsubscribe !== undefined) unsubscribe()
      resolve(value)
    }
    timer = setTimeout(() => finish(false), timeoutMs)
    unsubscribe = session.subscribe(() => {
      if (predicate()) finish(true)
    })
  })
}

/**
 * Run the one-click handoff for the session the orb sits on.
 * @param deps - the injected capabilities.
 * @param sessionId - the current session, handed off from.
 * @param focus - what the successor session is for, absent for a generic handoff.
 * @returns the successor session id, or the stage and message of the failure.
 */
export async function runOrbHandoff(
  deps: OrbHandoffDeps,
  sessionId: string,
  focus: string | undefined,
): Promise<OrbHandoffOutcome> {
  const current = deps.sessions.binding(sessionId)
  if (current === undefined) {
    return { ok: false, stage: 'prepare', error: 'this session is not addressable yet' }
  }

  const line = handoffLine(focus)
  let asked: ClientCommandResult
  try {
    asked = await current.session.command(line)
  } catch (error: unknown) {
    return { ok: false, stage: 'prepare', error: messageOf(error) }
  }
  if (!asked.ok) {
    return { ok: false, stage: 'prepare', error: `this session refused \`${line}\`` }
  }

  const written = await awaitWritingTurn(current.session, deps)
  if (written !== 'finished') {
    return { ok: false, stage: 'summary', error: summaryError(written) }
  }

  const workspaceId = workspaceOf(deps.workspaces, sessionId)
  if (workspaceId === undefined) {
    return { ok: false, stage: 'workspace', error: 'this session belongs to no workspace, so no successor can be created' }
  }

  let successor: string
  try {
    successor = await deps.workspaces.connectWorkspace(workspaceId)
  } catch (error: unknown) {
    return { ok: false, stage: 'create', error: messageOf(error) }
  }

  const binding = deps.sessions.binding(successor)
  if (binding === undefined) {
    return { ok: false, stage: 'create', error: 'the successor session was created but is not yet addressable' }
  }

  await selectSuccessorModel(deps, successor)

  // Focus the successor before it runs the take, so the user watches the
  // handoff land in the session they were switched to.
  deps.sessions.open(successor)

  // Carry the handing-off session's title to the successor so a handoff chain
  // reads as one named piece of work. Non-fatal: a session with no title, or a
  // rejected rename, leaves the successor on its automatic title rather than
  // stopping a handoff whose summary already landed.
  const inherited = inheritedTitle(deps.sessions, sessionId)
  if (inherited !== undefined) {
    try {
      await binding.session.rename(nextTitle(inherited))
    } catch {
      // A rename failure is a title-only loss; the successor keeps its automatic
      // title and the handoff proceeds to the take below.
    }
  }

  let taken: ClientCommandResult
  try {
    taken = await binding.session.command(`/handoff take ${sessionId}`)
  } catch (error: unknown) {
    return { ok: false, stage: 'take', error: messageOf(error) }
  }
  if (!taken.ok) {
    return {
      ok: false,
      stage: 'take',
      error: `the successor session refused \`/handoff take ${sessionId}\``,
    }
  }

  return { ok: true, successor }
}

async function selectSuccessorModel(deps: OrbHandoffDeps, successor: string): Promise<void> {
  const target = deps.successorModel
  if (target?.station === undefined || target.stationModels === undefined) return
  if (deps.modelDirectories === undefined) {
    deps.notify?.('选择后继会话模型失败：模型目录服务不可用')
    return
  }
  try {
    const face = deps.modelDirectories.directoryFor(successor)
    const directory = await face.load()
    const decision = stationRouteDecision({
      station: target.station,
      stationModels: target.stationModels,
      catalog: modelCatalogRoutes(directory),
      current: directory.current,
    })
    if (decision.kind === 'switch') await face.select(decision.selection)
  } catch (error) {
    deps.notify?.(`选择后继会话模型失败：${messageOf(error)}`)
  }
}

/** The message one ended-not-finished wait reports. */
function summaryError(wait: Exclude<WritingTurnWait, 'finished'>): string {
  return wait === 'never-started'
    ? 'this session never started writing the summary, so no handoff was recorded'
    : 'this session is still writing the summary; take the handoff again once it finishes'
}

/** One error's message, whatever its type. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The handing-off session's current display title, or `undefined` when it has
 * none to carry.
 *
 * Read from the session list store, the client's own record of every host row's
 * folded title; a blank title is treated as absent so the successor is not
 * renamed to nothing.
 * @param sessions - the sessions service.
 * @param sessionId - the handing-off session.
 * @returns the non-blank source title, or `undefined`.
 */
export function inheritedTitle(sessions: ClientSessionsService, sessionId: string): string | undefined {
  const title = sessions.list.getSnapshot().byId[sessionId]?.title?.trim()
  return title === undefined || title === '' ? undefined : title
}

/**
 * The successor's title: the source title with its trailing number incremented,
 * matching how a fork numbers a peer so a handoff chain does not read as several
 * sessions with one identical name.
 *
 * A trailing ASCII or fullwidth parenthesized number is incremented in its own
 * style; an unnumbered title gains ` (1)`.
 * @param title - the inherited source title.
 * @returns the numbered successor title.
 */
export function nextTitle(title: string): string {
  const ascii = /^(.*)\((\d+)\)$/u.exec(title)
  if (ascii !== null) return `${ascii[1]}(${Number(ascii[2]) + 1})`
  const fullwidth = /^(.*)（(\d+)）$/u.exec(title)
  if (fullwidth !== null) return `${fullwidth[1]}（${Number(fullwidth[2]) + 1}）`
  return `${title} (1)`
}
