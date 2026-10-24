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

it.each(['history', 'review', 'related', 'different-current', 'missing-actual'] as const)('does not enable native continuation for %s', async eligibility => {
  const detail = taskDetail()
  if (eligibility === 'different-current') detail.execution!.session = { ...session, sessionId: 'successor' }
  if (eligibility === 'missing-actual') delete detail.execution!.actual
  const { view } = await nativeView(detail, ['history', 'review', 'related'].includes(eligibility) ? eligibility as AssociatedWork['purpose'] : 'control')
  const button = prepareButton(view)
  expect(!button || button.props.disabled === true).toBe(true)
  expect(view.text()).not.toContain('已验收完成')
})

it.each(['task.completion', 'progress.completed'])('Issue continuation shows the same disabled action and done reason from %s', async fact => {
  const detail = taskDetail()
  if (fact === 'task.completion') detail.task!.completion = completion
  else detail.progress = { ref, title: 'Task continuation', children: [], stage: 'done', processingState: 'completed', summary: 'Accepted', next: '', blockers: [], criteria: { passed: 1, total: 1, assessed: 1, current: true }, breakdown: [] }
  const controller = controllerFor(detail)
  await controller.openTask(ref)
  controller.setDetailTab('continuation')
  const view = mountProductionComponent({ controller }, 'WorkPanel')
  mounted.push(view)
  expect(prepareButton(view)?.props.disabled).toBe(true)
  expect(view.text()).toContain('任务阶段：done（已验收完成）')
  expect(view.text()).toContain('任务已验收完成，不能继续接续')
  expect(controller.client.command).not.toHaveBeenCalled()
})
