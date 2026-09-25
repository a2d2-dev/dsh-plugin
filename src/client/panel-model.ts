/**
 * Pure view model for the A²D² panel's task half.
 *
 * The route supplies project tasks. The shell's session list supplies titles
 * and openability. This module folds those two public reads into rows the React
 * surface can render without knowing task-document details.
 *
 * @module @deepseek-ai/dsh-a2d2/client/panel-model
 */

import type { PanelMember, PanelPayload, PanelTask } from '../panel-types.ts'

const STATE_LABELS: Readonly<Record<PanelTask['state'], string>> = {
  active: '进行中',
  paused: '已暂停',
  done: '已完成',
}

const SHORT_ID_LENGTH = 8

/** One member row in the task list. */
export interface PanelMemberRow {
  readonly sessionId: string
  readonly shortId: string
  readonly title?: string
  readonly handoffFrom?: string
  readonly handoffFromLabel?: string
  readonly current: boolean
  readonly openable: boolean
}

/** One task row in the panel. */
export interface PanelTaskRow {
  readonly id: string
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

/** Translate a stored task state into the panel label. */
export function stateLabel(state: PanelTask['state']): string {
  return STATE_LABELS[state]
}

/** Abbreviate a session id for compact member rows. */
export function shortSessionId(id: string): string {
  const unique = id.startsWith('session-') ? id.slice('session-'.length) : id
  return unique.length <= SHORT_ID_LENGTH ? unique : unique.slice(0, SHORT_ID_LENGTH)
}

function createdDate(value: string): string {
  const index = value.indexOf('T')
  return index < 0 ? value : value.slice(0, index)
}

function memberRow(
  member: PanelMember,
  titles: Readonly<Record<string, string | undefined>>,
  openable: (id: string) => boolean,
  currentSessionId: string,
): PanelMemberRow {
  const title = titles[member.sessionId]
  const from = member.handoffFrom
  const fromTitle = from === undefined ? undefined : titles[from]
  return {
    sessionId: member.sessionId,
    shortId: shortSessionId(member.sessionId),
    ...(title === undefined ? {} : { title }),
    ...(from === undefined ? {} : { handoffFrom: from }),
    ...(from === undefined ? {} : { handoffFromLabel: fromTitle ?? (from === currentSessionId ? '当前会话' : shortSessionId(from)) }),
    current: member.sessionId === currentSessionId,
    openable: openable(member.sessionId),
  }
}

function taskRow(
  task: PanelTask,
  titles: Readonly<Record<string, string | undefined>>,
  openable: (id: string) => boolean,
  currentSessionId: string,
): PanelTaskRow {
  const members = task.members.map(member => memberRow(member, titles, openable, currentSessionId))
  return {
    id: task.id,
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
  titles: Readonly<Record<string, string | undefined>>,
  openable: (id: string) => boolean,
  currentSessionId: string,
): readonly PanelTaskRow[] {
  return payload.tasks.map(task => taskRow(task, titles, openable, currentSessionId))
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

function isPanelMember(value: unknown): value is PanelMember {
  if (typeof value !== 'object' || value === null) return false
  const member = value as Partial<PanelMember>
  return typeof member.sessionId === 'string'
    && (member.handoffFrom === undefined || typeof member.handoffFrom === 'string')
}

function isPanelTask(value: unknown): value is PanelTask {
  if (typeof value !== 'object' || value === null) return false
  const task = value as Partial<PanelTask>
  return typeof task.id === 'string'
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
