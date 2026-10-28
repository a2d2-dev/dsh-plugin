import { describe, expect, it, vi } from 'vitest'
import { WorkPanelController } from '../src/client/work-panel-controller.ts'
import { mountProductionComponent } from './client/production-component-harness.ts'
import type { WorkCompleted, WorkExecutionOptions, WorkQuery, WorkTask } from '../src/work-types.ts'

const resource = { runtimeId: 'host', workspaceId: 'chosen' }
const project = { id: 'p1', name: 'Project', version: 1, defaultAgentId: 'a1', resources: [resource] }
const issue = { nodeId: 'I197', number: 197, title: 'Remember settings', body: 'Accepted requirement', url: 'https://github.com/acme/repo/issues/197', repository: { owner: 'acme', repository: 'repo' }, state: 'open' as const, labels: [], assignees: [], updatedAt: '2026-10-28T00:00:00Z', observedAt: '2026-10-28T00:00:00Z' }
const source = { id: 's1', projectId: project.id, provider: 'github' as const, repository: issue.repository, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
const task: WorkTask = { id: 't1', projectId: project.id, title: issue.title, goal: issue.title, version: 1, agentId: 'a1', specification: { version: 1, text: issue.body, acceptance: ['Preserve selections'] }, specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [] }
const options = (): WorkExecutionOptions => ({
  agentId: 'a1', resources: [{ ref: { runtimeId: 'host', workspaceId: 'other' }, title: '/other' }, { ref: resource, title: '/chosen' }],
  models: [{ provider: 'provider', model: 'global' }, { provider: 'provider', model: 'chosen' }],
  agentPresets: ['default', 'chosen-agent'], permissionPresets: ['read-only', 'chosen-permission'],
  defaults: { model: { provider: 'provider', model: 'chosen', reasoningEffort: 'high' }, agentPreset: 'chosen-agent', permissionPreset: 'chosen-permission' },
  selection: { resource, model: { provider: 'provider', model: 'chosen', reasoningEffort: 'high' }, agentPreset: 'chosen-agent', permissionPreset: 'chosen-permission' }, selectionSource: 'remembered', fallbackReasons: [],
})
function fixture(choices = options()) {
  let imported = false
  const query = vi.fn(async (value: WorkQuery): Promise<WorkCompleted> => {
    if (value.type === 'projects.list') return { status: 'completed', projects: [project] }
    if (value.type === 'project.detail') return { status: 'completed', project, tasks: imported ? [task] : [] }
    if (value.type === 'source.list') return { status: 'completed', sources: [source] }
    if (value.type === 'source.issue') return { status: 'completed', source, issue, bindings: [] }
    if (value.type === 'source.execution-options' || value.type === 'task.execution-options') return { status: 'completed', executionOptions: choices }
    if (value.type === 'task.detail') return { status: 'completed', task }
    return { status: 'completed' }
  })
  const command = vi.fn(async (value: Parameters<WorkPanelController['client']['command']>[0]): Promise<WorkCompleted> => {
    if (value.type === 'source.import') { imported = true; return { status: 'completed', task, ref: { projectId: task.projectId, taskId: task.id } } }
    if (value.type === 'task.start') return { status: 'completed', task }
    throw Error(`Unexpected command ${value.type}`)
  })
  return { panel: new WorkPanelController({ query, command }, { selectPanel() {}, openSession() {} }), query, command, choices }
}
async function open(h: ReturnType<typeof fixture>) {
  await h.panel.load(); await h.panel.openIssue(issue.number, true, issue.nodeId)
}

describe('project execution settings in the production start flow', () => {
  it('preloads remembered settings without importing, renders collapsed controls and starts in one confirmation', async () => {
    const h = fixture(); await open(h); await h.panel.previewStart()
    expect(h.command).not.toHaveBeenCalled()
    expect(h.panel.getSnapshot().startup).toMatchObject({ preview: true, expanded: false, remember: true, selection: { resourceIndex: 1, modelIndex: 1, agentPreset: 'chosen-agent', permissionPreset: 'chosen-permission' } })
    const form = mountProductionComponent({ controller: h.panel }, 'CurrentExecution')
    expect(form.text()).toContain('执行设置 · 使用上次配置（可修改）')
    expect(form.nodes('details')[0].props.open).toBe(false)
    expect(form.nodes('button').find(node => node.props.type === 'submit')?.props.children).toBe('开始处理')
    form.submit()
    await vi.waitFor(() => expect(h.command.mock.calls.some(([value]) => value.type === 'task.start')).toBe(true))
    expect(h.command.mock.calls.map(([value]) => value.type)).toEqual(['source.import', 'task.start'])
    expect(h.command.mock.calls[1]![0]).toMatchObject({ resource, model: { provider: 'provider', model: 'chosen', reasoningEffort: 'high' }, agentPreset: 'chosen-agent', permissionPreset: 'chosen-permission', rememberExecutionDefaults: true })
    form.unmount()
  })
  it('submits expanded edits and opt-out by identity even when the catalog reorders before start', async () => {
    const h = fixture(); await open(h); await h.panel.previewStart()
    h.panel.setStartSettings({ expanded: true, remember: false })
    h.panel.selectStart({ modelIndex: 0, agentPreset: 'default', permissionPreset: 'read-only' })
    h.choices.resources.reverse(); h.choices.models.reverse()
    // Return a new catalog object, as the HTTP boundary does; the visible one keeps its own ordering.
    const fresh = { ...h.choices, resources: [...h.choices.resources], models: [...h.choices.models] }
    h.choices.resources.reverse(); h.choices.models.reverse()
    h.query.mockImplementation(async value => {
      if (value.type === 'task.detail') return { status: 'completed', task }
      if (value.type === 'source.execution-options' || value.type === 'task.execution-options') return { status: 'completed', executionOptions: fresh }
      return { status: 'completed', project, tasks: [] }
    })
    await h.panel.startPrepared()
    expect(h.command.mock.calls.at(-1)![0]).toMatchObject({ type: 'task.start', resource, model: { provider: 'provider', model: 'global' }, agentPreset: 'default', permissionPreset: 'read-only', rememberExecutionDefaults: false })
  })
  it('shows unavailable-history reasons and requires confirmation even when every remaining catalog is a singleton', async () => {
    const choices = options()
    choices.resources = [choices.resources[1]!]; choices.models = [choices.models[1]!]
    choices.agentPresets = ['chosen-agent']; choices.permissionPresets = ['chosen-permission']
    choices.selectionSource = 'project'; choices.fallbackReasons = ['上次的权限预设已不可用，已回退到项目默认。']
    const h = fixture(choices); await open(h); await h.panel.prepareStart(true)
    expect(h.command.mock.calls.map(([value]) => value.type)).toEqual(['source.import'])
    const form = mountProductionComponent({ controller: h.panel }, 'CurrentExecution')
    expect(form.text()).toContain(choices.fallbackReasons[0])
    expect(form.nodes('details')[0].props.open).toBe(true)
    expect(form.nodes('label').some(node => node.props.children?.[0] === '工作目录')).toBe(false)
    form.submit()
    await vi.waitFor(() => expect(h.command.mock.calls.at(-1)![0].type).toBe('task.start'))
    form.unmount()
  })
  it('keeps first-use confirmation and the existing all-singletons automatic-start path', async () => {
    const choices = options(); choices.selectionSource = 'host'; delete choices.selection
    const h = fixture(choices); await open(h); await h.panel.previewStart()
    expect(h.panel.getSnapshot().startup.options).toBeNull()
    await h.panel.prepareStart(true)
    expect(h.command.mock.calls.map(([value]) => value.type)).toEqual(['source.import'])
    const singleton = { ...choices, resources: [choices.resources[1]!], models: [choices.models[0]!], agentPresets: ['default'], permissionPresets: ['read-only'] }
    const single = fixture(singleton); await open(single); await single.panel.prepareStart(true)
    expect(single.command.mock.calls.map(([value]) => value.type)).toEqual(['source.import', 'task.start'])
  })
  it('does not start when a visible choice disappears during confirmation and displays the new fallback', async () => {
    const h = fixture(); await open(h); await h.panel.previewStart()
    h.query.mockImplementation(async value => value.type === 'task.detail' ? { status: 'completed', task } : { status: 'completed', executionOptions: { ...options(), permissionPresets: ['read-only'], defaults: { ...options().defaults, permissionPreset: 'read-only' } } })
    await h.panel.startPrepared()
    expect(h.command.mock.calls.map(([value]) => value.type)).toEqual(['source.import'])
    expect(h.panel.getSnapshot().startup.options?.fallbackReasons).toContain('刚才选择的执行配置已不可用，已重新选择默认值，请确认。')
    expect(h.panel.getSnapshot().startup.selection?.permissionPreset).toBe('read-only')
  })
  it('waits for the read-only settings preview before allowing a start intent', async () => {
    const h = fixture(); await open(h)
    let release!: (value: WorkCompleted) => void
    h.query.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = h.panel.previewStart()
    expect(h.panel.getSnapshot().startup.previewLoading).toBe(true)
    await h.panel.prepareStart(true)
    expect(h.command).not.toHaveBeenCalled()
    release({ status: 'completed', executionOptions: options() }); await pending
    expect(h.panel.getSnapshot().startup).toMatchObject({ previewLoading: false, preview: true })
    await h.panel.startPrepared()
    expect(h.command.mock.calls.map(([value]) => value.type)).toEqual(['source.import', 'task.start'])
  })
  it('ignores late read-only preview results after navigating away', async () => {
    const h = fixture(); await open(h)
    let release!: (value: WorkCompleted) => void
    h.query.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = h.panel.previewStart(); h.panel.setObject('projects')
    release({ status: 'completed', executionOptions: options() }); await pending
    expect(h.panel.getSnapshot().startup.options).toBeNull()
    expect(h.command).not.toHaveBeenCalled()
  })
})
