import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { installWorkTools } from '../src/work-execution/tools.ts'
import { installWorkProgressTools } from '../src/work-progress-tools.ts'
import type { WorkGuard } from '../src/work-execution/guard.ts'
import { humanGuardIntent } from '../src/work-execution/guard.ts'

let fixtures: ExecutionFixtures
const operator = { operator: true }
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
async function setup(guard = true) {
  const root = await fixtures.root()
  const h = await fixtures.mount(root, 'danger-full-access', guard)
  let guardCallback: WorkGuard | undefined
  if (guard) {
    const connect = h.host.execution.connectGuard!.bind(h.host.execution)
    h.host.execution.connectGuard = callback => { guardCallback = callback; connect(callback) }
    h.app = fixtures.application(h.app.directory, h.host)
  }
  h.model.uniqueToolIds = true
  installWorkTools(h.ctx, h.app, 'runtime')
  installWorkProgressTools(h.ctx, h.app, 'runtime')
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const project = await h.app.execute({ type: 'project.create', commandId: 'project', name: 'Guard', resource }, operator)
  if (project.status !== 'completed' || !project.project) throw Error('Missing project')
  const task = await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.project.id, title: 'Authorized task', goal: 'Produce real proof', specification: 'Read dependency and save proof', acceptance: ['Proof file matches dependency'] }, operator)
  if (task.status !== 'completed' || !task.task) throw Error('Missing task')
  const ref = { projectId: project.project.id, taskId: task.task.id }
  await writeFile(join(root, 'dependency.txt'), 'READY-312')
  const start = async () => {
    const result = await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: 1, resource, agentId: project.project!.defaultAgentId,
      agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'danger-full-access' }, operator)
    if (result.status !== 'completed' || !result.execution) throw Error(JSON.stringify(result))
    const agent = h.ctx.agents.get(SessionId(result.execution.session.sessionId))!
    await fixtures.run(() => agent.whenIdle())
    return agent
  }
  return { ...h, ref, root, start, guard: () => guardCallback! }
}
const message = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

it.each(['没看懂，现在需要我做什么呢？', '到底是什么状态'])('corrects an old model wait after %s and executes the next real tool in the same turn', async question => {
  const h = await setup(false)
  h.model.nextTool = { name: 'work_control', arguments: { action: 'wait', text: '需要等待跨任务证据核实，请用户说继续。' } }
  const agent = await h.start()
  // Simulate upgrading/reloading the plugin with a pre-existing model-owned wait.
  const { DshWorkExecutionHost } = await import('../src/work-execution/dsh-host.ts')
  h.host.execution.connectGuard = DshWorkExecutionHost.prototype.connectGuard
  const upgraded = fixtures.application(h.app.directory, h.host)
  let next = 0
  const before = h.model.requests.length
  h.model.selectTool = () => {
    const request = h.model.requests.length - before
    if (request === 1) return undefined // The historical failure: apology only.
    if (next++ === 0) return { name: 'work_control', arguments: { action: 'resume', text: '已核实这是自身误设等待，继续原授权任务。' } }
    if (next === 2) return { name: 'read', arguments: { file_path: 'dependency.txt' } }
    if (next === 3) return { name: 'write', arguments: { file_path: 'proof.json', content: '{"dependency":"READY-312"}' } }
    return undefined
  }
  agent.followup(message(question))
  await fixtures.run(() => agent.whenIdle())
  expect(await readFile(join(h.root, 'proof.json'), 'utf8')).toBe('{"dependency":"READY-312"}')
  const events = agent.session.snapshotEvents()
  expect(events.filter(event => event.type === 'turn/end')).toHaveLength(2)
  expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(expect.arrayContaining(['read', 'write']))
  expect(await upgraded.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { executionGuard: { corrections: 0 }, control: { action: 'resume' } } })
}, 15000)

it('requires actual action after an active task status question, with no magic continue phrase', async () => {
  const h = await setup()
  h.model.nextTool = { name: 'read', arguments: { file_path: 'dependency.txt' } }
  const agent = await h.start()
  const before = h.model.requests.length
  h.model.selectTool = () => h.model.requests.length - before === 2 ? { name: 'write', arguments: { file_path: 'active-proof.txt', content: 'done' } } : undefined
  agent.followup(message('进度到哪里了？'))
  await fixtures.run(() => agent.whenIdle())
  expect(await readFile(join(h.root, 'active-proof.txt'), 'utf8')).toBe('done')
}, 15000)

it('bounds pure bookkeeping corrections and retains exhaustion across application reload and later turns', async () => {
  const h = await setup()
  let calls = 0
  h.model.selectTool = () => calls++ % 2 === 0 ? { name: 'work_control', arguments: { action: 'progress', text: `只是更新状态 ${calls}` } } : undefined
  const agent = await h.start()
  expect(h.model.requests).toHaveLength(6)
  expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { executionGuard: { corrections: 2, exhausted: true }, control: { action: 'wait', commandId: expect.stringMatching(/^guard:/) } } })
  const restored = fixtures.application(h.app.directory, h.host)
  const before = h.model.requests.length
  h.model.selectTool = undefined
  agent.followup(message('到底是什么状态'))
  await fixtures.run(() => agent.whenIdle())
  expect(h.model.requests).toHaveLength(before + 1)
  const detail = await restored.query({ type: 'task.detail', ref: h.ref }, operator)
  expect(detail.status === 'completed' && detail.task?.completion).toBeUndefined()
}, 15000)

it('does not let repeated identical file reads renew the correction budget', async () => {
  const h = await setup()
  let calls = 0
  h.model.selectTool = () => calls++ % 2 === 0 ? { name: 'read', arguments: { file_path: 'dependency.txt' } } : undefined
  const agent = await h.start()
  for (let turn = 0; turn < 2; turn++) {
    agent.followup(message('进度？'))
    await fixtures.run(() => agent.whenIdle())
  }
  expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { executionGuard: { corrections: 2, exhausted: true, progress: [expect.any(String)] } } })
  expect(h.model.requests.length).toBeLessThanOrEqual(10)
}, 15000)

it.each(['只回答当前状态，不要继续执行', '先暂停一下，告诉我进度', '别继续了，只说状态', 'Explain the state without resuming automatic work'])('honors the explicit user instruction %s', async text => {
  const h = await setup()
  h.model.nextTool = { name: 'read', arguments: { file_path: 'dependency.txt' } }
  const agent = await h.start()
  const before = h.model.requests.length
  agent.followup(message(text))
  await fixtures.run(() => agent.whenIdle())
  expect(h.model.requests).toHaveLength(before + 1)
}, 15000)

it('honors a structured external blocker and rejects internal or untracked executor waits', async () => {
  const h = await setup()
  h.model.nextTool = { name: 'work_control', arguments: { action: 'wait', text: '等待外部审批系统恢复', yield_reason: 'external', checked_facts: ['审批服务返回 unavailable'], wake_condition: '审批服务恢复并可读取审批结论' } }
  const agent = await h.start()
  expect(h.model.requests).toHaveLength(2)
  const session = { runtimeId: 'runtime', sessionId: agent.id }
  expect(await h.app.sessionControl(session, 'internal', 'wait', '需要读取证据', undefined, { reason: 'internal', checkedFacts: ['还没检查'], wakeCondition: '读资料' })).toMatchObject({ status: 'failed', error: { code: 'wait-actionable' } })
  expect(await h.app.sessionControl(session, 'untracked', 'wait', '等待不存在的子会话', undefined, { reason: 'executor', checkedFacts: ['只登记了派发意图'], wakeCondition: 'child returns', executor: { runtimeId: 'runtime', sessionId: 'missing' } })).toMatchObject({ status: 'failed', error: { code: 'wait-executor-unverified' } })
}, 15000)

it('uses only current native human intent, ignoring quoted stops and source material', () => {
  expect(humanGuardIntent([message('不是只回答，要继续做')])).toMatchObject({ answerOnly: false })
  expect(humanGuardIntent([message('原回复说“暂停一下”，现在到底什么状态？')])).toMatchObject({ answerOnly: false, recheckWait: true })
  expect(humanGuardIntent([{ ...message('暂停一下'), source: { kind: 'a2d2-work-context' } }])).toMatchObject({ answerOnly: false })
})

it.each(['child', 'job', 'approval'] as const)('allows a real host-observed pending %s without spending corrections', async pending => {
  const h = await setup()
  const session = { runtimeId: 'runtime', sessionId: 'pending-parent' }
  // Exercise the authority policy with the same public observation seam the adapter supplies.
  const observe = h.host.execution.observation!.bind(h.host.execution)
  h.host.execution.observation = async execution => {
    const facts = await observe(execution)
    const row = facts.sessions.find(item => item.role === 'current')!
    if (pending === 'approval') row.waitingHuman = true
    if (pending === 'child') row.children.push({ session: { ...session, sessionId: 'tracked-child' }, mode: 'continuable', status: 'running', result: 'pending', returned: false })
    if (pending === 'job') row.jobs.push({ id: 'tracked-job', owner: execution.session, kind: 'bash', label: 'real pending registry fact', status: 'running', result: 'pending', delivery: 'pending', acceptance: 'unassessed', persistence: 'process-local', availability: 'live' })
    return facts
  }
  await h.start()
  expect(h.model.requests).toHaveLength(1)
  const result = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  expect(result.status === 'completed' && result.execution?.executionGuard).toBeUndefined()
}, 15000)

it('does not wake a Session on resume observation or steer a paused, complete or unrelated Session', async () => {
  const h = await setup()
  h.model.nextTool = { name: 'read', arguments: { file_path: 'dependency.txt' } }
  const agent = await h.start()
  const before = h.model.requests.length
  const resume = await h.guard()(agent.id, { kind: 'resume' })
  expect(resume).toContain('任务尚未完成')
  expect(h.model.requests).toHaveLength(before)
  const stopping = { kind: 'stopping' as const, progress: [], answerOnly: false, recheckWait: false }
  expect(await h.guard()('unrelated-session', stopping)).toBeUndefined()
  await h.app.sessionControl({ runtimeId: 'runtime', sessionId: agent.id }, 'explicit-user-pause', 'pause', '用户明确暂停')
  expect(await h.guard()(agent.id, stopping)).toBeUndefined()
  await h.app.sessionControl({ runtimeId: 'runtime', sessionId: agent.id }, 'resume-before-acceptance', 'resume', '恢复验收')
  expect(await h.app.sessionReport({ runtimeId: 'runtime', sessionId: agent.id }, 'acceptance', { specificationVersion: 1, stage: 'done', summary: '真实文件已核实', next: '', blockers: [], criteria: [{ index: 0, passed: true, evidence: ['dependency.txt: READY-312'] }] })).toMatchObject({ status: 'completed' })
  expect(await h.guard()(agent.id, stopping)).toBeUndefined()
  expect(await h.guard()(agent.id, { kind: 'resume' })).toBeUndefined()
}, 15000)

it('does not replenish the budget from successful work_report bookkeeping', async () => {
  const h = await setup()
  let calls = 0
  h.model.selectTool = () => calls++ % 2 === 0 ? { name: 'work_report', arguments: { report: { specificationVersion: 1, stage: 'in-progress', summary: `仅写报告 ${calls}`, next: '执行实际工作', blockers: [], criteria: [] } } } : undefined
  await h.start()
  expect(h.model.requests).toHaveLength(6)
  expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { executionGuard: { corrections: 2, exhausted: true } } })
}, 15000)

it('keeps handoff maintenance narrow and never corrects the retired source Session', async () => {
  const h = await setup()
  h.model.nextTool = { name: 'read', arguments: { file_path: 'dependency.txt' } }
  const source = await h.start()
  const current = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  if (current.status !== 'completed' || !current.execution) throw Error('Missing execution')
  const execution = current.execution
  // No Goal is installed in this fixture; expose that truthful lifecycle fact.
  h.host.execution.disarmSource = async () => ({ status: 'none' })
  h.model.nextTool = { name: 'work_continuation_material', arguments: { body: 'Preserve dependency READY-312', decisions: 'Keep original authorization', evidence: 'dependency.txt was read', unfinished: 'Write and verify proof', next: 'Write proof.json' } }
  const before = h.model.requests.length
  await h.app.execute({ type: 'task.continue', commandId: 'handoff', ref: h.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }, operator)
  await fixtures.run(() => source.whenIdle())
  await fixtures.run(() => h.app.reconcileControls())
  const result = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  if (result.status !== 'completed' || !result.execution) throw Error('Missing successor')
  const successor = h.ctx.agents.get(SessionId(result.execution.session.sessionId))!
  await fixtures.run(() => successor.whenIdle())
  expect(result.execution.epoch).toBe(2)
  expect(result.execution.retired?.map(old => old.session.sessionId)).toContain(source.id)
  expect(h.model.requests.length - before).toBeLessThanOrEqual(4)
  expect(await h.guard()(source.id, { kind: 'stopping', progress: [], answerOnly: false, recheckWait: false })).toBeUndefined()
  expect(await h.guard()(source.id, { kind: 'resume' })).toBeUndefined()
}, 15000)
