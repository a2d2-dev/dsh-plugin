/**
 * The task document vocabulary. A task aggregates related sessions in one
 * project; membership and handoff edges live here rather than on the session, so
 * a session's durable format stays untouched.
 * @module @deepseek-ai/dsh-a2d2/src/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TaskId } from './brand.ts'

/** Lifecycle of a task as its document records it. */
export type TaskState = 'active' | 'paused' | 'done'

/**
 * One session belonging to a task.
 *
 * `handoffFrom` records the single direction of a handoff edge (child → parent).
 * The opposite direction is derived, never stored: `successorsOf` finds the
 * members whose `handoffFrom` names a given session.
 */
export interface TaskMember {
  /** The member session's id. */
  readonly sessionId: SessionId
  /** The member session this one was handed off from, absent for a task's start. */
  readonly handoffFrom?: SessionId
}

/** One task: its own facts plus the sessions that belong to it. */
export interface Task {
  /** Document id, equal to the file basename. */
  readonly id: TaskId
  /** Human-facing name. */
  readonly name: string
  /** Optional statement of what the task is for. */
  readonly goal?: string
  /** Document-declared lifecycle. */
  readonly state: TaskState
  /** Creation timestamp, ISO-8601. */
  readonly createdAt: string
  /** Member sessions in document order, which is also display order. */
  readonly members: readonly TaskMember[]
}

/** Caller-supplied facts for a new task. */
export interface CreateTaskRequest {
  /** Human-facing name; must be non-empty after trimming. */
  readonly name: string
  /** Optional statement of what the task is for. */
  readonly goal?: string
}
