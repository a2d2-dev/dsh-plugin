import { afterEach, beforeEach, expect, it } from 'vitest'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { installWorkTools } from '../src/work-execution/tools.ts'
import { installWorkProgressTools } from '../src/work-progress-tools.ts'
import { installWorkOrganizationTools } from '../src/work-organization-tools.ts'
import { WorkApplication } from '../src/work.ts'
import type { GitHubIssue } from '../src/work-sources/types.ts'
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

it('keeps receipts bounded through large specification and handoff histories on real Sessions', async () => {
  const h = await setup()
  let execution = h.execution
  const payload = '历史材料😀\\n\\t"'.repeat(1200)
  const material = { body: payload, decisions: payload, evidence: payload, unfinished: payload, next: 'Continue verification' }
  const measurements: Array<Record<string, unknown>> = []
  const measure = async (label: string) => {
    const agent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
    const rawStatus = completed(await h.app.sessionControl(execution.session, 'status', 'status'))
    const status = await h.invoke('work_control', { action: 'status', known_specification_version: rawStatus.task!.specification.version }, crypto.randomUUID(), agent)
    const report = { specificationVersion: rawStatus.task!.specification.version, stage: 'in-progress' as const, summary: 'Verified partial progress', next: 'Continue', blockers: [], criteria: [] }
    const reportId = crypto.randomUUID()
    const rawReport = completed(await h.app.sessionReport(execution.session, reportId, report))
    const reportResult = await h.invoke('work_report', { report }, reportId, agent)
    const organization = { kind: 'specification' as const, expectedVersion: rawReport.task!.version, goal: rawReport.task!.goal, specification: rawReport.task!.specification.text, acceptance: rawReport.task!.specification.acceptance }
    const organizeId = crypto.randomUUID()
    const rawOrganize = completed(await h.app.sessionOrganize(execution.session, organizeId, organization))
    const organize = await h.invoke('work_organize', { action: organization.kind, expected_version: organization.expectedVersion, goal: organization.goal, specification: organization.specification, acceptance: organization.acceptance }, organizeId, agent)
    for (const [tool, raw, model] of [['status', rawStatus, status], ['report', rawReport, reportResult], ['organize', rawOrganize, organize]] as const) {
      const before = JSON.stringify(raw)
      expect(model.value.status).toBe('completed')
      expect(model.text).not.toContain('历史材料')
      expect(model.text).not.toContain('specificationHistory')
      expect(Buffer.byteLength(model.text)).toBeLessThanOrEqual(2048)
      measurements.push({ label, tool, beforeCharacters: before.length, beforeBytes: Buffer.byteLength(before), afterCharacters: model.text.length, afterBytes: Buffer.byteLength(model.text) })
    }
  }
  await measure('initial')
  for (let generation = 0; generation < 3; generation++) {
    for (let index = 0; index < 3; index++) {
      const task = (await h.detail()).task!
      completed(await h.app.sessionOrganize(execution.session, `history:${generation}:${index}`, { kind: 'specification', expectedVersion: task.version, goal: task.goal, specification: payload, acceptance: task.specification.acceptance }))
    }
    h.model.nextTool = { name: 'work_continuation_material', arguments: material }
    completed(await h.app.execute({ type: 'task.continue', commandId: `rotate:${generation}`, ref: h.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }, operator))
    await fixtures.run(() => h.ctx.agents.get(SessionId(execution.session.sessionId))!.whenIdle())
    await fixtures.run(() => h.app.reconcileControls())
    const current = completed(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).execution!
    expect(current.epoch).toBe(execution.epoch + 1)
    expect(current.continuation!.phase).toBe('delivered')
    const old = await fixtures.run(() => h.ctx.tools.execute({ callId: ToolCallId(crypto.randomUUID()), name: 'work_control', arguments: { action: 'status' }, agent: h.ctx.agents.get(SessionId(execution.session.sessionId))!, signal: new AbortController().signal }))
    expect(old.isError).toBe(false)
    expect(JSON.stringify(old)).toContain('forbidden')
    expect(JSON.stringify(old)).toContain(current.session.sessionId)
    expect(await h.app.sessionControl(execution.session, 'retired-status', 'status')).toMatchObject({ status: 'failed', error: { code: 'forbidden' } })
    const oldRead = await fixtures.run(() => h.ctx.tools.execute({ callId: ToolCallId(crypto.randomUUID()), name: 'work_read', arguments: { section: 'result', detail_id: 'a'.repeat(64), expected_version: 1 }, agent: h.ctx.agents.get(SessionId(execution.session.sessionId))!, signal: new AbortController().signal }))
    expect(oldRead.isError).toBe(false)
    expect(JSON.stringify(oldRead)).toContain('forbidden')
    execution = current
    await fixtures.run(() => h.ctx.agents.get(SessionId(execution.session.sessionId))!.whenIdle())
  }
  await measure('large-history')
  const final = await h.detail()
  expect(final.task!.specificationHistory.length).toBeGreaterThanOrEqual(10)
  expect(final.execution!.continuationHistory).toHaveLength(2)
  expect(JSON.stringify(final).length).toBeGreaterThan(300_000)
  for (const tool of ['status', 'report', 'organize']) {
    const initial = measurements.find(row => row.label === 'initial' && row.tool === tool)!
    const large = measurements.find(row => row.label === 'large-history' && row.tool === tool)!
    expect(Number(large.afterBytes) - Number(initial.afterBytes)).toBeLessThanOrEqual(10)
  }
  const large = measurements.filter(row => row.label === 'large-history')
  // The observed incident had 3 status + 4 reports + 1 organization response.
  const repeated = (field: string) => [3, 4, 1].reduce((sum, count, index) => sum + count * Number(large[index]![field]), 0)
  console.log(JSON.stringify({ fixture: 'issue-209-large-history', measurements, repeatedEight: { beforeCharacters: repeated('beforeCharacters'), beforeBytes: repeated('beforeBytes'), afterCharacters: repeated('afterCharacters'), afterBytes: repeated('afterBytes') } }))
}, 30_000)

it('flags missing imported criteria, accepts native scope compactly and denies foreign readers', async () => {
  const h = await setup()
  const identity = { login: 'fixture', nodeId: 'U_fixture', name: null }
  const issue: GitHubIssue = { nodeId: 'I_fixture', number: 209, url: 'https://github.com/example/repo/issues/209', repository: { owner: 'example', repository: 'repo' }, title: 'Source material', body: null, state: 'open', labels: [], assignees: [], updatedAt: '2026-10-21T00:00:00Z', observedAt: '2026-10-21T00:01:00Z', subIssues: { items: [], totalCount: 0, hasNextPage: false } }
  const app = new WorkApplication(h.app.directory, h.host, { list: async () => ({ identity, items: [issue], observedAt: issue.observedAt }), detail: async () => ({ identity, issue }) })
  const source = completed(await app.execute({ type: 'source.configure', commandId: 'source', projectId: h.ref.projectId, repository: issue.repository }, operator)).source!
  completed(await app.query({ type: 'source.issue', projectId: h.ref.projectId, sourceId: source.id, number: issue.number, refresh: true }, operator))
  const imported = completed(await app.execute({ type: 'source.import', commandId: 'import', projectId: h.ref.projectId, sourceId: source.id, nodeId: issue.nodeId }, operator))
  const execution = completed(await app.execute({ type: 'task.start', commandId: 'start-import', ref: imported.ref!, expectedVersion: imported.task!.version, agentId: imported.task!.agentId, resource: h.execution.resource, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)).execution!
  const agent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
  await fixtures.run(() => agent.whenIdle())
  const status = await h.invoke('work_control', { action: 'status', known_specification_version: 1 }, crypto.randomUUID(), agent)
  expect(status.value).toMatchObject({ coordinator: true, specificationState: 'missing' })
  const read = await h.invoke('work_read', { section: 'specification', expected_version: status.value.taskVersion }, crypto.randomUUID(), agent)
  expect(read.value.complete).toBe(true)
  expect(JSON.parse(read.value.content).specification).toMatchObject({ missing: ['body', 'acceptance'], acceptance: [] })
  const result = await h.invoke('work_organize', { action: 'source-children', expected_version: status.value.taskVersion, observed_at: issue.observedAt }, crypto.randomUUID(), agent)
  expect(result.value).toMatchObject({ status: 'completed', action: 'source-children', saved: true, taskVersion: status.value.taskVersion + 1 })
  expect(result.value).not.toHaveProperty('task')
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(2048)
  expect(completed(await app.query({ type: 'task.detail', ref: imported.ref! }, operator)).bindings![0]!.acceptedChildren).toMatchObject({ totalCount: 0, hasNextPage: false })
  const foreign = await fixtures.run(() => h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' }))
  const foreignAgent = h.ctx.agents.get(foreign.sessionId)!
  expect((await h.invoke('work_control', { action: 'status' }, crypto.randomUUID(), foreignAgent)).value).toMatchObject({ status: 'failed', coordinator: false, error: { code: 'forbidden' } })
  expect((await h.invoke('work_read', { section: 'specification', expected_version: result.value.taskVersion }, crypto.randomUUID(), foreignAgent)).value.error.code).toBe('forbidden')
})

it.each([1, 100, 1000])('bounds lost-job reminders for %i jobs while preserving accepted completion and complete audit details', async count => {
  const h = await setup()
  for (let index = 0; index < count; index++) {
    Reflect.apply(h.agent.session.append, h.agent.session, ['jobs/settled', { job: { id: `lost-job-${index}`, owner: h.agent.id, kind: 'bash', label: 'Historical verification '.repeat(20), status: 'completed' }, registryEpoch: 'previous-process', instanceId: `old-instance-${index}`, terminalResult: 'pending' }])
  }
  const facts = await h.host.execution.observation!(h.execution)
  expect(facts.settlement).toBe('settled')
  expect(facts.reminders).toHaveLength(count)
  const report = { specificationVersion: 1, stage: 'done', summary: 'Accepted with unreachable historical jobs', next: '', blockers: [], criteria: [0, 1].map(index => ({ index, passed: true, evidence: ['Verified result'] })) }
  const result = await h.invoke('work_report', { report })
  expect(result.value).toMatchObject({ status: 'completed', saved: true, stage: 'done', reminderCount: count, remindersTruncated: true, details: { access: 'audit-only', file: expect.any(String), relativeTo: 'work-store' } })
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(2048)
  expect((await h.detail()).task!.completion).toBeDefined()
  const file = join(h.app.directory, 'work-model-details', `${result.value.details.detail_id}.json`)
  expect(result.value.details.file).toBe(`work-model-details/${result.value.details.detail_id}.json`)
  const record = JSON.parse(await readFile(file, 'utf8'))
  expect(record).toMatchObject({ ref: h.ref, executionId: h.execution.id, source: h.execution.session })
  expect(record.diagnostics.reminders).toEqual(facts.reminders)
  expect((await stat(file)).mode & 0o777).toBe(0o600)
  expect((await stat(join(h.app.directory, 'work-model-details'))).mode & 0o777).toBe(0o700)
  const details = await h.invoke('work_read', { section: 'result', detail_id: result.value.details.detail_id, expected_version: result.value.taskVersion })
  expect(details.value.status).toBe('completed')
  expect((await h.invoke('work_control', { action: 'status' })).value).toMatchObject({ status: 'completed', coordinator: true })
  expect((await h.invoke('work_control', { action: 'resume', text: 'Try to resume completed work' })).value).toMatchObject({ status: 'failed', error: { code: 'task-completed' } })
  console.log(JSON.stringify({ fixture: 'lost-job-reminders', count: facts.reminders!.length, beforeBytes: Buffer.byteLength(JSON.stringify(facts.reminders)), afterBytes: Buffer.byteLength(result.text) }))
}, 30_000)

it('bounds aggregate completion errors and preserves their full actionable diagnostics', async () => {
  const h = await setup()
  for (let index = 0; index < 40; index++) {
    const child = await fixtures.run(() => h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' }))
    Reflect.apply(h.agent.session.append, h.agent.session, ['subagent/catalog', { version: 1, childId: child.sessionId, childCreatedAt: 1, mode: 'continuable', label: `Unsettled requirement ${index}` }])
  }
  const report = { specificationVersion: 1, stage: 'done' as const, summary: 'Attempt acceptance', next: '', blockers: [], criteria: [0, 1].map(index => ({ index, passed: true, evidence: ['Verified result'] })) }
  const raw = await h.app.sessionReport(h.execution.session, 'raw-blocker-error', report)
  expect(raw.status).toBe('failed')
  if (raw.status === 'completed') throw Error('Expected completion gate failure')
  expect(Buffer.byteLength(JSON.stringify(raw))).toBeGreaterThan(2048)
  const result = await h.invoke('work_report', { report })
  expect(result.value).toMatchObject({ status: 'failed', error: { code: 'completion-results-unsettled', messageTruncated: true, originalBytes: Buffer.byteLength(raw.error.message) }, details: { tool: 'work_read', section: 'result' } })
  expect(result.value.error.message).toContain('完成前须收取并核验必要执行结果')
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(2048)
  expect((await h.detail()).task!.completion).toBeUndefined()
  const status = await h.invoke('work_control', { action: 'status' })
  let cursor = 0, content = '', revision: string | undefined
  for (let page = 0; page < 100; page++) {
    const detail = await h.invoke('work_read', { section: 'result', detail_id: result.value.details.detail_id, expected_version: status.value.taskVersion, cursor, ...(revision ? { revision } : {}) })
    expect(detail.value.status).toBe('completed')
    expect(Buffer.byteLength(detail.text)).toBeLessThanOrEqual(16384)
    content += detail.value.content
    if (detail.value.complete) break
    cursor = detail.value.nextCursor
    revision = detail.value.revision
  }
  expect(JSON.parse(content).error).toEqual(raw.error)
  const args = { section: 'result', detail_id: result.value.details.detail_id, expected_version: status.value.taskVersion }
  for (const detail_id of ['../../work-v3', `${'a'.repeat(64)}/../work-v3`, 'not-a-content-id']) {
    expect((await h.invoke('work_read', { ...args, detail_id })).value.error.code).toBe('invalid-detail-id')
  }
  const file = join(h.app.directory, 'work-model-details', `${args.detail_id}.json`)
  const saved = await readFile(file, 'utf8')
  await writeFile(file, `${saved} `)
  expect((await h.invoke('work_read', args)).value.error.code).toBe('detail-integrity-failed')
  await writeFile(file, saved)
  const other = completed(await h.app.execute({ type: 'task.create', commandId: 'other-diagnostic-task', projectId: h.ref.projectId, title: 'Other task', goal: 'Separate authority', specification: 'Separate details', acceptance: ['Separate result'] }, operator)).task!
  const otherExecution = completed(await h.app.execute({ type: 'task.start', commandId: 'other-diagnostic-start', ref: { projectId: other.projectId, taskId: other.id }, expectedVersion: other.version, agentId: other.agentId, resource: h.execution.resource, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)).execution!
  const otherAgent = h.ctx.agents.get(SessionId(otherExecution.session.sessionId))!
  await fixtures.run(() => otherAgent.whenIdle())
  expect((await h.invoke('work_read', args, crypto.randomUUID(), otherAgent)).value).toMatchObject({ status: 'failed', error: { code: 'forbidden' } })
  await fixtures.dispose(h.ctx)
  const restored = await fixtures.mount(h.workspace.path)
  installWorkTools(restored.ctx, restored.app, 'runtime')
  const resolved = await fixtures.run(() => restored.ctx.sessionController.resolveAgent(SessionId(h.execution.session.sessionId)))
  if ('error' in resolved) throw Error(JSON.stringify(resolved))
  const restoredResult = await fixtures.run(() => restored.ctx.tools.execute({ callId: ToolCallId('restored-details'), name: 'work_read', arguments: args, agent: resolved.agent, signal: new AbortController().signal }))
  expect(restoredResult.isError).toBe(false)
  const restoredPage = JSON.parse(restoredResult.content.map(part => part.type === 'text' ? part.text : '').join(''))
  expect(restoredPage).toMatchObject({ status: 'completed', cursor: 0, content: content.slice(0, 2000) })
  console.log(JSON.stringify({ fixture: 'aggregate-blockers', beforeBytes: Buffer.byteLength(JSON.stringify(raw)), afterBytes: Buffer.byteLength(result.text) }))
}, 30_000)

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
