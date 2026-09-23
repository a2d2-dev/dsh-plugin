/**
 * Task-document (de)serialization plus the file-boundary validation that guards
 * it. A task document is a file a person may hand-edit and commit, so every
 * accepted field is checked here and an unexpected one fails loudly instead of
 * degrading into an empty task.
 * @module @deepseek-ai/dsh-a2d2/src/document
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskId } from './brand.ts'
import type { Task, TaskMember, TaskState } from './types.ts'

/** The only document schema version this build reads and writes. */
export const TASK_DOCUMENT_VERSION = 1

/** Expected failure classes while reading a task document. */
export type TaskDocumentErrorCode = 'malformed' | 'unsupported-version' | 'id-mismatch'

/** A task document this build refuses to read into a task. */
export class TaskDocumentError extends Error {
  override readonly name = 'TaskDocumentError'

  /** Stable class of the failure. */
  readonly code: TaskDocumentErrorCode

  /**
   * Create one classified document failure.
   * @param code - the failure class.
   * @param message - what is wrong, naming the offending field.
   */
  constructor(code: TaskDocumentErrorCode, message: string) {
    super(`a2d2: ${message}`)
    this.code = code
  }
}

const TASK_STATES: readonly TaskState[] = ['active', 'paused', 'done']

function malformed(message: string): TaskDocumentError {
  return new TaskDocumentError('malformed', message)
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw malformed(`${field} must be a mapping`)
  }
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw malformed(`${field} must be a non-empty string`)
  }
  return value
}

function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw malformed(`${field} must be a non-empty string when present`)
  }
  return value
}

function parseMember(value: unknown, index: number): TaskMember {
  const record = asRecord(value, `sessions[${index}]`)
  const sessionId = SessionId(requiredString(record, 'id'))
  const handoffFrom = optionalString(record, 'handoffFrom')
  return handoffFrom === undefined
    ? { sessionId }
    : { sessionId, handoffFrom: SessionId(handoffFrom) }
}

/**
 * Read one task document.
 *
 * The document's own `id` must equal the id its filename provides: a file moved
 * or copied under a new name would otherwise report a membership belonging to a
 * different task.
 * @param text - the document's UTF-8 content.
 * @param id - the id derived from the document's filename.
 * @returns the validated task.
 */
export function parseTaskDocument(text: string, id: TaskId): Task {
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (error) {
    throw malformed(`document "${id}" is not valid YAML: ${(error as Error).message}`)
  }
  const record = asRecord(raw, 'document')

  const version = record['version']
  if (version !== TASK_DOCUMENT_VERSION) {
    throw new TaskDocumentError(
      'unsupported-version',
      `document "${id}" declares version ${String(version)}; this build reads version ${TASK_DOCUMENT_VERSION}`,
    )
  }

  const declaredId = requiredString(record, 'id')
  if (declaredId !== id) {
    throw new TaskDocumentError(
      'id-mismatch',
      `document "${id}" declares id "${declaredId}"; the filename is authoritative`,
    )
  }

  const state = requiredString(record, 'state')
  if (!TASK_STATES.includes(state as TaskState)) {
    throw malformed(`state must be one of ${TASK_STATES.join(', ')}`)
  }

  const sessions = record['sessions']
  if (sessions !== undefined && !Array.isArray(sessions)) {
    throw malformed('sessions must be a sequence')
  }
  const members = ((sessions ?? []) as unknown[]).map(parseMember)

  const goal = optionalString(record, 'goal')
  return {
    id,
    name: requiredString(record, 'name'),
    ...(goal === undefined ? {} : { goal }),
    state: state as TaskState,
    createdAt: requiredString(record, 'createdAt'),
    members,
  }
}

/**
 * Render one task document in its canonical field order.
 * @param task - the task to serialize.
 * @returns the document's UTF-8 content.
 */
export function renderTaskDocument(task: Task): string {
  const document: Record<string, unknown> = {
    version: TASK_DOCUMENT_VERSION,
    id: task.id,
    name: task.name,
  }
  if (task.goal !== undefined) document['goal'] = task.goal
  document['state'] = task.state
  document['createdAt'] = task.createdAt
  document['sessions'] = task.members.map(member => (member.handoffFrom === undefined
    ? { id: member.sessionId }
    : { id: member.sessionId, handoffFrom: member.handoffFrom }))
  return stringifyYaml(document, { lineWidth: 0 })
}

/**
 * Read the id a task document filename provides.
 * @param filename - the basename, including its `.yaml` extension.
 * @returns the branded id.
 */
export function taskIdFromFilename(filename: string): TaskId {
  return TaskId(filename.replace(/\.ya?ml$/, ''))
}
