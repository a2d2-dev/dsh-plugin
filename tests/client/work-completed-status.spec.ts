import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { WorkCompleted, WorkExecution, WorkQuery, WorkTask } from '../../src/work-types.ts'
import type { TaskProgressView } from '../../src/work-progress.ts'

const ref = { projectId: 'p1', taskId: 't1' }
const current = { runtimeId: 'host', sessionId: 'current' }, retired = { runtimeId: 'host', sessionId: 'retired' }
const task: WorkTask = { id: 't1', projectId: 'p1', title: '已完成的工作', goal: '保留完成事实', version: 2, agentId: 'a1', specification: { version: 1, text: '规格', acceptance: ['已验证'] }, specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [] }
const execution: WorkExecution = { id: 'e1', ref, owner: 'owner', epoch: 2, agentId: 'a1', resource: { runtimeId: 'host', workspaceId: 'ws' }, session: current, sessionMode: 'create', agentPreset: 'standard', model: { provider: 'real', model: 'model' }, permissionPreset: 'read-only', policy: { version: 1, instructions: '', modelCandidates: [], capabilities: [] }, state: 'ready', history: [], events: [], control: { commandId: 'complete', action: 'wait', status: 'accepted', reason: '任务已按当前规格验收完成' }, retired: [{ session: retired, epoch: 1, operationId: 'handoff' }], actual: { runtimeId: 'host', cwd: '/workspace', agentPreset: 'standard', provider: 'real', model: 'model', permissionPreset: 'read-only', sandbox: 'read-only', approval: 'ask' } }
const issue = { nodeId: 'I1', number: 1, title: task.title, body: '正文', url: 'https://github.com/acme/repo/issues/1', repository: { owner: 'acme', repository: 'repo' }, assignees: [], labels: [], state: 'closed' as const, updatedAt: '2026-10-22', observedAt: '2026-10-22' }
const source = { id: 's1', projectId: 'p1', provider: 'github' as const, repository: issue.repository, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
function setup() {
  let saved = task, active = execution, complete = true, valid = true
  const progress = (): TaskProgressView => ({ ref, title: task.title, children: [], stage: complete ? 'done' : 'in-progress', summary: '验收记录已保存', next: '', blockers: [], criteria: { passed: 1, total: 1, assessed: 1, current: valid }, breakdown: [], execution: { id: 'e1', session: current, state: active.state, runtime: 'idle' }, source: { number: 1, url: issue.url, state: 'closed', observedAt: issue.observedAt } })
  const command = vi.fn(async (): Promise<WorkCompleted> => { throw Error('No writes permitted in presentation test') })
  const query = vi.fn(async (value: WorkQuery): Promise<WorkCompleted> => {
    if (value.type === 'projects.list') return { status: 'completed', projects: [{ id: 'p1', name: '项目', version: 1, defaultAgentId: 'a1', resources: [] }] }
    if (value.type === 'project.detail') return { status: 'completed', tasks: [saved, { ...task, id: 't2', title: '尚未开始' }], progressItems: [progress()] }
    if (value.type === 'task.detail') return { status: 'completed', task: saved, execution: active, executionRuntime: 'idle', progress: progress() }
    if (value.type === 'source.list') return { status: 'completed', sources: [source] }
    if (value.type === 'source.issues') return { status: 'completed', source, page: { identity: { login: 'user', nodeId: 'U1', name: null }, items: [issue], observedAt: issue.observedAt } }
    return { status: 'completed' }
  })
  const panel = new WorkPanelController({ command, query }, { selectPanel: vi.fn(), openSession: vi.fn() })
  return { panel, command, setTask: (value: WorkTask) => { saved = value }, setExecution: (value: WorkExecution) => { active = value }, setComplete: (value: boolean) => { complete = value }, setCurrent: (value: boolean) => { valid = value } }
}
const html = (panel: WorkPanelController) => renderToStaticMarkup(createElement(WorkPanel, { controller: panel }))

describe('completed execution presentation', () => {
  it('counts current and retired Sessions distinctly and includes managed executions in association filters', async () => {
    const h = setup(); await h.panel.load(); h.panel.setView('associated')
    expect(h.panel.visibleTasks().map(item => item.id)).toEqual(['t1'])
    h.panel.setView('unassociated'); expect(h.panel.visibleTasks().map(item => item.id)).toEqual(['t2'])
    await h.panel.openTask(ref)
    expect(html(h.panel)).toContain('2 个会话 · 当前 1 · 历史 1 · 其他关联 0')
    h.setTask({ ...task, sessions: [{ session: current, purpose: 'related' }, { session: retired, purpose: 'related' }, { session: { runtimeId: 'host', sessionId: 'review' }, purpose: 'review' }] })
    await h.panel.observeCurrent()
    expect(html(h.panel)).toContain('3 个会话 · 当前 1 · 历史 1 · 其他关联 1')
  })
  it('shows completion closeout instead of human waiting and hides execution controls until the specification changes', async () => {
    const h = setup(); await h.panel.openTask(ref)
    expect(html(h.panel)).toContain('正在收口')
    for (const label of ['暂停处理', '恢复处理', '接续到新会话', '等待回复', '等待请求']) expect(html(h.panel)).not.toContain(label)
    for (const label of ['进入当前会话', '查看记录']) expect(html(h.panel)).toContain(label)
    await h.panel.controlExecution('pause'); await h.panel.controlExecution('resume'); await h.panel.controlExecution('continue')
    expect(h.command).not.toHaveBeenCalled()
    h.setExecution({ ...execution, state: 'waiting', control: { ...execution.control!, status: 'applied' } })
    await h.panel.observeCurrent()
    expect(html(h.panel)).toContain('已收口')
    expect(html(h.panel)).not.toContain('恢复处理')
    h.setCurrent(false); await h.panel.observeCurrent()
    expect(html(h.panel)).toContain('等待回复')
    expect(html(h.panel)).toContain('恢复处理')
    expect(h.command).not.toHaveBeenCalled()
  })
  it('uses the same closeout mapping in Project and Issue rows while remote closed alone remains separate', async () => {
    const h = setup(); await h.panel.load()
    expect(html(h.panel)).toContain('正在收口')
    h.setExecution({ ...execution, state: 'waiting', control: { ...execution.control!, status: 'applied' } })
    await h.panel.observeCurrent()
    expect(html(h.panel)).toContain('已收口')
    expect(html(h.panel)).not.toContain('等待回复')
    await h.panel.showSources()
    expect(html(h.panel)).toContain('已收口')
    expect(html(h.panel)).not.toContain('等待回复')
    h.setComplete(false); await h.panel.observeCurrent()
    expect(html(h.panel)).toContain('等待回复')
    expect(html(h.panel)).not.toContain('已收口')
    expect(h.command).not.toHaveBeenCalled()
  })
})
