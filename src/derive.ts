/**
 * Derived task facts. Only one direction of a handoff edge is stored (a member's
 * `handoffFrom`), so both the outgoing link and the "this session was handed off"
 * marker are computed here rather than kept as a second copy that could
 * disagree.
 * @module @deepseek-ai/dsh-a2d2/src/derive
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Task, TaskMember } from './types.ts'

/**
 * The member entry naming one session, if it belongs to the task.
 * @param task - the task to search.
 * @param sessionId - the member session.
 * @returns the member entry, or `undefined` when the session is not a member.
 */
export function memberOf(task: Task, sessionId: SessionId): TaskMember | undefined {
  return task.members.find(member => member.sessionId === sessionId)
}

/**
 * Every session handed off from the given one, in document order.
 *
 * More than one successor is legitimate — a session may be handed off, resumed,
 * and handed off again — so the relation is a forest, not a chain.
 * @param task - the task holding the edge.
 * @param sessionId - the session the successors were handed off from.
 * @returns the successor session ids, empty when there are none.
 */
export function successorsOf(task: Task, sessionId: SessionId): readonly SessionId[] {
  return task.members
    .filter(member => member.handoffFrom === sessionId)
    .map(member => member.sessionId)
}

/**
 * Whether a session currently has at least one handed-off successor.
 *
 * This reports the existence of a continuation, NOT that the session is
 * finished: the same session stays usable, because a real workflow hands off to
 * run something elsewhere and then hands back.
 * @param task - the task holding the edge.
 * @param sessionId - the session to test.
 * @returns true when a successor records this session as its `handoffFrom`.
 */
export function handedOff(task: Task, sessionId: SessionId): boolean {
  return successorsOf(task, sessionId).length > 0
}
