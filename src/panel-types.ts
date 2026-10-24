/**
 * Shared wire types for the A²D² panel route.
 *
 * This file intentionally has no Node imports so the browser bundle can refer
 * to the route path and payload shape without pulling host-only modules into
 * the client typecheck.
 *
 * @module @a2d2/dsh-a2d2/src/panel-types
 */

import type { Task } from './types.ts'

/** Exact path owned by the panel task read. */
export const PANEL_ROUTE_PATH = '/a2d2/api/tasks'

/** The prepared main-session handoff a task issue is carrying. */
export interface PanelTaskIssueHandoff {
  readonly source: string
}

/** The task issue a task is bound to, as the browser reads it. */
export interface PanelTaskIssue {
  readonly number: number
  /** Present when the task is a subtask. */
  readonly parent?: number
  readonly mainSession: string
  /** Present while the task issue is handing off. */
  readonly handoff?: PanelTaskIssueHandoff
}

/** One task as the browser reads it. */
export interface PanelTask {
  readonly id: string
  /** Absent for a task bound to no task issue. */
  readonly issue?: PanelTaskIssue
  readonly name: string
  readonly goal?: string
  readonly state: Task['state']
  readonly createdAt: string
  readonly members: readonly PanelMember[]
}

/** One member session and its incoming handoff edge, if any. */
export interface PanelMember {
  readonly sessionId: string
  readonly handoffFrom?: string
}

/** Successful payload served to the browser. */
export interface PanelPayload {
  readonly root: string
  readonly tasks: readonly PanelTask[]
}

/** Stable failure vocabulary for the route. */
export type PanelErrorCode =
  | 'method-not-allowed'
  | 'unauthenticated'
  | 'untrusted'
  | 'missing-session'
  | 'unknown-session'
  | 'no-working-directory'
  | 'read-failed'

/** Route response envelope. */
export type PanelResponse =
  | { readonly ok: true; readonly value: PanelPayload }
  | { readonly ok: false; readonly error: { readonly code: PanelErrorCode; readonly message: string } }
