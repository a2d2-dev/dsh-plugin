import type { WorkSnapshot } from '../work-schema.ts'
import type { TaskRef } from '../work-types.ts'
import type { GitHubSourcePort } from '../work-sources/types.ts'
import type { CompletionOperation } from './index.ts'

type Transaction = <T>(apply: (state: WorkSnapshot) => Promise<T>) => Promise<T>
/** Caller owns the per-operation lease. Network never holds the snapshot writer lock. */
export async function synchronizeClose(transaction: Transaction, ref: TaskRef, source: GitHubSourcePort | undefined, retryCommandId?: string): Promise<void> {
  const read = () => transaction(async state => {
    const task = state.tasks.find(item => item.id === ref.taskId && item.projectId === ref.projectId)
    const operation = task?.completion
    if (!operation?.external) return undefined
    const execution = state.executions.find(item => item.id === operation.executionId)
    const binding = state.externalBindings.find(item => item.ref.taskId === ref.taskId && item.ref.projectId === ref.projectId && item.nodeId === operation.external!.nodeId)
    return structuredClone({ operation, authorized: !!execution && execution.owner === operation.owner && execution.epoch === operation.epoch && !!binding })
  })
  const initial = await read()
  if (!initial) return
  const { operation } = initial, external = operation.external!
  const save = (change: Partial<NonNullable<CompletionOperation['external']>>) => transaction(async state => {
    const current = state.tasks.find(item => item.id === ref.taskId && item.projectId === ref.projectId)?.completion
    if (current?.operationId === operation.operationId) Object.assign(current.external!, change)
  })
  if (!initial.authorized) { await save({ status: 'conflict', error: 'completion-authority-changed' }); return }
  const retry = !!retryCommandId && external.lastRetryCommandId !== retryCommandId
  if (!retry && ['error', 'conflict', 'closed'].includes(external.status)) return
  if (retry) await save({ lastRetryCommandId: retryCommandId })
  if (!source) { await save({ status: 'error', error: 'github-source-unavailable' }); return }
  try {
    // In particular, unknown means the write might have committed. Always observe first.
    const { issue } = await source.detail(external.repository, external.number)
    await save({ observedState: issue.state })
    if (issue.nodeId !== external.nodeId || issue.number !== external.number || issue.repository.owner.toLowerCase() !== external.repository.owner.toLowerCase() || issue.repository.repository.toLowerCase() !== external.repository.repository.toLowerCase()) { await save({ status: 'conflict', error: 'canonical-binding-changed' }); return }
    const names = (values: string[]) => JSON.stringify(values.map(value => value.toLowerCase()).sort())
    if (names(issue.assignees) !== names(external.expectedAssignees)) { await save({ status: 'conflict', error: 'remote-assignees-changed' }); return }
    if (issue.state === 'closed') { await save({ status: 'closed', error: undefined }); return }
    if (external.status === 'closed' || external.observedState === 'closed') { await save({ status: 'conflict', error: 'remote-reopened' }); return }
    if (issue.updatedAt !== external.expectedUpdatedAt) { await save({ status: 'conflict', error: 'remote-version-changed' }); return }
    if (!source.close) { await save({ status: 'error', error: 'github-close-capability-unavailable' }); return }
    if (!retry && external.retryAt && Date.parse(external.retryAt) > Date.now()) return
    const fresh = await read()
    if (!fresh?.authorized) { await save({ status: 'conflict', error: 'completion-authority-changed' }); return }
    // Commit uncertainty BEFORE the side effect: a crash can only trigger observation.
    await save({ status: 'unknown', attempts: external.attempts + 1, retryAt: new Date(Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(external.attempts, 4))).toISOString(), error: 'close-receipt-pending' })
    const receipt = await source.close({ nodeId: external.nodeId, repository: external.repository, number: external.number,
      expectedAssignees: external.expectedAssignees, expectedUpdatedAt: external.expectedUpdatedAt }, operation.operationId)
    await save({ status: receipt.status, error: receipt.status === 'closed' ? undefined : receipt.message, ...(receipt.status === 'closed' ? { observedState: 'closed' as const } : {}) })
  } catch {
    // Preserve unknown across read/write timeouts; no speculative second write.
    const current = await read()
    await save({ status: current?.operation.external?.status === 'unknown' ? 'unknown' : 'error', error: 'github-observation-or-close-unavailable' })
  }
}
