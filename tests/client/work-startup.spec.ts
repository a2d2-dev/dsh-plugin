import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkClientError, type WorkClient } from '../../src/client/work-api.ts'
import type { WorkCommand, WorkCompleted, WorkExecution, WorkExecutionOptions, WorkTask } from '../../src/work-types.ts'

const ref = { projectId: 'p1', taskId: 't1' }
const resource = { runtimeId: 'host', workspaceId: 'workspace' }
const task: WorkTask = { id: 't1', projectId: 'p1', title: '处理真实工作', goal: '启动一次', version: 1, agentId: 'a1', specification: { version: 1, text: '保留全部规格', acceptance: ['执行一次'] }, specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [] }
const issue = { nodeId: 'I1', number: 1, title: task.title, body: 'Issue 原文', url: 'https://github.com/acme/repo/issues/1', repository: { owner: 'acme', repository: 'repo' }, assignees: [], labels: [], state: 'open' as const, updatedAt: '2026-10-21', observedAt: '2026-10-21' }
const source = { id: 's1', projectId: 'p1', provider: 'github' as const, githubProject:{owner:'acme',type:'org' as const,number:9}, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
const options: WorkExecutionOptions = { agentId: 'a1', resources: [{ ref: resource, title: '/workspace/project' }], models: [{ provider: 'real', model: 'default' }], agentPresets: ['standard'], permissionPresets: ['read-only'], defaults: { model: { provider: 'real', model: 'default' }, agentPreset: 'standard', permissionPreset: 'read-only' } }
const running = (): WorkExecution => ({ id: 'e1', ref, owner: 'owner', epoch: 1, agentId: 'a1', resource, session: { runtimeId: 'host', sessionId: 'native-current' }, sessionMode: 'create', agentPreset: 'standard', model: { provider: 'real', model: 'default' }, permissionPreset: 'read-only', policy: { version: 1, instructions: '', capabilities: ['coordination'], modelCandidates: [] }, state: 'ready', history: [], events: [{ id: 'kickoff:e1', text: '完整任务材料', kind: 'input', delivery: 'consumed', acceptance: 'unassessed' }], actual: { runtimeId: 'host', cwd: '/workspace/project', agentPreset: 'standard', provider: 'real', model: 'default', permissionPreset: 'read-only', sandbox: 'read-only', approval: 'ask' } })
function setup() {
  let saved = structuredClone(task), execution: WorkExecution | undefined
  let choices = structuredClone(options)
  const command = vi.fn(async (value: WorkCommand): Promise<WorkCompleted> => {
    if (value.type === 'source.import') return { status: 'completed', ref, task: saved }
    if (value.type === 'task.start') { execution = running(); saved = { ...saved, version: saved.version + 1 }; return { status: 'completed', execution } }
    if (value.type === 'task.control' && execution) { execution = { ...execution, state: value.action === 'pause' ? 'paused' : 'ready' }; return { status: 'completed', execution } }
    throw Error(`Unexpected command ${value.type}`)
  })
  const client: WorkClient = { command, query: vi.fn(async (query): Promise<WorkCompleted> => {
    if (query.type === 'projects.list') return { status: 'completed', projects: [{ id: 'p1', name: '真实项目', version: 1, defaultAgentId: 'a1', resources: [resource] }, { id: 'p2', name: '其他项目', version: 1, defaultAgentId: 'a2', resources: [] }] }
    if (query.type === 'project.detail') return { status: 'completed', tasks: query.projectId === 'p1' ? [saved] : [] }
    if (query.type === 'task.detail') return { status: 'completed', task: saved, ...(execution ? { execution, executionRuntime: 'idle' } : {}) }
    if ((query.type === 'task.execution-options'||query.type === 'source.execution-options')) return { status: 'completed', executionOptions: choices }
    if (query.type === 'source.list') return { status: 'completed', sources: [source] }
    if (query.type === 'source.issue') return { status: 'completed', source, issue }
    return { status: 'completed' }
  }) }
  const navigation = { selectPanel: vi.fn(), openSession: vi.fn() }
  const panel = new WorkPanelController(client, navigation)
  return { panel, client, command, navigation, setExecution: (value: WorkExecution) => { execution = value }, setOptions: (value: WorkExecutionOptions) => { choices = value } }
}
const html = (panel: WorkPanelController) => renderToStaticMarkup(createElement(WorkPanel, { controller: panel }))
async function openIssue(panel: WorkPanelController) { await panel.load(); await panel.showSources(); await panel.openIssue(1) }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

describe('explicit work startup', () => {
  it('imports an Issue once, starts once under repeated clicks, refreshes version and enters the native Session', async () => {
    const h = setup(); await openIssue(h.panel)
    expect(html(h.panel)).toContain('开始处理')
    expect(html(h.panel)).not.toContain('未提供任务启动能力')
    await Promise.all([h.panel.prepareStart(true), h.panel.prepareStart(true)])
    expect(h.command.mock.calls.map(([value]) => value.type)).toEqual(['source.import', 'task.start'])
    expect(h.command.mock.calls[1]![0]).toMatchObject({ type: 'task.start', expectedVersion: 1, resource, model: options.defaults.model, permissionPreset: 'read-only' })
    expect(h.panel.getSnapshot().detail?.task?.version).toBe(2)
    expect(h.panel.getSnapshot().tasks[0]?.version).toBe(2)
    expect(h.navigation.openSession).toHaveBeenCalledExactlyOnceWith('native-current')
  })
  it('offers only real choices with the default model selected and coalesces confirmation clicks', async () => {
    const h = setup(); h.setOptions({ ...options, models: [{ provider: 'real', model: 'other' }, ...options.models] })
    await h.panel.openTask(ref); await h.panel.prepareStart()
    expect(h.command).not.toHaveBeenCalled()
    expect(h.panel.getSnapshot().startup.selection?.modelIndex).toBe(1)
    for (const text of ['确认开始处理', '/workspace/project', 'read-only', 'real/default']) expect(html(h.panel)).toContain(text)
    h.panel.selectStart({ modelIndex: 0 })
    await Promise.all([h.panel.startPrepared(), h.panel.startPrepared()])
    expect(h.command).toHaveBeenCalledTimes(1)
    expect(h.command.mock.calls[0]![0]).toMatchObject({ type: 'task.start', model: { provider: 'real', model: 'other' } })
  })
  it('enters an existing execution without creating another or requesting new choices', async () => {
    const h = setup(); h.setExecution(running()); await h.panel.openTask(ref); await h.panel.prepareStart()
    expect(h.command).not.toHaveBeenCalled()
    expect(h.navigation.openSession).toHaveBeenCalledExactlyOnceWith('native-current')
    expect(vi.mocked(h.client.query).mock.calls.some(([query]) => (query.type === 'task.execution-options'||query.type === 'source.execution-options'))).toBe(false)
  })
  it('rechecks concurrent starts before confirmation and enters their Session instead of writing', async () => {
    const h = setup(); h.setOptions({ ...options, models: [...options.models, { provider: 'real', model: 'other' }] })
    await h.panel.openTask(ref); await h.panel.prepareStart(); h.setExecution(running()); await h.panel.startPrepared()
    expect(h.command).not.toHaveBeenCalled()
    expect(h.navigation.openSession).toHaveBeenCalledExactlyOnceWith('native-current')
  })
  it('shows HTTP completed plus execution.failed as a failure and never opens its reserved Session', async () => {
    const h = setup(); await h.panel.openTask(ref)
    h.command.mockImplementation(async () => { const execution = { ...running(), state: 'failed' as const, error: { code: 'host-create-unknown', message: '需要恢复原会话' } }; h.setExecution(execution); return { status: 'completed', execution } })
    await h.panel.prepareStart()
    expect(h.panel.getSnapshot().startup.error).toContain('host-create-unknown')
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(html(h.panel)).toContain('重试原执行')
    expect(html(h.panel)).not.toContain('Task 已完成')
  })
  it('does not navigate or start after an Issue import resolves on a different page', async () => {
    const h = setup(); await openIssue(h.panel)
    const gate = deferred(), original = h.client.command
    h.client.command = async command => { await gate.promise; return original(command) }
    const pending = h.panel.prepareStart(true); h.panel.backToIssues(); gate.resolve(); await pending
    expect(h.command.mock.calls.map(([value]) => value.type)).toEqual(['source.import'])
    expect(h.panel.getSnapshot().detail).toBeNull()
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.panel.getSnapshot().startup.busy).toBe(false)
  })
  it('does not steal navigation when start receipt arrives after panel exit', async () => {
    const h = setup(); await h.panel.openTask(ref)
    const gate = deferred(), entered = deferred(), original = h.client.command
    h.client.command = async command => { entered.resolve(); await gate.promise; return original(command) }
    const pending = h.panel.prepareStart(); await entered.promise; h.panel.close(); gate.resolve(); await pending
    expect(h.command).toHaveBeenCalledTimes(1)
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.navigation.selectPanel).toHaveBeenCalledWith(null)
  })
  it('suppresses stale choices after switching projects', async () => {
    const h = setup(); await h.panel.openTask(ref)
    const gate = deferred(), entered = deferred(), original = h.client.query
    h.client.query = async query => { if ((query.type === 'task.execution-options'||query.type === 'source.execution-options')) { entered.resolve(); await gate.promise }; return original(query) }
    const pending = h.panel.prepareStart(); await entered.promise; await h.panel.selectProject('p2'); gate.resolve(); await pending
    expect(h.panel.getSnapshot()).toMatchObject({ projectId: 'p2', detail: null, startup: { busy: false, options: null } })
    expect(h.command).not.toHaveBeenCalled()
  })
  it('retains the existing canonical Task when import reports ownership elsewhere', async () => {
    const h = setup(); await openIssue(h.panel)
    const original = h.client.command
    h.client.command = async command => { if (command.type === 'source.import') throw new WorkClientError({ status: 'conflict', error: { code: 'external-object-owned', message: 'Already imported' }, ref }); return original(command) }
    await h.panel.prepareStart(true)
    expect(h.command.mock.calls.map(([value]) => value.type)).toEqual(['task.start'])
    expect(h.navigation.openSession).toHaveBeenCalledWith('native-current')
  })
  it('explains missing resources without starting and preserves source material', async () => {
    const h = setup(); h.setOptions({ ...options, resources: [] }); await h.panel.openTask(ref); await h.panel.prepareStart()
    expect(h.panel.getSnapshot().startup.error).toContain('没有可用执行目录')
    expect(h.panel.getSnapshot().detail?.task?.specification.text).toBe(task.specification.text)
    expect(h.command).not.toHaveBeenCalled()
  })
  it('renders root Issue acceptance and children together without count-based completion', async () => {
    const h = setup(), child = { ...task, id: 'child', title: '子工作', parent: ref }
    const progress = { processingState:'blocked' as const, ref, title: task.title, children: [{ projectId: 'p1', taskId: 'child' }], stage: 'blocked' as const, summary: '等待评审', next: '核对证据', blockers: ['缺少验收截图'], criteria: { passed: 1, total: 3, assessed: 2, current: true }, breakdown: [], source: { number: 1, url: issue.url, state: 'closed' as const, observedAt: issue.observedAt } }
    const original = h.client.query
    h.client.query = async query => query.type === 'project.detail' ? { status: 'completed', tasks: [child, { ...task, children: [progress.children[0]!] }], progressItems: [progress] } : query.type==='task.detail'?{status:'completed',task:{...task,children:[progress.children[0]!]},progress,children:[child],bindings:[{provider:'github',nodeId:issue.nodeId,urls:[issue.url],sourceIds:['s1'],ref,accepted:{...issue,state:'closed'},lastObserved:{...issue,state:'closed'}}]}: original(query)
    await h.panel.load();await h.panel.openTask(ref)
    expect(h.panel.visibleTaskRows().map(row => [row.task.id, row.depth])).toEqual([['t1', 0], ['child', 1]])
    const rendered = html(h.panel)
    for (const text of ['验收通过 1 / 3 项', '已核验 2 项', '缺少验收截图', '远端状态：closed', '阻塞', '子需求']) expect(rendered).toContain(text)
    expect(rendered).not.toContain('已验收完成')
    expect(rendered).not.toContain('33%')
  })
  it('saves execution policy and manual handoff using current owner and epoch', async () => {
    const h = setup(); h.setExecution(running()); await h.panel.load(); await h.panel.openTask(ref)
    h.command.mockResolvedValue({ status: 'completed', execution: running() })
    const policy = { version: 1, enabled: true, targetTokens: 300000, reserveTokens: 16000 }
    await h.panel.saveContinuation(policy, true)
    expect(h.command.mock.calls[0]![0]).toMatchObject({ type: 'task.configure-continuation', ref, executionId: 'e1', owner: 'owner', epoch: 1, policy })
    await h.panel.controlExecution('continue')
    expect(h.command.mock.calls[1]![0]).toMatchObject({ type: 'task.continue', ref, executionId: 'e1', owner: 'owner', epoch: 1 })
    expect(html(h.panel)).toContain('提前接续目标（token）')
  })
  it('configures a GitHub Project source and reads Issues by node ID across repositories', async () => {
    const h = setup(); await h.panel.load()
    const projectSource = { ...source, repository: undefined, githubProject: { owner: 'acme', type: 'org' as const, number: 9 } }
    h.command.mockResolvedValue({ status: 'completed', source: projectSource })
    const original = h.client.query
    h.client.query = vi.fn(async (query): Promise<WorkCompleted> => query.type === 'source.issue' ? { status: 'completed', source: projectSource, issue: { ...issue, nodeId: 'OtherRepoIssue', repository: { owner: 'acme', repository: 'other' } } } : original(query))
    await h.panel.configureProjectSource('acme', 'org', 9)
    expect(h.command.mock.calls[0]![0]).toMatchObject({ type: 'source.configure-project', projectId: 'p1', githubProject: projectSource.githubProject })
    await h.panel.openIssue(1, true, 'OtherRepoIssue')
    expect(h.client.query).toHaveBeenLastCalledWith({ type: 'source.issue', projectId: 'p1', sourceId: 's1', number: 1, nodeId: 'OtherRepoIssue', refresh: true })
    expect(html(h.panel)).toContain('acme/other · #1')
  })
  it('distinguishes idle, persisted progress, wait application and business acceptance', async () => {
    const h = setup(); h.setExecution({ ...running(), state: 'waiting', progress: '规格已确认', control: { commandId: 'wait', action: 'wait', status: 'applied', reason: '等待决定' } }); await h.panel.openTask(ref)
    const rendered = html(h.panel)
    for (const text of ['空闲', '规格已确认', '等待已生效', '恢复处理', '已消费', '尚未验收']) expect(rendered).toContain(text === '等待已生效' ? '等待请求已生效' : text)
    await h.panel.controlExecution('resume')
    expect(h.command.mock.calls[0]![0]).toMatchObject({ type: 'task.control', executionId: 'e1', owner: 'owner', epoch: 1, action: 'resume' })
  })
})
