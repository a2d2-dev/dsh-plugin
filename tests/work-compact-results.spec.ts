import { afterEach, beforeEach, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { installWorkTools } from '../src/work-execution/tools.ts'
import { installWorkProgressTools } from '../src/work-progress-tools.ts'
import { installWorkOrganizationTools } from '../src/work-organization-tools.ts'
import type { WorkCompleted, WorkResult } from '../src/work-types.ts'

let fixtures: ExecutionFixtures
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
const operator = { operator: true }
function completed(result: WorkResult): WorkCompleted {
  if (result.status !== 'completed') throw Error(JSON.stringify(result))
  return result
}
async function setup() {
  const h = await fixtures.mount(await fixtures.root())
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const project = completed(await h.app.execute({ type: 'project.create', commandId: 'project', name: 'Compact results', resource }, operator)).project!
  const task = completed(await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.id, title: 'Task', goal: 'Preserve requirements', specification: '完整规格：' + '要求'.repeat(4000), acceptance: ['Criterion A', 'Criterion B'] }, operator)).task!
  const ref = { projectId: project.id, taskId: task.id }
  installWorkTools(h.ctx, h.app, 'runtime')
  installWorkProgressTools(h.ctx, h.app, 'runtime')
  installWorkOrganizationTools(h.ctx, h.app, 'runtime')
  const execution = completed(await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: task.version, agentId: project.defaultAgentId, resource, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)).execution!
  const agent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
  await fixtures.run(() => agent.whenIdle())
  const invoke = async (name: string, args: Record<string, unknown>, id = crypto.randomUUID(), caller = agent) => {
    const result = await fixtures.run(() => h.ctx.tools.execute({ callId: ToolCallId(id), name, arguments: args, agent: caller, signal: new AbortController().signal }))
    const text = result.content.map(part => part.type === 'text' ? part.text : '').join('')
    return { value: JSON.parse(text), text }
  }
  const detail = async () => completed(await h.app.query({ type: 'task.detail', ref }, operator))
  return { ...h, task, execution, ref, agent, invoke, detail }
}

it('keeps status available after startup with ownership and versions but no task material', async () => {
  const h = await setup()
  const full = completed(await h.app.sessionControl(h.execution.session, 'full', 'status'))
  const result = await h.invoke('work_control', { action: 'status', known_specification_version: 1 })
  expect(result.value).toMatchObject({ status: 'completed', coordinator: true, epoch: 1, taskVersion: full.task!.version, specificationVersion: 1, specificationState: 'current' })
  expect(result.value).not.toHaveProperty('task')
  expect(result.value).not.toHaveProperty('execution')
  expect(result.text).not.toContain('完整规格')
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(2048)
  expect(full.task!.specification.text).toContain('完整规格')
})

it('organizes the accepted specification with a minimal result and exact version conflicts', async () => {
  const h = await setup()
  const before = (await h.detail()).task!
  const args = { action: 'specification', expected_version: before.version, goal: before.goal, specification: 'NEW SPEC ' + '约束'.repeat(4000), acceptance: before.specification.acceptance }
  const result = await h.invoke('work_organize', args)
  expect(result.value).toMatchObject({ status: 'completed', saved: true, action: 'specification', taskVersion: before.version + 1, specificationVersion: 2 })
  expect(result.value).not.toHaveProperty('task')
  expect(result.text).not.toContain('NEW SPEC')
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(2048)
  expect((await h.detail()).task!.specification.text).toBe(args.specification)
  expect((await h.invoke('work_organize', args)).value).toMatchObject({ status: 'conflict', error: { code: 'version-conflict', currentVersion: before.version + 1 } })
  expect((await h.invoke('work_control', { action: 'status', known_specification_version: 1 })).value).toMatchObject({ coordinator: true, specificationState: 'changed', specificationVersion: 2 })
})

it('reads all current requirements explicitly in bounded revision-checked pages', async () => {
  const h = await setup()
  const task = (await h.detail()).task!
  const args = { section: 'specification', expected_version: task.version, expected_epoch: 1 }
  let cursor = 0, revision: string | undefined, content = '', pages = 0
  do {
    const result = await h.invoke('work_read', { ...args, cursor, ...(revision ? { revision } : {}) })
    expect(result.value).toMatchObject({ status: 'completed', format: 'json-fragment', taskVersion: task.version, specificationVersion: 1, cursor })
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(16384)
    revision = result.value.revision
    content += result.value.content
    pages++
    if (result.value.complete) { expect(result.value.nextCursor).toBeUndefined(); break }
    expect(result.value.nextCursor).toBeGreaterThan(cursor)
    cursor = result.value.nextCursor
  } while (pages < 100)
  expect(pages).toBeGreaterThan(1)
  expect(JSON.parse(content)).toMatchObject({ goal: task.goal, specification: task.specification, children: [] })
  expect((await h.invoke('work_read', { ...args, cursor: 10 })).value.error.code).toBe('material-revision-required')
  const organized = await h.invoke('work_organize', { action: 'specification', expected_version: task.version, goal: task.goal, specification: 'Changed requirements', acceptance: ['Changed criterion'] })
  expect(organized.value.saved).toBe(true)
  expect((await h.invoke('work_read', { ...args, cursor, revision })).value).toMatchObject({ status: 'conflict', error: { code: 'version-conflict', currentVersion: task.version + 1 } })
  expect((await h.invoke('work_read', { ...args, expected_version: task.version + 1, cursor, revision })).value.error.code).toBe('material-changed')
})

it('saves progress without echoing the submitted report or historical Task and preserves errors', async () => {
  const h = await setup()
  const report = { specificationVersion: 1, stage: 'in-progress', summary: 'PRIVATE REPORT ' + '正文'.repeat(2000), next: 'Next action', blockers: [], criteria: [] }
  const result = await h.invoke('work_report', { report })
  expect(result.value).toMatchObject({ status: 'completed', saved: true, stage: 'in-progress', specificationVersion: 1 })
  expect(result.text).not.toContain('PRIVATE REPORT')
  expect(result.value).not.toHaveProperty('task')
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(2048)
  expect((await h.detail()).task!.progress!.summary).toBe(report.summary)
  const rejected = await h.invoke('work_report', { report: { ...report, criteria: [{ index: 0, passed: true, evidence: [] }] } })
  expect(rejected.value).toEqual({ status: 'failed', error: { code: 'missing-evidence', message: '通过的验收项必须附带可核验的证据' } })
  expect((await h.detail()).task!.progress!.stage).toBe('in-progress')
})
