import type { WorkCommand, WorkExecution, WorkTask } from '../work-types.ts'

const remoteLabels = { pending: '关闭待同步', error: '关闭失败', unknown: '关闭结果未知', closed: '远端已关闭', conflict: '关闭冲突' } as const
export function completionSyncCommand(task: WorkTask, execution: WorkExecution, commandId: string): WorkCommand {
  return { type: 'task.completion-sync', commandId, ref: { projectId: task.projectId, taskId: task.id },
    executionId: execution.id, owner: execution.owner, epoch: execution.epoch }
}
/** Independent component: the host panel supplies its existing trusted command transport. */
export function CompletionStatus({ task, execution, remoteState, onSync, busy = false, error }: {
  task: WorkTask; execution?: WorkExecution; remoteState?: 'open' | 'closed'
  onSync?: (command: WorkCommand) => Promise<unknown>; busy?: boolean; error?: string
}) {
  const completion = task.completion
  const accepted = !!completion || (task.progress?.stage === 'done' && task.progress.specificationVersion === task.specification.version)
  const external = completion?.external
  const observed = external?.observedState ?? remoteState
  return <section aria-label="任务验收与外部同步" style={{ display: 'grid', gap: 6 }}>
    <strong>{accepted ? '本地已验收' : '尚未本地验收'}</strong>
    {completion && <span>{completion.closeout.status === 'settled' ? '执行已安全收口' : completion.closeout.status === 'error' ? '执行收口失败' : '执行收口待处理'}</span>}
    {completion?.closeout.error && <span role="status">{completion.closeout.error}</span>}
    {observed && <span>{observed === 'open' ? '远端 Open' : '远端 Closed'}</span>}
    {external && <span role="status">{remoteLabels[external.status]}</span>}
    {external?.error && <span role="status">{external.error}</span>}
    {error && <span role="alert">{error}</span>}
    {completion && execution && onSync && <button type="button" disabled={busy} onClick={() => {
      void onSync(completionSyncCommand(task, execution, `completion-sync:${globalThis.crypto.randomUUID()}`))
    }}>{busy ? '正在补同步…' : external ? '补同步' : '补收口'}</button>}
  </section>
}
