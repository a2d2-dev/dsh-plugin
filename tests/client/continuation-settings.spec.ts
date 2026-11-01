import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkApplication, WorkDao } from '../../src/work.ts'
import { WorkClientError } from '../../src/client/work-api.ts'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { WorkCommand, WorkExecution } from '../../src/work-types.ts'
import { mountProductionComponent } from './production-component-harness.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

async function settings() {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-continuation-settings-'))
  const app = new WorkApplication(directory, { resources: async () => [{ ref: { runtimeId: 'runtime', workspaceId: 'another' }, title: 'Another workspace' }], sessions: async () => [] })
  const command = vi.fn(async (value: WorkCommand) => {
    const result = await app.execute(value, { operator: true })
    if (result.status !== 'completed') throw new WorkClientError(result)
    return result
  })
  const panel = new WorkPanelController({ command, query: async value => {
    const result = await app.query(value, { operator: true })
    if (result.status !== 'completed') throw new WorkClientError(result)
    return result
  } }, { selectPanel() {}, openSession() {} })
  cleanups.push(async () => { panel.leavePanel(); await rm(directory, { recursive: true, force: true }) })
  const { project } = await panel.submit({ type: 'project.create', name: 'Policy scope' })
  const { task } = await panel.submit({ type: 'task.create', projectId: project!.id, title: 'Historical execution', goal: 'Preserve policy scopes', specification: 'Save settings', acceptance: ['Policy persisted'] })
  const ref = { projectId: project!.id, taskId: task!.id }
  // Reproduce the existing persisted execution with no override, after its
  // project defaults have changed several times. No host execution is started.
  const execution: WorkExecution = { id: randomUUID(), ref, owner: randomUUID(), epoch: 1, agentId: project!.defaultAgentId, resource: { runtimeId: 'runtime', workspaceId: 'ws' }, session: { runtimeId: 'runtime', sessionId: 'session' }, sessionMode: 'create', agentPreset: 'standard', model: { provider: 'test', model: 'test' }, permissionPreset: 'read-only', policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'ready', history: [], events: [] }
  await WorkDao.forDirectory(directory).transaction(async state => {
    state.executions.push(execution)
    state.projects[0]!.continuationPolicy = { version: 7, enabled: true, targetTokens: 300000, reserveTokens: 20000 }
    state.sources.push({ id: randomUUID(), projectId: project!.id, provider: 'github', repository: { owner: 'acme', repository: 'qa' }, enabled: true, version: 1, sequence: 0, requests: {}, observations: [], pages: [] })
  })
  await panel.load(); await panel.openTask(ref); panel.setDetailTab('continuation')
  const view = mountProductionComponent({ controller: panel }, 'WorkPanel', undefined, { document: { addEventListener() {}, removeEventListener() {} } })
  cleanups.push(async () => view.unmount())
  command.mockClear()
  return { app, panel, view, command, ref }
}

it('first saves inherited values at execution version one, then advances only that scope through presets and custom values', async () => {
  const { app, panel, view, command, ref } = await settings()
  expect(view.inputs().map(input => input.props.value)).toEqual(['300000', '20000'])
  const projectPolicy = panel.getSnapshot().projects[0]!.continuationPolicy
  for (const [index, enabled, preset, target, reserve] of [[1, 'on', '300K', '300000', '20000'], [2, 'off', '200K', '200000', '16000'], [3, 'on', null, '245678', '23456']] as const) {
    view.change(view.nodes('select')[0], enabled)
    if (preset) view.click(preset)
    else view.change(view.inputs()[0], target)
    view.change(view.inputs()[1], reserve)
    view.submit()
    await vi.waitFor(() => expect(command.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'task.configure-continuation', policy: { version: index } }))
    await vi.waitFor(() => expect(panel.getSnapshot().detail?.execution?.continuationPolicy).toEqual({ version: index, enabled: enabled === 'on', targetTokens: Number(target), reserveTokens: Number(reserve) }))
    expect((await app.query({ type: 'task.detail', ref }, { operator: true }))).toMatchObject({ execution: { continuationPolicy: { version: index, enabled: enabled === 'on', targetTokens: Number(target), reserveTokens: Number(reserve) } } })
    expect((await app.query({ type: 'project.detail', projectId: ref.projectId }, { operator: true }))).toMatchObject({ project: { continuationPolicy: projectPolicy } })
  }
  expect(command.mock.calls.map(([value]) => value.type)).toEqual(Array(3).fill('task.configure-continuation'))
})

it('rejects a stale execution save, refreshes the competing values and requires a new explicit save', async () => {
  const { app, panel, view, command, ref } = await settings()
  const execution = panel.getSnapshot().detail!.execution!
  const competingPolicy = { version: 1, enabled: false, targetTokens: 210000, reserveTokens: 18000 }
  expect(await app.execute({ type: 'task.configure-continuation', commandId: 'another-page', ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch, policy: competingPolicy }, { operator: true })).toMatchObject({ status: 'completed' })
  view.click('200K'); view.submit()
  await vi.waitFor(() => expect(view.text()).toContain('本次未保存，请刷新后核对设置，再重新保存'))
  expect(command).toHaveBeenCalledOnce()
  expect(view.nodes('button').find(button => button.props.type === 'submit')?.props.disabled).toBe(true)
  expect(await app.query({ type: 'task.detail', ref }, { operator: true })).toMatchObject({ execution: { continuationPolicy: competingPolicy } })
  view.click('刷新设置')
  await vi.waitFor(() => expect(view.inputs().map(input => input.props.value)).toEqual(['210000', '18000']))
  expect(command).toHaveBeenCalledOnce()
  view.click('300K'); view.submit()
  await vi.waitFor(() => expect(panel.getSnapshot().detail?.execution?.continuationPolicy).toEqual({ ...competingPolicy, version: 2, targetTokens: 300000 }))
  expect(command).toHaveBeenCalledTimes(2)
})

it('saves project defaults at their own version and refreshes a real stale project version without changing the execution', async () => {
  const { app, panel, view, command, ref } = await settings()
  panel.backToIssues()
  view.nodes('button').find(button => button.props['aria-label'] === '来源操作')!.props.onClick({ stopPropagation() {} })
  view.click('自动接续')
  view.click('200K'); view.change(view.inputs()[1], '22000'); view.submit()
  await vi.waitFor(() => expect(panel.getSnapshot().projects[0]?.continuationPolicy).toEqual({ version: 8, enabled: true, targetTokens: 200000, reserveTokens: 22000 }))
  expect(command.mock.calls[0]![0]).toMatchObject({ type: 'project.configure-continuation', policy: { version: 8 } })
  const project = panel.getSnapshot().projects[0]!
  expect(await app.execute({ type: 'project.attach-resource', commandId: 'another-project-edit', projectId: project.id, expectedVersion: project.version, resource: { runtimeId: 'runtime', workspaceId: 'another' } }, { operator: true })).toMatchObject({ status: 'completed' })
  view.submit()
  await vi.waitFor(() => expect(view.text()).toContain('本次未保存，请刷新后核对设置，再重新保存'))
  view.click('刷新设置')
  await vi.waitFor(() => expect(view.text()).not.toContain('本次未保存'))
  expect(command).toHaveBeenCalledTimes(2)
  view.change(view.nodes('select').find(select => ['on', 'off'].includes(select.props.value)), 'off')
  view.submit()
  await vi.waitFor(() => expect(panel.getSnapshot().projects[0]?.continuationPolicy).toMatchObject({ version: 9, enabled: false, targetTokens: 200000, reserveTokens: 22000 }))
  expect((await app.query({ type: 'task.detail', ref }, { operator: true }))).toMatchObject({ execution: { id: expect.any(String) } })
  const detail = await app.query({ type: 'task.detail', ref }, { operator: true })
  expect(detail.status === 'completed' && detail.execution?.continuationPolicy).toBeUndefined()
})
