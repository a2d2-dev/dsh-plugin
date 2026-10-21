import { z } from 'zod'
import { commitCompletion } from './work-completion/index.ts'
import type { WorkSnapshot } from './work-schema.ts'
import type { WorkExecutionHost } from './work-execution/host.ts'
import type { TaskRef, WorkExecution, WorkResult, WorkTask } from './work-types.ts'

const text = z.string().trim().min(1).max(20_000)
export const workStageSchema = z.enum(['planned', 'in-progress', 'review', 'blocked', 'done'])
export type WorkStage = z.infer<typeof workStageSchema>
const evidence = z.array(text).max(100)
const criterionResult = z.object({ index: z.number().int().min(0), passed: z.boolean(), evidence }).strict()
const requirement = z.object({ id: text, title: text, description: text,
  status: workStageSchema.default('planned'), evidence: evidence.default([]),
  child: z.object({ projectId: z.string().uuid(), taskId: z.string().uuid() }).strict().optional(),
}).strict()
export const taskReportSchema = z.object({
  specificationVersion: z.number().int().positive(), stage: workStageSchema, summary: text,
  next: z.string().max(20_000), blockers: z.array(text).max(100),
  criteria: z.array(criterionResult).max(1000), breakdown: z.array(requirement).max(1000).optional(),
}).strict()
export type TaskReport = z.infer<typeof taskReportSchema>
export const taskProgressSchema = taskReportSchema.omit({ breakdown: true }).extend({ updatedAt: z.string().datetime() }).strict()
export type TaskProgress = z.infer<typeof taskProgressSchema>
export type IssueProcessingState = 'not-started' | 'processing' | 'waiting' | 'paused' | 'blocked' | 'completed'
export interface TaskProgressView {
  processingState?: IssueProcessingState
  processingReason?: string
  ref: TaskRef; title: string; parent?: TaskRef; children: TaskRef[]
  stage: WorkStage; summary: string; next: string; blockers: string[]; updatedAt?: string
  criteria: { passed: number; total: number; assessed: number; current: boolean }
  breakdown: WorkTask['breakdown']
  execution?: { id: string; session: WorkExecution['session']; state: WorkExecution['state']; runtime: 'running'|'idle'|'inactive'; reason?: string }
  source?: { nodeId?: string; number: number; url: string; state: 'open'|'closed'; observedAt: string }
}
const sameRef = (a: TaskRef, b: TaskRef) => a.projectId === b.projectId && a.taskId === b.taskId
const refOf = (task: WorkTask): TaskRef => ({projectId:task.projectId,taskId:task.id})

/** Reports are accountable task facts. Runtime or external closed state cannot assert completion. */
export function applyTaskReport(state: WorkSnapshot, execution: WorkExecution, report: TaskReport, commandId: string): WorkResult {
  const task = state.tasks.find(item => sameRef(refOf(item), execution.ref))!
  const fail = (code: string, message: string): WorkResult => ({status:'failed',error:{code,message}})
  if (task.specification.version !== report.specificationVersion) return fail('stale-specification', '验收依据已变更，请按当前规格重新报告')
  if (new Set(report.criteria.map(item=>item.index)).size !== report.criteria.length || report.criteria.some(item=>item.index >= task.specification.acceptance.length)) return fail('invalid-criterion', '验收结果必须逐项对应当前规格，且不能重复')
  if (report.criteria.some(item=>item.passed && item.evidence.length === 0)) return fail('missing-evidence', '通过的验收项必须附带可核验的证据')
  const blocks = report.breakdown ?? task.breakdown
  if (new Set(blocks.map(item=>item.id)).size !== blocks.length) return fail('duplicate-block', '需求块标识不能重复')
  for (const block of blocks) {
    if (block.child && !task.children.some(child=>sameRef(child,block.child!))) return fail('unlinked-child', '需求块只能引用已关联的子任务')
    if (block.status === 'done' && !block.evidence?.length && !block.child) return fail('missing-evidence', '完成的需求块必须有证据或关联的已完成子任务')
    if (block.status === 'done' && block.child) {
      const child = state.tasks.find(item=>sameRef(refOf(item),block.child!))
      if (child?.progress?.stage !== 'done' || child.progress.specificationVersion !== child.specification.version) return fail('unfinished-child', '关联子任务尚未按当前规格验收完成')
    }
  }
  if (report.stage === 'done') {
    if (report.blockers.length || !task.specification.acceptance.length || task.specification.missing?.length
      || report.criteria.length !== task.specification.acceptance.length || report.criteria.some(item=>!item.passed)) return fail('acceptance-incomplete', '完成前必须通过当前规格的全部验收项并解决阻塞')
    if (blocks.some(item=>item.status !== 'done')) return fail('unfinished-breakdown', '仍有需求块未完成')
    for (const childRef of task.children) {
      const child = state.tasks.find(item=>sameRef(refOf(item),childRef))
      if (child?.progress?.stage !== 'done' || child.progress.specificationVersion !== child.specification.version) return fail('unfinished-child', '仍有子任务未验收完成')
    }
  }
  const { breakdown: _breakdown, ...progress } = report
  task.progress = {...progress,updatedAt:new Date().toISOString()}
  if (report.breakdown) task.breakdown = structuredClone(report.breakdown)
  task.version++
  task.activity.push({commandId,type:'task.report',version:task.version})
  execution.progress = report.summary
  if (report.stage === 'done') {
    execution.control = {commandId,action:'wait',status:'accepted',reason:'任务已按当前规格验收完成'}
    commitCompletion(state, task, execution, commandId)
  }
  return {status:'completed',task,execution}
}

export function taskProgressView(state: WorkSnapshot, ref: TaskRef, host?: Pick<WorkExecutionHost, 'status'>): TaskProgressView | undefined {
  const task = state.tasks.find(item=>sameRef(refOf(item),ref))
  if (!task) return undefined
  const progress = task.progress
  const current = progress?.specificationVersion === task.specification.version
  const execution = state.executions.find(item=>sameRef(item.ref,ref))
  const source = state.externalBindings.find(item=>sameRef(item.ref,ref))?.lastObserved
  const runtime = execution ? host?.status(execution) ?? 'inactive' : undefined
  const queueItem = state.continuousRules?.flatMap(rule => rule.items).find(item => item.ref && sameRef(item.ref, ref))
  const stage: WorkStage = current && progress ? progress.stage : execution ? 'in-progress' : 'planned'
  const blockers = current ? [...(progress?.blockers??[])] : []
  if (execution?.error) blockers.push(execution.error.message)
  if (execution?.runtimeFailure && !execution.runtimeFailure.acknowledged) blockers.push(execution.runtimeFailure.message)
  if (execution?.continuationBlocked) blockers.push(execution.continuationBlocked.message)
  if (execution?.continuation?.error) blockers.push(execution.continuation.error.message)
  if (progress && !current) blockers.push('规格已更新，旧验收结果需要重新核验')
  if (queueItem?.state === 'blocked' && queueItem.reason && !blockers.includes(queueItem.reason)) blockers.push(queueItem.reason)
  // Processing answers whether this Issue needs attention; Stage remains the
  // accepted business report. An idle model or a closed remote Issue is not done.
  let processingState: IssueProcessingState
  let processingReason: string | undefined
  if (current && progress.stage === 'done') {
    processingState = 'completed'
  } else if (execution?.state === 'failed' || execution?.error
    || (execution?.runtimeFailure && !execution.runtimeFailure.acknowledged)
    || execution?.continuationBlocked || execution?.continuation?.error) {
    processingState = 'blocked'
    processingReason = blockers[0] ?? '执行失败，等待恢复'
  } else if (queueItem?.resumeRequested) {
    processingState = 'waiting'
    processingReason = '已收到回复，排队等待继续处理'
  } else if (queueItem?.state === 'blocked') {
    processingState = 'blocked'
    processingReason = queueItem.reason ?? '处理受阻，等待恢复'
  } else if (execution?.state === 'paused' || execution?.control?.action === 'pause' || queueItem?.state === 'paused') {
    processingState = 'paused'
    processingReason = execution?.control?.reason ?? queueItem?.reason ?? '已暂停处理'
  } else if (execution?.state === 'waiting' || execution?.control?.action === 'wait' || queueItem?.state === 'waiting') {
    processingState = 'waiting'
    processingReason = execution?.control?.reason ?? queueItem?.reason ?? '等待回复或外部结果'
  } else if (blockers.length || (current && progress.stage === 'blocked')) {
    processingState = 'blocked'
    processingReason = blockers[0] ?? progress?.summary
  } else if (current && progress.stage === 'review') {
    processingState = 'waiting'
    processingReason = '等待验收'
  } else {
    processingState = execution ? 'processing' : 'not-started'
  }
  return {
    processingState, ...(processingReason ? { processingReason } : {}),
    ref, title: task.title, ...(task.parent?{parent:task.parent}:{}), children:task.children,
    stage, summary:progress?.summary ?? execution?.progress ?? (execution?'已开始处理，尚未报告工作进展':'尚未开始处理'),
    next:progress?.next ?? '',blockers,...(progress?{updatedAt:progress.updatedAt}:{}),
    criteria:{passed:current ? progress.criteria.filter(item=>item.passed).length:0,total:task.specification.acceptance.length,assessed:current?progress.criteria.length:0,current},
    breakdown:task.breakdown,
    ...(execution?{execution:{id:execution.id,session:execution.session,state:execution.state,runtime:runtime!,reason:execution.control?.reason}}:{}),
    ...(source?{source:{nodeId:source.nodeId,number:source.number,url:source.url,state:source.state,observedAt:source.observedAt}}:{}),
  }
}
export function projectProgress(state: WorkSnapshot, projectId: string, host?: Pick<WorkExecutionHost, 'status'>): TaskProgressView[] {
  return state.tasks.filter(item=>item.projectId===projectId).map(task=>taskProgressView(state,refOf(task),host)!)
}
