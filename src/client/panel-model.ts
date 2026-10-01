/**
 * Pure view model for the A²D² panel's task half.
 *
 * The route supplies project tasks. The shell's session list supplies titles
 * and openability. This module folds those two public reads into rows the React
 * surface can render without knowing task-document details.
 *
 * @module @deepseek-ai/dsh-a2d2/client/panel-model
 */

import type { PanelMember, PanelPayload, PanelTask, PanelTaskIssue } from '../panel-types.ts'
import { rootAncestor, type SubagentSessionSummary } from './subagent-model.ts'

const STATE_LABELS: Readonly<Record<PanelTask['state'], string>> = {
  active: '进行中',
  paused: '已暂停',
  done: '已完成',
}

const SHORT_ID_LENGTH = 8
export const EMPTY_SESSION_TITLE = '空会话（未开始）'
export const PENDING_SESSION_TITLE = '读取标题中'

/** One session-list row field set used to decide a task member label. */
export interface PanelSessionTitleSummary {
  readonly title?: string | null
  /** Host-derived "nothing has happened in this session yet". */
  readonly blank?: boolean
  /** Projection values the list row carries; `sessionStats.turns` is read when present. */
  readonly projectionValues?: Readonly<Record<string, unknown>>
}

/** Cold-read result for a session title history baseline. */
export type SessionTitleHistoryRead =
  | { readonly kind: 'loaded'; readonly title?: string }
  | { readonly kind: 'failed' }

/** Resolved display label for one member session. */
export interface PanelSessionTitle {
  readonly label: string
  readonly title?: string
}

/** The narrow `remote` face used to cold-read a session's projection baseline. */
export interface SessionTitleHistoryApi {
  readonly session: {
    projections(
      payload: { readonly sessionId: string },
      signal?: AbortSignal,
    ): Promise<
      | { readonly ok: true; readonly value: { readonly values?: Readonly<Record<string, unknown>> } | null }
      | { readonly ok: false }
    >
  }
}

/** Subscriber called when a session title loader publishes newly-read titles. */
export type SessionTitleLoaderListener = () => void

/** React-independent lifecycle for cold-reading session title projection baselines. */
export interface SessionTitleLoader {
  /** Submit session ids whose title baselines should be loaded. Already-finished and in-flight ids are ignored. */
  readonly load: (sessionIds: readonly string[]) => void
  /** Read every completed title baseline or failed read, keyed by session id. */
  readonly snapshot: () => Readonly<Record<string, SessionTitleHistoryRead | undefined>>
  /** Subscribe to later snapshot changes. */
  readonly subscribe: (listener: SessionTitleLoaderListener) => () => void
  /** Abort in-flight reads and stop accepting work. */
  readonly dispose: () => void
}

/** One member row in the task list. */
export interface PanelMemberRow {
  readonly sessionId: string
  readonly shortId: string
  readonly label: string
  readonly title?: string
  readonly handoffFrom?: string
  readonly handoffFromLabel?: string
  readonly current: boolean
  readonly openable: boolean
}

/** One node in a task member handoff forest. */
export interface PanelMemberTreeNode {
  readonly row: PanelMemberRow
  readonly children: readonly PanelMemberTreeNode[]
}

/** Whether a task issue is a main task (no parent) or a subtask. */
export type PanelTaskKind = 'main' | 'sub'

const KIND_LABELS: Readonly<Record<PanelTaskKind, string>> = {
  main: '主任务',
  sub: '子任务',
}

/** The task issue line of a bound task row. */
export interface PanelTaskIssueRow {
  readonly number: number
  readonly parent?: number
  readonly kind: PanelTaskKind
  readonly kindLabel: string
  /** The main session, labelled and openable the way member rows are. */
  readonly mainSession: PanelMemberRow
}

/** One task row in the panel. */
export interface PanelTaskRow {
  readonly id: string
  /** Absent for a task bound to no task issue. */
  readonly issue?: PanelTaskIssueRow
  readonly name: string
  readonly goal?: string
  readonly state: PanelTask['state']
  readonly stateLabel: string
  readonly created: string
  readonly current: boolean
  readonly members: readonly PanelMemberRow[]
  readonly handoffs: number
}

/** Header counts for the panel. */
export interface PanelTally {
  readonly total: number
  readonly active: number
  readonly members: number
  readonly current?: PanelTaskRow
}

/** Distinct client load states the panel renders. */
export type PanelLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'loaded' }
  | { readonly kind: 'failed'; readonly message: string }

/** Component-owned task read state. */
export interface PanelClientState {
  readonly payload: PanelPayload | undefined
  readonly failure: string | undefined
}

/** The session identities the task half should use for one opened panel. */
export interface PanelSessionTarget {
  readonly querySessionId: string
  readonly currentMemberSessionId: string
  readonly openedSessionId: string
  readonly openedAsSubagent: boolean
}

/** Result of one host task read, as observed by the panel state machine. */
export type PanelReadResult =
  | { readonly kind: 'ok'; readonly payload: PanelPayload }
  | { readonly kind: 'failed'; readonly message: string }

/** Translate a stored task state into the panel label. */
export function stateLabel(state: PanelTask['state']): string {
  return STATE_LABELS[state]
}

/** Abbreviate a session id for compact member rows. */
export function shortSessionId(id: string): string {
  const unique = id.startsWith('session-') ? id.slice('session-'.length) : id
  return unique.length <= SHORT_ID_LENGTH ? unique : unique.slice(0, SHORT_ID_LENGTH)
}

function cleanTitle(value: string | null | undefined): string | undefined {
  const title = value?.trim()
  return title === undefined || title === '' ? undefined : title
}

function blankSession(row: PanelSessionTitleSummary | undefined): boolean {
  const stats = row?.projectionValues?.sessionStats as { readonly turns?: unknown } | undefined
  return row?.blank === true || stats?.turns === 0
}

function titleFromProjection(value: unknown): string | undefined {
  return typeof value === 'string' ? cleanTitle(value) : undefined
}

function titleEntry(
  id: string,
  list: PanelSessionTitleSummary | undefined,
  history: SessionTitleHistoryRead | undefined,
): PanelSessionTitle {
  const listTitle = cleanTitle(list?.title)
  if (listTitle !== undefined) return { label: listTitle, title: listTitle }
  const historyTitle = history?.kind === 'loaded' ? cleanTitle(history.title) : undefined
  if (historyTitle !== undefined) return { label: historyTitle, title: historyTitle }
  if (blankSession(list)) return { label: EMPTY_SESSION_TITLE, title: EMPTY_SESSION_TITLE }
  if (history?.kind === 'failed') return { label: shortSessionId(id) }
  return { label: PENDING_SESSION_TITLE }
}

/**
 * Resolve every known session title source into a member label.
 *
 * List titles win because they are already the shell's live display value.
 * History titles repair older list rows that lack projections. Blank sessions
 * get a human label, and only a failed cold read falls through to the short id.
 */
export function panelSessionTitles(
  byId: Readonly<Record<string, PanelSessionTitleSummary | undefined>>,
  history: Readonly<Record<string, SessionTitleHistoryRead | undefined>> = {},
  pendingSessionIds: readonly string[] = [],
): Readonly<Record<string, PanelSessionTitle | undefined>> {
  const ids = new Set([...Object.keys(byId), ...Object.keys(history), ...pendingSessionIds])
  const titles: Record<string, PanelSessionTitle> = {}
  for (const id of ids) titles[id] = titleEntry(id, byId[id], history[id])
  return titles
}

/** List task member ids whose title still needs one history cold read. */
export function panelTitleReadCandidates(
  payload: PanelPayload | undefined,
  byId: Readonly<Record<string, PanelSessionTitleSummary | undefined>>,
  history: Readonly<Record<string, SessionTitleHistoryRead | undefined>> = {},
): readonly string[] {
  if (payload === undefined) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const task of payload.tasks) {
    for (const member of task.members) {
      if (seen.has(member.sessionId)) continue
      seen.add(member.sessionId)
      if (cleanTitle(byId[member.sessionId]?.title) !== undefined) continue
      if (history[member.sessionId] !== undefined) continue
      ids.push(member.sessionId)
    }
  }
  return ids
}

/** Create a deduplicating loader for session title baselines. */
export function createSessionTitleLoader(api: SessionTitleHistoryApi): SessionTitleLoader {
  const reads: Record<string, SessionTitleHistoryRead | undefined> = {}
  const completed = new Set<string>()
  const inflight = new Map<string, AbortController>()
  const listeners = new Set<SessionTitleLoaderListener>()
  let disposed = false

  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  const finish = (sessionId: string, read: SessionTitleHistoryRead): void => {
    if (disposed) return
    reads[sessionId] = read
    completed.add(sessionId)
    emit()
  }

  const loadOne = async (sessionId: string, controller: AbortController): Promise<void> => {
    try {
      const response = await api.session.projections({ sessionId }, controller.signal)
      if (disposed || controller.signal.aborted) return
      if (!response.ok) {
        finish(sessionId, { kind: 'failed' })
        return
      }
      const title = titleFromProjection(response.value?.values?.title)
      finish(sessionId, title === undefined ? { kind: 'loaded' } : { kind: 'loaded', title })
    } catch {
      if (!disposed && !controller.signal.aborted) finish(sessionId, { kind: 'failed' })
    } finally {
      inflight.delete(sessionId)
    }
  }

  return {
    load(sessionIds) {
      if (disposed) return
      for (const sessionId of sessionIds) {
        if (completed.has(sessionId) || inflight.has(sessionId)) continue
        const controller = new AbortController()
        inflight.set(sessionId, controller)
        void loadOne(sessionId, controller)
      }
    },
    snapshot() {
      return reads
    },
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const controller of inflight.values()) controller.abort()
      inflight.clear()
      listeners.clear()
    },
  }
}

function createdDate(value: string): string {
  const index = value.indexOf('T')
  return index < 0 ? value : value.slice(0, index)
}

function memberRow(
  member: PanelMember,
  titles: Readonly<Record<string, PanelSessionTitle | string | undefined>>,
  openable: (id: string) => boolean,
  currentSessionId: string,
): PanelMemberRow {
  const ownTitle = titles[member.sessionId]
  const title = typeof ownTitle === 'string' ? cleanTitle(ownTitle) : ownTitle?.title
  const label = typeof ownTitle === 'string' ? (cleanTitle(ownTitle) ?? shortSessionId(member.sessionId)) : (ownTitle?.label ?? shortSessionId(member.sessionId))
  const from = member.handoffFrom
  const fromTitleEntry = from === undefined ? undefined : titles[from]
  const fromTitle = typeof fromTitleEntry === 'string' ? cleanTitle(fromTitleEntry) : fromTitleEntry?.label
  return {
    sessionId: member.sessionId,
    shortId: shortSessionId(member.sessionId),
    label,
    ...(title === undefined ? {} : { title }),
    ...(from === undefined ? {} : { handoffFrom: from }),
    ...(from === undefined ? {} : { handoffFromLabel: fromTitle ?? (from === currentSessionId ? '当前会话' : shortSessionId(from)) }),
    current: member.sessionId === currentSessionId,
    openable: openable(member.sessionId),
  }
}

function issueRow(
  issue: PanelTaskIssue,
  titles: Readonly<Record<string, PanelSessionTitle | string | undefined>>,
  openable: (id: string) => boolean,
  currentSessionId: string,
): PanelTaskIssueRow {
  const kind: PanelTaskKind = issue.parent === undefined ? 'main' : 'sub'
  return {
    number: issue.number,
    ...(issue.parent === undefined ? {} : { parent: issue.parent }),
    kind,
    kindLabel: KIND_LABELS[kind],
    mainSession: memberRow({ sessionId: issue.mainSession }, titles, openable, currentSessionId),
  }
}

function taskRow(
  task: PanelTask,
  titles: Readonly<Record<string, PanelSessionTitle | string | undefined>>,
  openable: (id: string) => boolean,
  currentSessionId: string,
): PanelTaskRow {
  const members = task.members.map(member => memberRow(member, titles, openable, currentSessionId))
  const issue = task.issue
  return {
    id: task.id,
    ...(issue === undefined ? {} : { issue: issueRow(issue, titles, openable, currentSessionId) }),
    name: task.name,
    ...(task.goal === undefined ? {} : { goal: task.goal }),
    state: task.state,
    stateLabel: stateLabel(task.state),
    created: createdDate(task.createdAt),
    current: members.some(member => member.current),
    members,
    handoffs: members.filter(member => member.handoffFrom !== undefined).length,
  }
}

/** Fold a payload into task rows. */
export function panelTaskRows(
  payload: PanelPayload,
  titles: Readonly<Record<string, PanelSessionTitle | string | undefined>>,
  openable: (id: string) => boolean,
  currentSessionId: string,
): readonly PanelTaskRow[] {
  return payload.tasks.map(task => taskRow(task, titles, openable, currentSessionId))
}

/**
 * Resolve which session owns task membership for the opened panel session.
 *
 * Task ownership is main-session scoped. While the host list has not published
 * enough durable parent rows to walk a subagent back to its root, the panel keeps
 * using the opened id and naturally switches when the parent chain arrives.
 */
export function panelSessionTarget(
  byId: Readonly<Record<string, SubagentSessionSummary | undefined>>,
  openedSessionId: string,
): PanelSessionTarget {
  const rootId = rootAncestor(byId, openedSessionId) ?? openedSessionId
  const openedAsSubagent = rootId !== openedSessionId && byId[openedSessionId]?.origin === 'subagent'
  return {
    querySessionId: rootId,
    currentMemberSessionId: rootId,
    openedSessionId,
    openedAsSubagent,
  }
}

/**
 * Shape task members into a handoff forest.
 *
 * Missing parents, non-member parents, self edges, and cycle-closing edges are
 * rooted instead of dropped. The input order remains the sibling order.
 */
export function handoffForest(members: readonly PanelMemberRow[]): readonly PanelMemberTreeNode[] {
  const byId = new Map(members.map(member => [member.sessionId, member]))
  const order = new Map(members.map((member, index) => [member.sessionId, index]))
  const candidateParent = new Map<string, string>()
  for (const member of members) {
    if (member.handoffFrom !== undefined && byId.has(member.handoffFrom) && member.handoffFrom !== member.sessionId) {
      candidateParent.set(member.sessionId, member.handoffFrom)
    }
  }
  const cycleRoots = new Set<string>()
  const finished = new Set<string>()
  for (const member of members) {
    if (finished.has(member.sessionId)) continue
    const path: string[] = []
    const pathIndex = new Map<string, number>()
    let current: string | undefined = member.sessionId
    while (current !== undefined && !finished.has(current)) {
      const seenAt = pathIndex.get(current)
      if (seenAt !== undefined) {
        const cycle = path.slice(seenAt)
        let root = cycle[0]
        if (root === undefined) break
        for (const id of cycle.slice(1)) {
          if ((order.get(id) ?? Number.MAX_SAFE_INTEGER) < (order.get(root) ?? Number.MAX_SAFE_INTEGER)) root = id
        }
        cycleRoots.add(root)
        break
      }
      pathIndex.set(current, path.length)
      path.push(current)
      current = candidateParent.get(current)
    }
    for (const id of path) finished.add(id)
  }

  const childrenByParent = new Map<string, PanelMemberRow[]>()
  const roots: PanelMemberRow[] = []
  for (const member of members) {
    const parentId = candidateParent.get(member.sessionId)
    if (parentId === undefined || cycleRoots.has(member.sessionId)) {
      roots.push(member)
      continue
    }
    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(member)
    childrenByParent.set(parentId, siblings)
  }

  const visit = (row: PanelMemberRow): PanelMemberTreeNode => ({
    row,
    children: (childrenByParent.get(row.sessionId) ?? []).map(visit),
  })
  return roots.map(visit)
}

/** Count task rows for the panel header. */
export function panelTally(rows: readonly PanelTaskRow[]): PanelTally {
  const current = rows.find(row => row.current)
  return {
    total: rows.length,
    active: rows.filter(row => row.state === 'active').length,
    members: rows.reduce((sum, row) => sum + row.members.length, 0),
    ...(current === undefined ? {} : { current }),
  }
}

/** Separate loading, empty, loaded, and failure rendering states. */
export function panelLoadState(payload: PanelPayload | undefined, failure: string | undefined): PanelLoadState {
  if (failure !== undefined) return { kind: 'failed', message: failure }
  if (payload === undefined) return { kind: 'loading' }
  return payload.tasks.length === 0 ? { kind: 'empty' } : { kind: 'loaded' }
}

/** Apply one completed task read to the panel state. */
export function nextPanelState(_state: PanelClientState, result: PanelReadResult): PanelClientState {
  if (result.kind === 'ok') return { payload: result.payload, failure: undefined }
  return { payload: undefined, failure: result.message }
}

function isPanelMember(value: unknown): value is PanelMember {
  if (typeof value !== 'object' || value === null) return false
  const member = value as Partial<PanelMember>
  return typeof member.sessionId === 'string'
    && (member.handoffFrom === undefined || typeof member.handoffFrom === 'string')
}

function isIssueNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isPanelTaskIssue(value: unknown): value is PanelTaskIssue {
  if (typeof value !== 'object' || value === null) return false
  const issue = value as Partial<PanelTaskIssue>
  return isIssueNumber(issue.number)
    && (issue.parent === undefined || isIssueNumber(issue.parent))
    && typeof issue.mainSession === 'string'
}

function isPanelTask(value: unknown): value is PanelTask {
  if (typeof value !== 'object' || value === null) return false
  const task = value as Partial<PanelTask>
  return typeof task.id === 'string'
    && (task.issue === undefined || isPanelTaskIssue(task.issue))
    && typeof task.name === 'string'
    && (task.goal === undefined || typeof task.goal === 'string')
    && (task.state === 'active' || task.state === 'paused' || task.state === 'done')
    && typeof task.createdAt === 'string'
    && Array.isArray(task.members)
    && task.members.every(isPanelMember)
}

/** Parse and validate the route payload shape. */
export function parsePanelPayload(value: unknown): PanelPayload | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const payload = value as Partial<PanelPayload>
  if (typeof payload.root !== 'string' || !Array.isArray(payload.tasks)) return undefined
  if (!payload.tasks.every(isPanelTask)) return undefined
  return { root: payload.root, tasks: payload.tasks }
}
