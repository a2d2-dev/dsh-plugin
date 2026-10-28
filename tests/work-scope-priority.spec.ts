import { afterEach, beforeEach, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { installWorkTools } from '../src/work-execution/tools.ts'
import { installWorkOrganizationTools } from '../src/work-organization-tools.ts'
import type { WorkCompleted, WorkResult } from '../src/work-types.ts'

let fixtures: ExecutionFixtures
const operator = { operator: true }
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
function completed(result: WorkResult): WorkCompleted {
  if (result.status !== 'completed') throw Error(JSON.stringify(result))
  return result
}
async function setup() {
  const h = await fixtures.mount(await fixtures.root())
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const project = completed(await h.app.execute({ type: 'project.create', commandId: 'project', name: 'Scope priority', resource }, operator)).project!
  const task = completed(await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.id, title: 'Verify the current image', goal: 'Verify installation and cleanup',
    specification: 'Use the current environment; record exact counts and image provenance.', acceptance: ['Installation and cleanup verified', 'Exact counts and image provenance verified', 'Preserve data outside the authorized scope'] }, operator)).task!
  const ref = { projectId: project.id, taskId: task.id }
  installWorkTools(h.ctx, h.app, 'runtime')
  installWorkOrganizationTools(h.ctx, h.app, 'runtime')
  const execution = completed(await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: task.version, resource, agentId: project.defaultAgentId,
    agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)).execution!
  const agent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
  await fixtures.run(() => agent.whenIdle())
  return { ...h, task, ref, execution, agent }
}

// These assertions verify the assembled instruction contract, not model decisions.
it('assembles current-goal ordering and explicit revision instructions in the real startup request', async () => {
  const h = await setup()
  const prompt = JSON.stringify(h.model.requests[0]!.messages)
  expect(prompt).toContain('按真实业务依赖先取得可行结果')
  expect(prompt).toContain('同步 todo 计划、work_organize 持久规格与派发')
  expect(prompt).toContain('被明确修订替代的旧条款保留历史，不再作为当前门槛')
  expect(prompt).toContain('未获用户明确修订时保留原验收')
  expect(prompt).toContain('缺失时注明未验证')
  expect(prompt).toContain('只有证据表明会阻碍当前目标、破坏数据或使结果无效才作为执行阻塞')
  expect(prompt).toContain('安全和数据边界继续有效')
  expect(prompt).toContain('不能自动把审计发现升级为前置工程')
  expect(prompt).toContain('交接材料保存不等于实际接任')
  expect(prompt).toContain('关闭或结束当前会话只要求停止该会话，不等于放弃 Task 或本项队列处理')
  expect(prompt).toContain('后续仅解释目标也不撤销停止')
  expect(prompt).toContain('用宿主明确状态或回执核实当前操作、负责会话与后继接任')
  expect(prompt).toContain('执行该准确步骤后停止，由宿主继续转交')
  expect(prompt).toContain('不允许旧会话跨越转交执行业务，也不恢复用户已停止的工作')
})

it('exposes explicit user revisions and history preservation in the registered organize tool description', async () => {
  const h = await setup()
  const description = h.model.requests[0]!.tools!.find(tool => tool.name === 'work_organize')!.description
  expect(description).toContain('Explicit user revisions supersede the affected old criteria')
  expect(description).toContain('sync the todo plan, persistent specification and dispatches')
  expect(description).toContain('retain superseded requirements and the revision basis in history')
  expect(description).toContain('Without an explicit revision, preserve original acceptance')
})

it('retains original acceptance until explicitly revised, persists history and accepts only the current criteria', async () => {
  const h = await setup()
  const detail = () => h.app.query({ type: 'task.detail', ref: h.ref }, operator).then(completed)
  const original = (await detail()).task!
  // Controlled fixture evidence exercises acceptance bookkeeping, not a real installation.
  const initialReport = { specificationVersion: 1, stage: 'done' as const, summary: 'Fixture flow and data boundary checked; auxiliary metrics unverified', next: '', blockers: [],
    criteria: [{ index: 0, passed: true, evidence: ['fixture: installation and cleanup result'] }, { index: 2, passed: true, evidence: ['fixture: unrelated data unchanged'] }] }
  expect(await h.app.sessionReport(h.execution.session, 'original-still-required', initialReport)).toMatchObject({ status: 'failed', error: { code: 'acceptance-incomplete' } })
  expect((await detail()).task!.specification).toEqual(original.specification)

  const revision = 'Use the current image for installation and cleanup first; auxiliary exact counts and provenance may be missing. Preserve unrelated data.'
  completed(await h.app.execute({ type: 'task.input', commandId: 'explicit-user-revision', ref: h.ref, executionId: h.execution.id, owner: h.execution.owner, epoch: h.execution.epoch, text: revision, kind: 'input' }, operator))
  await fixtures.run(() => h.agent.whenIdle())
  expect(JSON.stringify(h.model.requests.at(-1)!.messages)).toContain(revision)
  const current = (await detail()).task!
  const acceptance = ['Installation and cleanup verified', 'Preserve data outside the authorized scope']
  const specification = `Explicit user revision: ${revision}\nExact counts and provenance remain unverified; the old precision requirement is superseded.`
  const result = await fixtures.run(() => h.ctx.tools.execute({ callId: ToolCallId('accept-explicit-revision'), name: 'work_organize',
    arguments: { action: 'specification', expected_version: current.version, expected_epoch: h.execution.epoch, goal: current.goal, specification, acceptance }, agent: h.agent, signal: new AbortController().signal }))
  expect(result.isError).toBe(false)
  const text = result.content.map(part => part.type === 'text' ? part.text : '').join('')
  expect(JSON.parse(text)).toMatchObject({ status: 'completed', saved: true, specificationVersion: 2 })

  const recovered = fixtures.application(h.app.directory, h.host)
  const saved = completed(await recovered.query({ type: 'task.detail', ref: h.ref }, operator)).task!
  expect(saved).toMatchObject({ id: original.id, goal: original.goal, specification: { version: 2, text: specification, acceptance }, specificationHistory: [original.specification] })
  expect(await recovered.sessionReport(h.execution.session, 'old-version-is-stale', initialReport)).toMatchObject({ status: 'failed', error: { code: 'stale-specification' } })
  const revisedReport = { ...initialReport, specificationVersion: 2, criteria: [initialReport.criteria[0]!, { ...initialReport.criteria[1]!, index: 1 }] }
  completed(await recovered.sessionReport(h.execution.session, 'current-acceptance', revisedReport))
  const accepted = completed(await recovered.query({ type: 'task.detail', ref: h.ref }, operator))
  expect(accepted).toMatchObject({ task: { completion: { specificationVersion: 2 }, specificationHistory: [original.specification] }, progress: { stage: 'done', criteria: { total: 2, passed: 2, current: true } } })
  expect(accepted.task!.progress!.summary).toContain('auxiliary metrics unverified')
})
