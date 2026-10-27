import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Subagents from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { RuntimeHost } from '../src/task-runtime/host.ts'
import { WorkApplication } from '../src/work.ts'
import { installWorkTools } from '../src/work-execution/tools.ts'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import type { GitHubIssue, GitHubSourcePort } from '../src/work-sources/types.ts'
import type { WorkResult } from '../src/work-types.ts'

const actor = { operator: true }
function completed(result: WorkResult) {
  if (result.status !== 'completed') throw new Error(JSON.stringify(result))
  return result
}
const identity = { login: 'developer', nodeId: 'U_developer', name: null }
const issues: GitHubIssue[] = [1, 2, 3].map(number => ({
  parent: null, dependencies: { availability: 'available', blockedBy: { items: [], totalCount: 0, hasNextPage: false } },
  subIssues: { items: [], totalCount: 0, hasNextPage: false },
  nodeId: `I_queue_${number}`, number, title: `镜像管理 ${number}`, body: '验收：必须保留 stable 标签。',
  repository: { owner: 'example', repository: 'images' }, url: `https://github.com/example/images/issues/${number}`,
  state: 'open', labels: ['bug'], assignees: [number === 3 ? 'someone-else' : identity.login],
  updatedAt: '2026-10-21T00:00:00Z', observedAt: '2026-10-21T00:01:00Z',
}))
const source: GitHubSourcePort = {
  list: async () => ({ identity, items: issues, observedAt: issues[0]!.observedAt }),
  detail: async (_, number) => ({ identity, issue: issues.find(issue => issue.number === number)! }),
  project: async () => ({
    identity, project: { nodeId: 'PVT_queue', title: '镜像研发', url: 'https://github.com/orgs/example/projects/1', closed: false },
    items: issues.map(issue => ({ id: `item_${issue.nodeId}`, kind: 'issue', issueNodeId: issue.nodeId, archived: false, fields: [], fieldsPartial: false })),
    issues, observedAt: issues[0]!.observedAt,
  }),
}

it('dispatches assigned Project Issues through real DSH sessions, preserves pause-new semantics and continues after acceptance', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    // Real host sessions, presets, permissions and model loop. External observations,
    // model output and token metadata are controlled, with no GitHub writes.
    h.host.execution.measure = async () => ({ totalTokens: 1000, logRevision: 1, baseline: 'estimated', capacity: 1_000_000, outputReserve: 16_000, routeKey: 'contract/default', observedAt: '2026-10-21T00:01:00Z' })
    const app = new WorkApplication(h.app.directory, h.host, source)
    const execute = (command: unknown) => fixtures.run(async () => completed(await app.execute(command, actor)))
    const query = (request: unknown) => fixtures.run(async () => completed(await app.query(request, actor)))
    installWorkTools(h.ctx, app, 'runtime')
    const connected = await execute({ type: 'source.connect', commandId: 'connect', githubProject: { owner: 'example', type: 'org', number: 1 } })
    const project = connected.project!, projectId = project.id, sourceId = connected.source!.id
    await query({ type: 'source.issues', projectId, sourceId, page: 1, perPage: 20, assignee: '@me', state: 'open', refresh: true })
    const options = (await query({ type: 'source.execution-options', projectId, sourceId })).executionOptions!
    expect((await query({ type: 'project.detail', projectId })).tasks).toHaveLength(0)
    expect(h.model.requests).toHaveLength(0)
    await execute({ type: 'project.configure-continuation', commandId: 'context', projectId, expectedVersion: project.version,
      policy: { version: 1, enabled: true, targetTokens: 200_000, reserveTokens: 16_000 } })
    h.model.nextTool = { name: 'work_control', arguments: { action: 'wait', text: '确认镜像保留数量' } }
    await execute({ type: 'continuous.configure', commandId: 'enable', projectId, sourceId, expectedVersion: 0,
      assignee: '@me', labels: ['bug'], resource: options.resources[0]!.ref, model: options.defaults.model,
      agentPreset: options.defaults.agentPreset, permissionPreset: options.defaults.permissionPreset, enabled: true })
    const first = (await query({ type: 'project.detail', projectId })).tasks![0]!
    const firstRef = { projectId, taskId: first.id }
    const firstExecution = (await query({ type: 'task.detail', ref: firstRef })).execution!
    expect(firstExecution).toMatchObject({ continuationPolicy: { enabled: true, targetTokens: 200_000 }, actual: { permissionPreset: 'read-only', cwd: h.workspace.path } })
    const firstAgent = h.ctx.agents.get(SessionId(firstExecution.session.sessionId))!
    await fixtures.run(() => firstAgent.whenIdle())
    expect(JSON.stringify(h.model.requests[0]!.messages)).toContain(issues[0]!.url)
    const activeRule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    await execute({ type: 'continuous.set-enabled', commandId: 'pause-new', projectId, sourceId, expectedVersion: activeRule.version, enabled: false })
    await fixtures.run(() => app.reconcileControls())
    expect((await query({ type: 'project.detail', projectId })).tasks).toHaveLength(1)
    expect((await query({ type: 'task.detail', ref: firstRef })).execution).toMatchObject({ id: firstExecution.id, owner: firstExecution.owner, session: firstExecution.session })
    const currentTask = (await query({ type: 'task.detail', ref: firstRef })).task!
    completed(await fixtures.run(() => app.sessionOrganize(firstExecution.session, 'accept-source-criteria', {
      kind: 'specification', expectedVersion: currentTask.version, goal: currentTask.goal,
      specification: currentTask.specification.text, acceptance: ['必须保留 stable 标签'],
    })))
    const acceptedTask = (await query({ type: 'task.detail', ref: firstRef })).task!
    completed(await fixtures.run(() => app.sessionReport(firstExecution.session, 'verified', {
      specificationVersion: acceptedTask.specification.version, stage: 'done', summary: 'stable 标签保留验证通过', next: '', blockers: [],
      criteria: [{ index: 0, passed: true, evidence: ['清理前后 stable 标签保持一致的测试通过'] }],
    })))
    await fixtures.run(() => app.reconcileControls())
    expect((await query({ type: 'project.detail', projectId })).tasks).toHaveLength(1)
    expect((await query({ type: 'task.detail', ref: firstRef })).progress?.processingState).toBe('completed')
    const paused = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    h.model.nextTool = { name: 'work_control', arguments: { action: 'wait', text: '等待第二项确认' } }
    await execute({ type: 'continuous.set-enabled', commandId: 'resume-new', projectId, sourceId, expectedVersion: paused.version, enabled: true })
    await fixtures.run(() => app.reconcileContinuous())
    const tasks = (await query({ type: 'project.detail', projectId })).tasks!
    expect(tasks).toHaveLength(2)
    const second = tasks.find(task => task.id !== first.id)!
    const secondExecution = (await query({ type: 'task.detail', ref: { projectId, taskId: second.id } })).execution!
    await fixtures.run(() => h.ctx.agents.get(SessionId(secondExecution.session.sessionId))!.whenIdle())
    expect(secondExecution.session.sessionId).not.toBe(firstExecution.session.sessionId)
    expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(2)
    expect((await query({ type: 'task.detail', ref: firstRef })).execution!.id).toBe(firstExecution.id)
    expect(tasks.map(task => task.title)).not.toContain(issues[2]!.title)
  } finally { await fixtures.close() }
})

it('automatically hands a queued Issue to its successor without giving its slot to another Issue', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    let sourceTokens = 1000
    h.host.execution.measure = async execution => ({ totalTokens: execution.epoch === 1 ? sourceTokens : 1000, logRevision: 1, baseline: 'estimated', capacity: 1_000_000, outputReserve: 16_000, routeKey: 'contract/default', observedAt: '2026-10-21T00:01:00Z' })
    const app = new WorkApplication(h.app.directory, h.host, source)
    const execute = (command: unknown) => fixtures.run(async () => completed(await app.execute(command, actor)))
    const query = (request: unknown) => fixtures.run(async () => completed(await app.query(request, actor)))
    installWorkTools(h.ctx, app, 'runtime')
    const connected = await execute({ type: 'source.connect', commandId: 'connect', githubProject: { owner: 'example', type: 'org', number: 1 } })
    const project = connected.project!, projectId = project.id, sourceId = connected.source!.id
    await query({ type: 'source.issues', projectId, sourceId, page: 1, perPage: 20, assignee: '@me', state: 'open', refresh: true })
    await execute({ type: 'project.configure-continuation', commandId: 'context', projectId, expectedVersion: project.version,
      policy: { version: 1, enabled: true, targetTokens: 200_000, reserveTokens: 16_000 } })
    const options = (await query({ type: 'source.execution-options', projectId, sourceId })).executionOptions!
    await execute({ type: 'continuous.configure', commandId: 'enable', projectId, sourceId, expectedVersion: 0,
      assignee: '@me', labels: ['bug'], resource: options.resources[0]!.ref, model: options.defaults.model,
      agentPreset: options.defaults.agentPreset, permissionPreset: options.defaults.permissionPreset, enabled: true })
    const rule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    const ref = rule.active!
    const first = (await query({ type: 'task.detail', ref })).execution!
    await fixtures.run(() => h.ctx.agents.get(SessionId(first.session.sessionId))!.whenIdle())
    sourceTokens = 200_001
    const material = {
      body: `Original Issue ${issues[0]!.url}. Preserve the agreed image retention requirements.`,
      decisions: '镜像保留数量固定为 3，stable 标签必须保留。', evidence: '保留策略已确认。',
      unfinished: '验证清理结果。', next: '实现并验证 stable 标签保护。',
    }
    h.model.nextTool = { name: 'work_continuation_material', arguments: material }
    await fixtures.run(() => app.reconcileControls())
    await fixtures.run(() => h.ctx.agents.get(SessionId(first.session.sessionId))!.whenIdle())
    await fixtures.run(() => app.reconcileControls())
    const successor = (await query({ type: 'task.detail', ref })).execution!
    expect(successor).toMatchObject({ id: first.id, owner: first.owner, ref, epoch: 2,
      continuation: { automatic: true, phase: 'received', material: { decisions: material.decisions } } })
    await fixtures.run(() => h.ctx.agents.get(SessionId(successor.session.sessionId))!.whenIdle())
    expect(successor.session.sessionId).not.toBe(first.session.sessionId)
    expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(2)
    const currentRule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    expect(currentRule.active).toEqual(ref)
    expect(currentRule.items.map(item => item.state)).toEqual(['active', 'queued'])
    expect((await query({ type: 'project.detail', projectId })).tasks).toHaveLength(1)
    expect(JSON.stringify(h.model.requests.at(-1)!.messages)).toContain(material.decisions)
    expect(await app.sessionControl(first.session, 'retired-status', 'status')).toMatchObject({ status: 'failed', error: { code: 'forbidden' } })
  } finally { await fixtures.close() }
})

it.each(['wait', 'pause'] as const)('replaces a continuous %s Session without acquiring a business slot or requesting resume', async action => {
  const fixtures = new ExecutionFixtures()
  let release = () => {}
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    const app = new WorkApplication(h.app.directory, h.host, source)
    installWorkTools(h.ctx, app, 'runtime')
    const execute = (command: unknown) => fixtures.run(async () => completed(await app.execute(command, actor)))
    const query = (request: unknown) => fixtures.run(async () => completed(await app.query(request, actor)))
    const connected = await execute({ type: 'source.connect', commandId: 'connect', githubProject: { owner: 'example', type: 'org', number: 1 } })
    const projectId = connected.project!.id, sourceId = connected.source!.id
    await query({ type: 'source.issues', projectId, sourceId, page: 1, perPage: 20, assignee: '@me', state: 'open', refresh: true })
    const options = (await query({ type: 'source.execution-options', projectId, sourceId })).executionOptions!
    h.model.nextTool = { name: 'work_control', arguments: { action, text: 'Keep explicit business hold across session replacement' } }
    await execute({ type: 'continuous.configure', commandId: 'enable', projectId, sourceId, expectedVersion: 0, assignee: '@me', labels: ['bug'], resource: options.resources[0]!.ref, model: options.defaults.model, agentPreset: options.defaults.agentPreset, permissionPreset: options.defaults.permissionPreset, enabled: true })
    const active = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    const ref = active.active!
    const first = (await query({ type: 'task.detail', ref })).execution!
    await fixtures.run(() => h.ctx.agents.get(SessionId(first.session.sessionId))!.whenIdle())
    await execute({ type: 'continuous.set-enabled', commandId: 'pause-intake', projectId, sourceId, expectedVersion: active.version, enabled: false })
    await fixtures.run(() => app.reconcileControls())
    const held = (await query({ type: 'task.detail', ref })).execution!
    const beforeRule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    expect(beforeRule.active).toBeUndefined()
    await h.ctx.plugin(Subagents, { maxActiveSubagents: 8, maxDepth: 1 })
    h.ctx.subagents.registerProvider({ name: 'fresh-local', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
      async prepareContinuable() { return {} }, async start() { throw Error('Only native continuable creation is used') } })
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    h.ctx.tools.register(defineTool({ name: 'hold_native', description: 'A native result arriving after reservation', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
      async execute() { entered(); await gate; return { result: 'Required continuous native result' } } }))
    const parent = h.ctx.agents.get(SessionId(first.session.sessionId))!
    h.model.nextTool = { name: 'hold_native', arguments: {} }
    const child = await h.ctx.subagents.startContinuable({ provider: 'fresh-local', label: 'held continuous verification', request: { parent, prompt: [{ type: 'text', text: 'Return the required native result' }] }, signal: new AbortController().signal })
    await started
    const childAgent = h.ctx.agents.get(child.childId)!
    await execute({ type: 'task.continue', commandId: 'replace-only', ref, executionId: held.id, owner: held.owner, epoch: held.epoch })
    const unrelated = createUserMessage({ content: [{ type: 'text', text: 'Keep this automatic work queued under the original hold.' }], source: { kind: 'a2d2-work-dispatch' } })
    await fixtures.run(() => parent.runMaintenance(async () => {
      release()
      await childAgent.whenIdle()
      await expect.poll(() => [...parent.inbox.nextTurn, ...parent.inbox.nextStep].some(message => message.source?.kind === 'subagent-settled')).toBe(true)
      parent.inject(unrelated)
    }))
    await fixtures.run(() => parent.whenIdle())
    const log = await new RuntimeHost(h.ctx).events(parent.id)
    expect(log.filter(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled' && event.data.source.senderSessionId === child.childId)).toHaveLength(1)
    expect(log.some(event => event.type === 'user/message' && event.data.id === unrelated.id)).toBe(false)
    const intakeRule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    expect(intakeRule.slots ?? []).toEqual(beforeRule.slots ?? [])
    expect(intakeRule.items[0]!.resumeRequested).toBeUndefined()
    h.model.nextTool = { name: 'work_continuation_material', arguments: { body: 'Preserve the accepted Issue and explicit hold.', decisions: 'No business work until explicit resume.', evidence: 'Original hold and native result are applied.', unfinished: 'Wait for LF.', next: 'Remain waiting for explicit resume.' } }
    await fixtures.run(() => app.reconcileControls())
    await fixtures.run(() => h.ctx.agents.get(SessionId(first.session.sessionId))!.whenIdle())
    await fixtures.run(() => app.reconcileControls())
    const successor = (await query({ type: 'task.detail', ref })).execution!
    await fixtures.run(() => h.ctx.agents.get(SessionId(successor.session.sessionId))!.whenIdle())
    await fixtures.run(() => app.reconcileControls())
    const final = (await query({ type: 'task.detail', ref })).execution!
    expect(final).toMatchObject({ id: held.id, owner: held.owner, epoch: 2, state: held.state, control: held.control, continuation: { phase: 'received' } })
    const afterRule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    expect(afterRule.active).toBeUndefined()
    expect(afterRule.slots ?? []).toEqual(beforeRule.slots ?? [])
    expect(afterRule.items[0]!.resumeRequested).toBeUndefined()
    expect(afterRule.items[0]!.explicitResumeRequested).toBeUndefined()
    expect(afterRule.items[0]!.state).toBe(action === 'wait' ? 'waiting' : 'paused')
  } finally { release(); await fixtures.close() }
})
