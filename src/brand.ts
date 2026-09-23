/**
 * Branded task identifier. A task id is simultaneously the task document's file
 * basename under `<projectRoot>/.dsh/a2d2/tasks/`, so the factory is also the
 * path-safety boundary: only ids that form a plain, non-traversing filename are
 * accepted.
 * @module @deepseek-ai/dsh-a2d2/src/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier of one task document. */
export type TaskId = Branded<'TaskId'>

/** The accepted id alphabet: a lowercase kebab-case token, never path syntax. */
const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/**
 * Brand one task id after checking it is a safe single filename component.
 * @param value - the candidate id.
 * @returns the same string carrying the `TaskId` brand.
 */
export function TaskId(value: string): TaskId {
  if (!TASK_ID_PATTERN.test(value)) {
    throw new Error(
      `a2d2: task id "${value}" is not a lowercase kebab-case token; it names a document file and must not contain path syntax`,
    )
  }
  return value as TaskId
}
