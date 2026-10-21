import { expect, it } from 'vitest'
import { taskProgressView, type TaskProgress } from '../src/work-progress.ts'
import { snapshotSchema } from '../src/work-schema.ts'
import type { ContinuousWorkItem, WorkExecution } from '../src/work-types.ts'

const projectId = '00000000-0000-4000-8000-000000000001'
const taskId = '00000000-0000-4000-8000-000000000002'
const agentId = '00000000-0000-4000-8000-000000000003'
const ref = { projectId, taskId }
const execution: WorkExecution = {
  id: '00000000-0000-4000-8000-000000000004', ref, agentId,
  owner: '00000000-0000-4000-8000-000000000005', epoch: 1,
  resource: { runtimeId: 'runtime', workspaceId: 'workspace' },
  session: { runtimeId: 'runtime', sessionId: 'session' }, sessionMode: 'create',
  agentPreset: 'standard', model: { provider: 'test', model: 'test' }, permissionPreset: 'workspace-write',
  policy: { version: 1, modelCandidates: [], instructions: '', capabilities: ['coordination'] },
  state: 'ready', history: [], events: [],
}
const report: TaskProgress = {
  specificationVersion: 1, stage: 'in-progress', summary: '已完成推送，正在验证保留策略',
  next: '验证 stable 标签不被删除', blockers: [], criteria: [], updatedAt: '2026-10-21T00:00:00Z',
}
function project(options: { execution?: Partial<WorkExecution>; progress?: Partial<TaskProgress>; specificationVersion?: number; queue?: Partial<ContinuousWorkItem> } = {}) {
  const state = snapshotSchema.parse({
    schemaVersion: 3,
    projects: [{ id: projectId, name: '镜像研发', version: 1, defaultAgentId: agentId, resources: [execution.resource] }],
    agents: [{ id: agentId, projectId, role: 'coordinator', policy: execution.policy }], commands: [], legacyMappings: [],
    sources: options.queue ? [{ id: '00000000-0000-4000-8000-000000000007', projectId, provider: 'github', githubProject: { owner: 'example', type: 'org', number: 1 }, enabled: true, version: 1, sequence: 0, requests: {}, observations: [], pages: [] }] : [],
    tasks: [{ id: taskId, projectId, title: '镜像管理', goal: '可靠清理镜像', version: 1, agentId,
      specification: { version: options.specificationVersion ?? 1, text: '保留 stable 标签', acceptance: ['stable 标签保留'] },
      specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [],
      ...(options.progress ? { progress: { ...report, ...options.progress } } : {}),
    }],
    executions: options.execution ? [{ ...execution, ...options.execution }] : [],
    ...(options.queue ? { continuousRules: [{
      id: '00000000-0000-4000-8000-000000000006', projectId, sourceId: '00000000-0000-4000-8000-000000000007', version: 1, enabled: true,
      scope: { assignee: '*', labels: [] }, resource: execution.resource, model: execution.model, agentPreset: execution.agentPreset, permissionPreset: execution.permissionPreset,
      items: [{ nodeId: 'I_issue', title: '镜像管理', number: 1, url: 'https://github.com/example/images/issues/1', ref, executionId: execution.id, state: 'active', attempts: 0, ...options.queue }],
    }] } : {}),
  })
  const before = structuredClone(state)
  const result = taskProgressView(state, ref, { status: () => 'idle' })!
  expect(state).toEqual(before)
  return result
}

it('shows an unstarted Issue independently of any remote status or accepted work registration', () => {
  expect(project()).toMatchObject({ processingState: 'not-started', stage: 'planned', criteria: { passed: 0, assessed: 0 } })
})
it('does not equate an idle model with completed work', () => {
  expect(project({ execution: {}, progress: {} })).toMatchObject({ processingState: 'processing', execution: { runtime: 'idle' } })
})
it('exposes a failed start as blocked even before the first progress report exists', () => {
  expect(project({ execution: { state: 'failed', error: { code: 'unavailable-model', message: '模型暂不可用' } } })).toMatchObject({
    processingState: 'blocked', processingReason: '模型暂不可用',
  })
})
it('shows an accepted human wait with its concrete question instead of a generic running label', () => {
  expect(project({ execution: { control: { commandId: 'question', action: 'wait', status: 'accepted', reason: '是否保留最近三个镜像？' } }, progress: { blockers: ['保留数量待确认'] } })).toMatchObject({
    processingState: 'waiting', processingReason: '是否保留最近三个镜像？', stage: 'in-progress',
  })
})
it('keeps an explicit pause separate from waiting for a reply', () => {
  expect(project({ execution: { state: 'paused', control: { commandId: 'pause', action: 'pause', status: 'applied', reason: '用户暂停' } } })).toMatchObject({ processingState: 'paused', processingReason: '用户暂停' })
})
it('surfaces context handoff failure without changing the accepted business stage', () => {
  expect(project({ execution: { continuationBlocked: { code: 'continuation-meter-unavailable', message: '上下文计量不可用' } }, progress: {} })).toMatchObject({
    processingState: 'blocked', processingReason: '上下文计量不可用', stage: 'in-progress',
  })
})
it('shows review as waiting and current accepted completion as completed during closeout', () => {
  expect(project({ execution: {}, progress: { stage: 'review' } })).toMatchObject({ processingState: 'waiting', processingReason: '等待验收' })
  expect(project({ execution: { state: 'waiting', control: { commandId: 'done', action: 'wait', status: 'applied', reason: '任务已验收完成' } }, progress: { stage: 'done', criteria: [{ index: 0, passed: true, evidence: ['保留策略测试通过'] }] } })).toMatchObject({ processingState: 'completed', criteria: { passed: 1, current: true } })
})
it('shows an unfinished idle queue item as blocked with the scheduler reason', () => {
  expect(project({ execution: {}, queue: { state: 'blocked', reason: '未报告可执行的下一步' } })).toMatchObject({ processingState: 'blocked', processingReason: '未报告可执行的下一步', blockers: ['未报告可执行的下一步'] })
})
it('shows an accepted reply waiting for scheduling without claiming the model is running', () => {
  expect(project({ execution: { state: 'waiting' }, queue: { state: 'waiting', resumeRequested: true } })).toMatchObject({ processingState: 'waiting', processingReason: '已收到回复，排队等待继续处理', execution: { runtime: 'idle' } })
})
it('does not reuse stale completion after the Issue acceptance specification changes', () => {
  expect(project({ execution: {}, specificationVersion: 2, progress: { stage: 'done', criteria: [{ index: 0, passed: true, evidence: ['旧规格测试通过'] }] } })).toMatchObject({
    processingState: 'blocked', processingReason: '规格已更新，旧验收结果需要重新核验', criteria: { passed: 0, current: false },
  })
})
