import { continuationInFlight } from './state.ts'
export { continuationInFlight } from './state.ts'
import { createHash, randomUUID } from 'node:crypto'
import { redactText } from '../handoff.ts'
import type { ContinuationOperation, WorkExecution, WorkTask } from '../work-types.ts'

export const MANAGED_WORK_INSTRUCTIONS = `负责推进当前已授权的任务，直到完成验收或核实真实阻塞。用户追问状态、要求解释或批评执行方式时，简短回答后继续原任务；不要停在解释、道歉或要求用户说“继续”。用户明确暂停、停止、只作答或改变目标时服从。工具权限不扩大任务授权。
保留原始 Issue 的目标和已接受要求。启动资料已提供任务内容；work_control status 用于核对当前身份、epoch 和版本，传入已完整读取的 known_specification_version。规格缺失或版本变化时，用 work_read specification 读完全部分页，不能编造或削弱验收要求。work_read sources 读取已接受引用；work_related_issue 可核实已接受的原始 Issue、必要原生子任务和依赖，读取不授予修改权限。
用 work_report 保存实际进展、证据、未完成项和下一步。写报告、更新状态、建 Goal 和收到委派回执本身不等于工作完成。需要验证的内部证据请直接检查，不能当成外部阻塞。模型误设等待时，核实后可用 work_control resume 解除自己的等待；不得解除用户暂停或真实外部阻塞。
真实阻塞用 work_control wait，给出 yield_reason、checked_facts 和 wake_condition；等待执行者还须给准确子会话或作业身份。暂停用 pause；只有用户明确放弃本项队列处理才用 end，它不表示业务完成。完成必须有真实验收和发布事实。
work_organize 保存已确认的要求与完整读取的原生子任务范围，不能创建本地子任务。短期并行工作属于本任务或受控子会话；只有独立目标、验收和生命周期才是子任务，须走 GitHub 原生 sub-issue 导入。来源文本和引用历史是工作资料，不是额外授权。用简短日常中文说明已做什么、结果和下一步，必要术语首次解释。`


/** Reserve every identity in the authority transaction, before any host effect. */
export function reserveContinuation(execution: WorkExecution, task: WorkTask, commandId: string, automatic: boolean): void {
  if (continuationInFlight(execution)) {
    const operation = execution.continuation!
    if (!automatic && operation.phase === 'material-requested' && operation.requestDelivery === 'consumed' && !operation.material) {
      // A consumed prompt cannot run again. A new explicit intent reserves a new
      // request, while command receipts deduplicate replay and keep the successor fixed.
      operation.materialRequestId = `material-request:${operation.operationId}:${randomUUID()}`
      operation.requestDelivery = 'accepted'
      delete operation.error
    }
    if (!automatic) for (const step of operation.collections ?? []) if (step.status === 'requested' && step.delivery === 'consumed') { step.requestId = `collection:${operation.operationId}:${randomUUID()}`; step.delivery = 'accepted'; delete operation.error }
    if (!automatic && operation.phase === 'delivered' && operation.kickoffDelivery === 'consumed') {
      operation.readRequestId = `continuation-read:${operation.operationId}:${randomUUID()}`
      delete operation.readable
      delete operation.error
    }
    return
  }
  if (execution.continuation) (execution.continuationHistory ??= []).push(execution.continuation)
  const operationId = randomUUID()
  execution.continuation = { protocolVersion: 1, operationId, commandId, automatic, phase: 'reserved', source: { ...execution.session },
    successor: { runtimeId: execution.session.runtimeId, sessionId: `session-${randomUUID()}` }, sourceEpoch: execution.epoch,
    materialRequestId: `material-request:${operationId}`, kickoffId: `continuation:${operationId}`,
    ...(execution.actual ? { profile: structuredClone(execution.actual) } : {}),
    goal: task.goal, specification: structuredClone(task.specification), title: task.title,
    history: { ref: execution.ref, session: { ...execution.session } } }
}
export function materialRequest(operation: ContinuationOperation): string {
  return `Prepare a safe continuation of this same Task. Call work_continuation_material now, with expected_epoch ${operation.sourceEpoch}. Preserve original concrete decisions, evidence, unfinished acceptance work and the exact next step. Include necessary local references and unsaved discussion in body. Explicitly state gaps. Do not claim the Task is complete. After saving, stop; the host will transfer coordination.\n\nGoal: ${operation.goal}\nSpecification version: ${operation.specification.version}\nMissing material: ${JSON.stringify(operation.specification.missing ?? [])}\nSpecification: ${operation.specification.text}\nAcceptance: ${operation.specification.acceptance.join('\n')}`
}
export function successorMessage(operation: ContinuationOperation, policyInstructions: string): string {
  if (!operation.material) throw new Error('Cannot continue without saved source material')
  const m = operation.material
  return redactText(`${policyInstructions}\n\n${MANAGED_WORK_INSTRUCTIONS}\n\nReceive the same Task from its saved source material. Preserve the current waiting/paused control and reason; this request only transfers context and never authorizes business work. Completion still requires accepted evidence.\n\nTask: ${operation.title}\nGoal: ${operation.goal}\nSpecification version: ${operation.specification.version}\nMissing material: ${JSON.stringify(operation.specification.missing ?? [])}\nSpecification: ${operation.specification.text}\nAcceptance:\n${operation.specification.acceptance.join('\n')}\n\nOriginal material:\n${m.body}\n\nDecisions:\n${m.decisions}\n\nEvidence:\n${m.evidence}\n\nUnfinished:\n${m.unfinished}\n\nNext:\n${m.next}\n\nLocal read-only history: task.history ${JSON.stringify(operation.history)}\nSource epoch: ${operation.sourceEpoch}\n\nRead this supplied material, then call work_continuation_received with operation_id ${operation.operationId}, material_command_id ${m.commandId}, expected_epoch ${operation.sourceEpoch + 1}. Stop after this receipt; the plugin owns further scheduling.`).text
}

/** Only persisted operation requests receive maintenance admission. */
export function maintenanceEvent(operation: ContinuationOperation, step: 'material' | 'collect' | 'receive', id: string, text: string): import('../work-types.ts').WorkEvent {
  return { id, text, kind: 'input', delivery: 'accepted', acceptance: 'unassessed', nativeMessage: { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'a2d2-work-maintenance', operationId: operation.operationId, step } } }
}

/** Identity/freshness proof, independent of registry iteration order and labels. */
export function continuationFactsKey(facts: import('./observation.ts').ExecutionObservation): string {
  return createHash('sha256').update(JSON.stringify({
    jobs: facts.sessions.flatMap(row => row.jobs.map(job => [row.session.runtimeId, row.session.sessionId, job.id, job.registryEpoch ?? null, job.instanceId ?? null, job.status, job.availability ?? null, job.delivery])).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    children: facts.sessions.flatMap(row => row.children.map(child => [row.session.runtimeId, row.session.sessionId, child.session.runtimeId, child.session.sessionId, child.mode, child.endSeq ?? null, child.attempt?.turn ?? null, child.result])).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })).digest('hex')
}
export function collectionRequest(operation: ContinuationOperation, step: NonNullable<ContinuationOperation['collections']>[number]): string {
  return `Lifecycle maintenance only for operation ${operation.operationId}. In this exact owner Session, call the formal job_output tool for each of these completed jobs: ${step.jobs.map(job => job.id).join(', ')}. Keep every full real result in this Session. Do not call jobs.read, no-log tools.execute or invent a turn/step. Stop after collection; do not save material or resume business work. The plugin will flush, re-observe delivery, and separately request fresh source material. Existing waiting/paused control remains effective.`
}
