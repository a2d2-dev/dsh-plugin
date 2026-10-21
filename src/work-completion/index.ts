import { z } from 'zod'
import { repositorySchema } from '../work-sources/schema.ts'
import type { WorkSnapshot } from '../work-schema.ts'
import type { WorkExecution, WorkTask } from '../work-types.ts'

export const closeTargetSchema = z.object({
  nodeId: z.string().min(1).max(256), repository: repositorySchema,
  number: z.number().int().positive(), expectedUpdatedAt: z.string().datetime(), expectedAssignees: z.array(z.string()),
}).strict()
export type CloseTarget = z.infer<typeof closeTargetSchema>
export type CloseReceipt = { status: 'closed' } | { status: 'error' | 'unknown' | 'conflict'; message: string }
const externalSchema = closeTargetSchema.extend({ status: z.enum(['pending', 'error', 'unknown', 'closed', 'conflict']), attempts: z.number().int().nonnegative(), retryAt: z.string().datetime().optional(), lastRetryCommandId: z.string().optional(), retryCommandIds: z.array(z.string()).optional(), error: z.string().optional(), observedState: z.enum(['open', 'closed']).optional() }).strict()
const ref = z.object({ projectId: z.string().uuid(), taskId: z.string().uuid() }).strict()
export const childCompletionSchema = z.object({ operationId: z.string().uuid(), child: ref, specificationVersion: z.number().int().positive(), summary: z.string(), completedAt: z.string().datetime() }).strict()
export const completionSchema = z.object({
  operationId: z.string().uuid(), commandId: z.string(), specificationVersion: z.number().int().positive(),
  executionId: z.string().uuid(), owner: z.string().uuid(), epoch: z.number().int().positive(), completedAt: z.string().datetime(),
  closeout: z.object({ status: z.enum(['pending', 'settled', 'error']), attempts: z.number().int().nonnegative().optional(), retryAt: z.string().datetime().optional(), error: z.string().optional() }).strict(),
  parent: ref.optional(), external: externalSchema.optional(),
}).strict()
export type CompletionOperation = z.infer<typeof completionSchema>
export type ChildCompletion = z.infer<typeof childCompletionSchema>
/** Completion is immutable, including legacy accepted reports without an operation. */
export function isTaskCompleted(task: WorkTask | undefined): boolean {
  return !!task && (!!task.completion || (task.progress?.stage === 'done' && task.progress.specificationVersion === task.specification.version))
}
/** Called only after the existing criterion/child acceptance checks, inside the command transaction. */
export function commitCompletion(state: WorkSnapshot, task: WorkTask, execution: WorkExecution, commandId: string, closeExternal = false): void {
  if (task.completion) return
  task.completion = { operationId: globalThis.crypto.randomUUID(), commandId, specificationVersion: task.specification.version,
    executionId: execution.id, owner: execution.owner, epoch: execution.epoch, completedAt: task.progress!.updatedAt,
    closeout: { status: 'pending' }, ...(task.parent ? { parent: structuredClone(task.parent) } : {}) }
  if (closeExternal) {
    const binding = state.externalBindings.find(item => item.ref.taskId === task.id && item.ref.projectId === task.projectId)!
    const issue = binding.accepted
    task.completion.external = { nodeId: binding.nodeId, repository: structuredClone(issue.repository), number: issue.number,
      expectedUpdatedAt: issue.updatedAt, expectedAssignees: [...issue.assignees], status: 'pending', attempts: 0, observedState: binding.lastObserved.state }
  }
  if (task.parent) {
    const parent = state.tasks.find(item => item.id === task.parent!.taskId && item.projectId === task.parent!.projectId)!
    ;(parent.childCompletions ??= []).push({ operationId: task.completion.operationId, child: execution.ref,
      specificationVersion: task.specification.version, summary: task.progress!.summary, completedAt: task.completion.completedAt })
  }
  queueParentResults(state)
}
/** Durable result inbox; no host call and no implicit resume/model execution. */
export function queueParentResults(state: WorkSnapshot): void {
  for (const parent of state.tasks) {
    const execution = state.executions.find(item => item.ref.taskId === parent.id && item.ref.projectId === parent.projectId)
    if (!execution || isTaskCompleted(parent)) continue
    for (const result of parent.childCompletions ?? []) {
      const id = `completion:${result.operationId}`
      if (!execution.events.some(event => event.id === id)) execution.events.push({ id,
        text: `Child Task ${result.child.taskId} accepted at specification ${result.specificationVersion}. Completion ${result.operationId}: ${result.summary}`,
        kind: 'result', delivery: 'accepted', acceptance: 'unassessed' })
    }
  }
}
