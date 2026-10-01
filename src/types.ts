/**
 * The task document vocabulary. A task aggregates related sessions in one
 * project; membership and handoff edges live here rather than on the session, so
 * a session's durable format stays untouched. A task bound to a task issue also
 * records its main session (ADR 0007).
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

/**
 * A main-session handoff that was prepared but not taken yet: the task is
 * "handing off" (交接中), and its main session is still the source.
 */
export interface TaskIssueHandoff {
  /** The main session that prepared the handoff. */
  readonly source: SessionId
}

/**
 * What the plugin records about a task issue that the tracker does not know:
 * which session executes it now. Everything else about the task issue lives on
 * the tracker.
 */
export interface TaskIssue {
  /** The task issue number; it is also the task's identity (`issue-<number>`). */
  readonly number: number
  /** The parent task issue number, present when this task is a subtask. */
  readonly parent?: number
  /** The one session executing the task issue; always one of the task's member sessions. */
  readonly mainSession: SessionId
  /** Present while a main-session handoff is prepared and not yet taken. */
  readonly handoff?: TaskIssueHandoff
}

/** One task: its own facts plus the sessions that belong to it. */
export interface Task {
  /** Document id, equal to the file basename. */
  readonly id: TaskId
  /** The task issue this task is bound to; absent for a task bound to none. */
  readonly issue?: TaskIssue
  /** Human-facing name. */
  readonly name: string
  /** Optional statement of what the task is for. */
  readonly goal?: string
  /** Document-declared lifecycle; `done` is the task's completion state. */
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
