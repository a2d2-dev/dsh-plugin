import { afterEach, expect, it, vi } from 'vitest'
import type { AssociatedWork, WorkCompleted } from '../../src/work-types.ts'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { mountProductionComponent } from './production-component-harness.ts'

const ref = { projectId: 'p', taskId: 't' }, session = { runtimeId: 'runtime', sessionId: 'current' }
function taskDetail(): WorkCompleted {
  return {
    status: 'completed',
    task: { id: 't', projectId: 'p', title: 'Task continuation', goal: 'goal', version: 1, agentId: 'agent', specification: { version: 1, text: 'scope', acceptance: ['accepted'] }, specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [] },
    execution: { id: 'e', ref, owner: 'owner', epoch: 1, agentId: 'agent', resource: { runtimeId: 'runtime', workspaceId: 'ws' }, session, sessionMode: 'create', agentPreset: 'standard', model: { provider: 'test', model: 'test' }, permissionPreset: 'read-only', policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'ready', history: [], events: [], actual: { runtimeId: 'runtime', cwd: '/workspace', agentPreset: 'standard', provider: 'test', model: 'test', permissionPreset: 'read-only', sandbox: 'none', approval: 'never' } },
  }
}
const completion = { operationId: 'done', commandId: 'done', specificationVersion: 1, executionId: 'e', owner: 'owner', epoch: 1, completedAt: '2026-10-24T00:00:00Z', closeout: { status: 'settled' as const } }
function controllerFor(detail: WorkCompleted, purpose: AssociatedWork['purpose'] = 'control') {
  return new WorkPanelController({
    command: vi.fn(async () => { throw Error('Render must not write') }),
    query: async query => {
      if (query.type === 'task.detail') return detail
      if (query.type === 'resources.list') return { status: 'completed', resources: [{ ref: { runtimeId: 'runtime', workspaceId: 'ws' }, title: 'Workspace' }] }
      if (query.type === 'session.work') return { status: 'completed', work: [{ ref, title: 'Task continuation', projectName: 'Project', purpose }] }
      return { status: 'completed' }
    },
  }, { selectPanel: () => {}, openSession: () => {} })
}
const mounted: ReturnType<typeof mountProductionComponent>[] = []
afterEach(() => { mounted.splice(0).forEach(view => view.unmount()) })
async function nativeView(detail: WorkCompleted, purpose: AssociatedWork['purpose'] = 'control') {
  const controller = controllerFor(detail, purpose)
  const view = mountProductionComponent({ controller, sessionId: 'current' }, 'ExecutionConversationContinuation', new URL('../../src/client/execution-native.tsx', import.meta.url))
  mounted.push(view)
  await expect.poll(() => view.text()).toContain('自动接续')
  return { view, controller }
}
const prepareButton = (view: ReturnType<typeof mountProductionComponent>) => view.nodes('button').find(button => button.props.children === '准备接续')

it('finishes a slow detail read while equal session associations refresh every five seconds', async () => {
  vi.useFakeTimers()
  try {
    const detail = taskDetail()
    const reads: AbortSignal[] = []
    const controller = controllerFor(detail)
    const query = controller.client.query.bind(controller.client)
    controller.client.query = async (value, signal) => {
      if (value.type === 'task.detail') {
        reads.push(signal!)
        await new Promise(resolve => setTimeout(resolve, 6000))
        return detail
      }
      return query(value, signal)
    }
    const view = mountProductionComponent({ controller, sessionId: 'current' }, 'ExecutionConversationContinuation', new URL('../../src/client/execution-native.tsx', import.meta.url))
    mounted.push(view)
    await vi.advanceTimersByTimeAsync(0)
    view.render()
    for (let second = 0; second < 12; second++) {
      await vi.advanceTimersByTimeAsync(1000)
      view.render()
    }
    expect(view.text()).toContain('自动接续')
    expect(reads).toHaveLength(1)
    expect(reads[0]!.aborted).toBe(false)
  } finally { mounted.splice(0).forEach(view => view.unmount()); vi.useRealTimers() }
})

it.each(['task.completion', 'progress.completion', 'progress.completed'])('native view shows a disabled prepare action and done reason from %s', async fact => {
  const detail = taskDetail()
  if (fact === 'task.completion') detail.task!.completion = completion
  else detail.progress = { ref, title: 'Task continuation', children: [], stage: 'done', summary: 'Accepted', next: '', blockers: [], criteria: { passed: 1, total: 1, assessed: 1, current: true }, breakdown: [], ...(fact === 'progress.completion' ? { completion } : { processingState: 'completed' }) }
  const { view, controller } = await nativeView(detail)
  expect(prepareButton(view)?.props.disabled).toBe(true)
  expect(view.text()).toContain('任务阶段：done（已验收完成）')
  expect(view.text()).toContain('任务已验收完成，不能继续接续')
  expect(controller.client.command).not.toHaveBeenCalled()
})

it.each(['idle', 'inactive'] as const)('keeps an unfinished current Task available with a %s host observation and closed GitHub Issue', async status => {
  const detail = taskDetail()
  detail.executionGraph = { ref, executionId: 'e', sessions: [{ session, role: 'current', status, children: [], jobs: [] }], childTasks: [], events: [], history: [], settlement: 'settled', blockers: [], reminders: [], limitations: [] }
  detail.progress = { ref, title: 'Task continuation', children: [], stage: 'in-progress', processingState: 'processing', summary: 'Working', next: '', blockers: [], criteria: { passed: 0, total: 1, assessed: 0, current: true }, breakdown: [], source: { number: 1, url: 'https://github.com/acme/repo/issues/1', state: 'closed', observedAt: '2026-10-24T00:00:00Z' } }
  const { view } = await nativeView(detail)
  expect(prepareButton(view)).toBeDefined()
  expect(prepareButton(view).props.disabled).toBe(false)
  expect(view.text()).not.toContain('已验收完成')
})

it.each(['waiting', 'paused'] as const)('changes only the session while preserving %s control and using a fresh fence', async state => {
  const detail = taskDetail()
  detail.execution!.state = state
  detail.execution!.control = { commandId: 'hold', action: state === 'waiting' ? 'wait' : 'pause', status: 'applied', reason: '等待审查\n恢复条件：批准方案后明确恢复' }
  detail.executionGraph = { ref, executionId: 'e', sessions: [{ session, role: 'current', status: 'idle', children: [], jobs: [] }], childTasks: [], events: [], history: [], settlement: 'settled', blockers: [], reminders: [], limitations: [] }
  const { view, controller } = await nativeView(detail)
  const command = vi.fn(async (_value: unknown) => detail)
  controller.client.command = command
  const button = view.nodes('button').find(node => node.props.children === '仅换会话')
  expect(button).toBeDefined()
  expect(button?.props.disabled).toBe(false)
  expect(view.text()).toContain('恢复条件：批准方案后明确恢复')
  expect(view.text()).not.toContain('请先恢复处理，再准备接续')
  expect(view.nodes('button').some(node => node.props.children === '恢复处理')).toBe(true)
  view.click('仅换会话')
  await expect.poll(() => command.mock.calls.length).toBe(1)
  expect(command.mock.calls[0]![0]).toMatchObject({ type: 'task.continue', ref, executionId: 'e', owner: 'owner', epoch: 1 })
  expect(detail.execution!.state).toBe(state)
  expect(detail.execution!.control?.status).toBe('applied')
})

it.each(['running', 'unknown', 'pending-control'] as const)('keeps the session action short and explains the %s maintenance fence', async prerequisite => {
  const detail = taskDetail()
  detail.execution!.state = 'waiting'
  detail.executionGraph = { ref, executionId: 'e', sessions: [{ session, role: 'current', status: prerequisite === 'running' ? 'running' : 'idle', children: [], jobs: [] }], childTasks: [], events: [], history: [], settlement: prerequisite === 'unknown' ? 'unknown' : 'settled', blockers: [], reminders: [], limitations: [] }
  if (prerequisite === 'pending-control') detail.execution!.control = { commandId: 'hold', action: 'wait', status: 'accepted', reason: '等待审查' }
  const { view, controller } = await nativeView(detail)
  const button = view.nodes('button').find(node => node.props.children === '仅换会话')
  expect(button?.props.disabled).toBe(true)
  expect(button?.props.title).toContain(prerequisite === 'running' ? '等待本轮结束' : prerequisite === 'unknown' ? '刷新' : '请求尚未生效')
  expect(controller.client.command).not.toHaveBeenCalled()
})

it.each(['failed', 'accepted', 'creating'] as const)('explains why %s execution cannot prepare continuation', async state => {
  const detail = taskDetail()
  detail.execution!.state = state
  if (state === 'failed') detail.execution!.error = { code: 'incompatible-session', message: 'Existing Session model differs' }
  const { view, controller } = await nativeView(detail)
  expect(prepareButton(view)?.props.disabled).toBe(true)
  if (state === 'failed') {
    expect(view.text()).toContain('原执行恢复失败：incompatible-session')
    expect(view.nodes('button').some(node => node.props.children === '重试原执行')).toBe(true)
  } else expect(view.text()).toContain('原执行尚未就绪')
  expect(controller.client.command).not.toHaveBeenCalled()
})

it.each([true, false])('retries the existing execution with actual=%s using a freshly read fence', async hasActual => {
  const detail = taskDetail()
  if (!hasActual) delete detail.execution!.actual
  detail.execution!.state = 'failed'
  detail.execution!.error = { code: 'incompatible-session', message: 'Existing Session model differs' }
  const { view, controller } = await nativeView(detail)
  const command = vi.fn(async (_value: unknown) => {
    detail.execution!.state = 'ready'
    detail.execution!.actual = taskDetail().execution!.actual
    delete detail.execution!.error
    return detail
  })
  controller.client.command = command
  view.click('重试原执行')
  await expect.poll(() => command.mock.calls.length).toBe(1)
  expect(command.mock.calls[0]![0]).toMatchObject({ type: 'task.reconcile', ref, executionId: 'e', owner: 'owner', epoch: 1 })
  await expect.poll(() => prepareButton(view)?.props.disabled).toBe(false)
  expect(view.text()).not.toContain('原执行恢复失败')
})

it.each(['history', 'review', 'related', 'different-current', 'missing-actual'] as const)('does not enable native continuation for %s', async eligibility => {
  const detail = taskDetail()
  if (eligibility === 'different-current') detail.execution!.session = { ...session, sessionId: 'successor' }
  if (eligibility === 'missing-actual') delete detail.execution!.actual
  const { view } = await nativeView(detail, ['history', 'review', 'related'].includes(eligibility) ? eligibility as AssociatedWork['purpose'] : 'control')
  const button = prepareButton(view)
  expect(!button || button.props.disabled === true).toBe(true)
  expect(view.text()).not.toContain('已验收完成')
})

it('lets the native history view enter the authoritative current coordinator without a control command', async () => {
  const detail = taskDetail()
  detail.execution!.session = { ...session, sessionId: 'successor' }
  const { view, controller } = await nativeView(detail, 'history')
  const enter = vi.spyOn(controller, 'openCurrentTask').mockResolvedValue(undefined)
  expect(view.nodes('button').some(node => node.props.children === '进入会话')).toBe(true)
  view.click('进入会话')
  await expect.poll(() => enter.mock.calls.length).toBe(1)
  expect(enter).toHaveBeenCalledWith(ref, expect.any(AbortSignal))
  expect(controller.client.command).not.toHaveBeenCalled()
  for (const term of ['生命周期与操作', '创建', '本轮 Completed', '明确恢复', '历史归档', '普通新建', 'Issue 协调绑定', 'Goal activation', '人类']) expect(view.text()).toContain(term)
})

it.each(['task.completion', 'progress.completed'])('Issue continuation shows the same disabled action and done reason from %s', async fact => {
  const detail = taskDetail()
  if (fact === 'task.completion') detail.task!.completion = completion
  else detail.progress = { ref, title: 'Task continuation', children: [], stage: 'done', processingState: 'completed', summary: 'Accepted', next: '', blockers: [], criteria: { passed: 1, total: 1, assessed: 1, current: true }, breakdown: [] }
  const controller = controllerFor(detail)
  await controller.openTask(ref)
  controller.setDetailTab('continuation')
  const view = mountProductionComponent({ controller }, 'WorkPanel', undefined, { document: { addEventListener() {}, removeEventListener() {} } })
  mounted.push(view)
  expect(prepareButton(view)?.props.disabled).toBe(true)
  expect(view.text()).toContain('任务阶段：done（已验收完成）')
  expect(view.text()).toContain('任务已验收完成，不能继续接续')
  expect(controller.client.command).not.toHaveBeenCalled()
})
