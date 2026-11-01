import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Subagents from '@deepseek-ai/dsh-subagent'
import LocalJobs from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { RuntimeHost } from '../src/task-runtime/host.ts'
import { WorkApplication, WorkDao } from '../src/work.ts'
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
    const reserved = await execute({ type: 'task.continue', commandId: 'replace-only', ref, executionId: held.id, owner: held.owner, epoch: held.epoch })
    expect(reserved.execution!.continuation).toMatchObject({ phase: 'material-requested', pendingChildren: [{ child: { sessionId: child.childId }, returned: false }] })
    await fixtures.run(() => parent.whenIdle())
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
    expect(log.filter(event => event.type === 'user/message' && event.data.id === unrelated.id)).toHaveLength(1)
    const intakeRule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    expect(intakeRule.slots ?? []).toEqual(beforeRule.slots ?? [])
    expect(intakeRule.items[0]!.resumeRequested).toBeUndefined()
    await fixtures.run(() => app.reconcileControls())
    h.model.nextTool = { name: 'work_continuation_material', arguments: { body: 'Preserve the accepted Issue and explicit hold.', decisions: 'No business work until explicit resume.', evidence: 'Original hold and native result are applied.', unfinished: 'Wait for LF.', next: 'Remain waiting for explicit resume.' } }
    await execute({ type: 'task.continue', commandId: 'retry-replace-only-material', ref, executionId: held.id, owner: held.owner, epoch: held.epoch })
    await fixtures.run(() => app.reconcileControls())
    await fixtures.run(() => h.ctx.agents.get(SessionId(first.session.sessionId))!.whenIdle())
    await fixtures.run(() => app.reconcileSessionControls(first.session.sessionId))
    const successor = (await query({ type: 'task.detail', ref })).execution!
    await fixtures.run(() => h.ctx.agents.get(SessionId(successor.session.sessionId))!.whenIdle())
    await fixtures.run(() => app.reconcileSessionControls(successor.session.sessionId))
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


it.each([
  ["Cannot read properties of undefined (reading 'observeSession')", false],
  ["Cannot read properties of undefined (reading 'observeSession')", true],
  ['Last model turn ended interrupted', false],
  ['Last model turn ended interrupted', true],
  ['Execution is idle without new actionable progress; send input or explicitly resume', true],
] as const)('reconciles historical protection %s (missing slot: %s) against the real current running Agent without interrupting its tool or duplicating work', async (reason, missingSlot) => {
  const fixtures = new ExecutionFixtures()
  let release = () => {}
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    const app = new WorkApplication(h.app.directory, h.host, source)
    const execute = (command: unknown) => fixtures.run(async () => completed(await app.execute(command, actor)))
    const query = (request: unknown) => fixtures.run(async () => completed(await app.query(request, actor)))
    const connected = await execute({ type: 'source.connect', commandId: 'connect', githubProject: { owner: 'example', type: 'org', number: 1 } })
    const projectId = connected.project!.id, sourceId = connected.source!.id
    await query({ type: 'source.issues', projectId, sourceId, page: 1, perPage: 20, assignee: '@me', state: 'open', refresh: true })
    const options = (await query({ type: 'source.execution-options', projectId, sourceId })).executionOptions!
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    h.ctx.tools.register(defineTool({ name: 'hold_recovery', description: 'Keep a real running tool across queue reconciliation', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
      async execute() { entered(); await gate; return { result: 'Original tool completed' } } }))
    if (reason === 'Last model turn ended interrupted') h.model.selectTool = () => { throw new Error('Historical provider interruption') }
    else h.model.nextTool = { name: 'hold_recovery', arguments: {} }
    await execute({ type: 'continuous.configure', commandId: 'enable', projectId, sourceId, expectedVersion: 0, assignee: '@me', labels: ['bug'], resource: options.resources[0]!.ref, model: options.defaults.model, agentPreset: options.defaults.agentPreset, permissionPreset: options.defaults.permissionPreset, enabled: true })
    const rule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    const ref = rule.active!
    const first = (await query({ type: 'task.detail', ref })).execution!
    const agent = h.ctx.agents.get(SessionId(first.session.sessionId))!
    if (reason === 'Last model turn ended interrupted') {
      await fixtures.run(() => agent.whenIdle())
      const failure = await h.host.execution.failure!(first)
      expect(failure?.message).toContain('Historical provider interruption')
      await WorkDao.forDirectory(h.app.directory).transaction(async state => { state.executions.find(item => item.id === first.id)!.runtimeFailure = failure })
      h.model.selectTool = undefined
      h.model.nextTool = { name: 'hold_recovery', arguments: {} }
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue the already authorized work after recovering the provider.' }], source: { kind: 'user' } }))
    }
    await started
    if (reason === 'Last model turn ended interrupted') expect(await h.host.execution.failure!(first)).toBeUndefined()
    const requests = h.model.requests.length
    await WorkDao.forDirectory(h.app.directory).transaction(async state => {
      const item = state.continuousRules![0]!.items[0]!
      item.state = 'blocked'; item.recoveryBlocked = true
      item.reason = reason
      if (missingSlot) { state.continuousRules![0]!.slots = []; delete state.continuousRules![0]!.active }
    })
    await fixtures.run(() => app.reconcileContinuous())
    const after = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    expect(after.items[0]).toMatchObject({ state: 'active', ref, executionId: first.id })
    expect(after.items[0]!.recoveryBlocked).toBeUndefined()
    expect(after.error).toBeUndefined()
    expect(after.slots).toEqual([ref])
    expect(agent.status).toBe('running')
    expect(h.ctx.agents.get(agent.id)).toBe(agent)
    expect(h.model.requests).toHaveLength(requests)
    expect((await query({ type: 'project.detail', projectId })).tasks).toHaveLength(1)
    expect((await query({ type: 'task.detail', ref })).execution).toMatchObject({ id: first.id, session: first.session, owner: first.owner, epoch: first.epoch, model: first.model, permissionPreset: first.permissionPreset })
    await fixtures.run(() => app.reconcileContinuous())
    expect((await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!.slots).toEqual([ref])
    expect(h.model.requests).toHaveLength(requests)
    expect((await query({ type: 'task.detail', ref })).execution!.runtimeFailure).toBeUndefined()
    release()
    await fixtures.run(() => agent.whenIdle())
    await fixtures.run(() => app.reconcileControls())
    const rotated = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    expect(rotated.items[0]).toMatchObject({ state: 'blocked', reason: expect.stringContaining('idle without new actionable progress') })
    expect(rotated.slots).not.toContainEqual(ref)
    expect(rotated.items[1]!.state).toBe('active')
    expect((await query({ type: 'project.detail', projectId })).tasks).toHaveLength(2)
  } finally { release(); await fixtures.close() }
}, 20_000)

it.each([
  ['reconcile', false], ['resume', false], ['input', false], ['reconcile', true],
] as const)('retries a native user Stop on the first explicit %s before any status ingress or scheduler observation (check fences: %s)', async (recovery, checkFences) => {
  const fixtures = new ExecutionFixtures()
  let release = () => {}
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only', true)
    const app = new WorkApplication(h.app.directory, h.host, source)
    const execute = (command: unknown) => fixtures.run(async () => completed(await app.execute(command, actor)))
    const query = (request: unknown) => fixtures.run(async () => completed(await app.query(request, actor)))
    const connected = await execute({ type: 'source.connect', commandId: 'connect-unobserved-stop', githubProject: { owner: 'example', type: 'org', number: 1 } })
    const projectId = connected.project!.id, sourceId = connected.source!.id
    await query({ type: 'source.issues', projectId, sourceId, page: 1, perPage: 20, assignee: '@me', state: 'open', refresh: true })
    const options = (await query({ type: 'source.execution-options', projectId, sourceId })).executionOptions!
    let entered = 0
    h.ctx.tools.register(defineTool({ name: 'hold_unobserved_stop', description: 'Keep the real Agent running until native cancellation or test release', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
      async execute(_, exec) {
        entered++
        await new Promise<void>(resolve => { release = resolve; exec.signal.addEventListener('abort', () => resolve(), { once: true }) })
        return { result: 'Pending result processed' }
      } }))
    h.model.uniqueToolIds = true
    h.model.nextTool = { name: 'hold_unobserved_stop', arguments: {} }
    await execute({ type: 'continuous.configure', commandId: 'enable-unobserved-stop', projectId, sourceId, expectedVersion: 0, assignee: '@me', labels: ['bug'], resource: options.resources[0]!.ref, model: options.defaults.model, agentPreset: options.defaults.agentPreset, permissionPreset: options.defaults.permissionPreset, enabled: true })
    const rule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!, ref = rule.active!
    const first = (await query({ type: 'task.detail', ref })).execution!
    const agent = h.ctx.agents.get(SessionId(first.session.sessionId))!
    await vi.waitFor(() => expect(entered).toBe(1))
    await execute({ type: 'continuous.set-enabled', commandId: 'pause-intake-unobserved-stop', projectId, sourceId, expectedVersion: rule.version, enabled: false })
    agent.cancel({ kind: 'user' })
    await fixtures.run(() => agent.whenIdle())
    const stopped = await h.host.execution.failure!(first)
    expect(stopped).toMatchObject({ userCancelled: true })
    expect((await query({ type: 'task.detail', ref })).execution!.runtimeFailure).toBeUndefined()
    const authority = { ref, executionId: first.id, owner: first.owner, epoch: first.epoch }
    const retry = recovery === 'reconcile' ? { type: 'task.reconcile', commandId: 'retry-unobserved-stop', ...authority }
      : recovery === 'resume' ? { type: 'task.control', commandId: 'retry-unobserved-stop', ...authority, action: 'resume', text: '明确恢复原任务。' }
        : { type: 'task.input', commandId: 'retry-unobserved-stop', ...authority, kind: 'input', text: '明确授权继续处理原任务。' }
    const recoveryActor = recovery === 'input' ? { operator: false, session: first.session, agentId: first.agentId } : actor
    if (checkFences) {
      const failure = h.host.execution.failure!.bind(h.host.execution)
      const observation = vi.spyOn(h.host.execution, 'failure')
      for (const invalid of [{ owner: '11111111-1111-4111-8111-111111111111' }, { epoch: first.epoch + 1 }, { ref: { ...ref, taskId: '22222222-2222-4222-8222-222222222222' } }]) {
        expect(await fixtures.run(() => app.execute({ ...retry, ...invalid }, actor))).toMatchObject({ status: 'failed' })
      }
      expect(await fixtures.run(() => app.execute(retry, { operator: false, session: { ...first.session, sessionId: 'historical-session' }, agentId: first.agentId }))).toMatchObject({ status: 'failed', error: { code: 'forbidden' } })
      expect(observation).not.toHaveBeenCalled()
      observation.mockRejectedValueOnce(new Error('Host failure log is unavailable'))
      expect(await fixtures.run(() => app.execute(retry, actor))).toMatchObject({ status: 'failed', error: { code: 'host-observation-failed' } })
      expect((await query({ type: 'task.detail', ref })).execution!.runtimeFailure).toBeUndefined()
      for (const change of ['owner', 'epoch', 'session'] as const) {
        observation.mockImplementationOnce(async execution => {
          const observed = await failure(execution)
          // This write completing also proves slow host observation owns no DAO writer lock.
          await WorkDao.forDirectory(h.app.directory).transaction(async state => {
            const current = state.executions.find(item => item.id === first.id)!
            if (change === 'owner') current.owner = '11111111-1111-4111-8111-111111111111'
            else if (change === 'epoch') current.epoch++
            else current.session = { ...current.session, sessionId: 'replacement-session' }
          })
          return observed
        })
        const refused = await fixtures.run(() => app.execute(retry, actor))
        expect(refused, JSON.stringify({ change, refused })).toMatchObject({ status: 'failed', error: { code: 'stale-execution-authority' } })
        expect((await query({ type: 'task.detail', ref })).execution!.runtimeFailure).toBeUndefined()
        await WorkDao.forDirectory(h.app.directory).transaction(async state => {
          Object.assign(state.executions.find(item => item.id === first.id)!, { owner: first.owner, epoch: first.epoch, session: first.session })
        })
      }
      observation.mockRestore()
    }
    h.model.nextTool = { name: 'hold_unobserved_stop', arguments: {} }
    completed(await fixtures.run(() => app.execute(retry, recoveryActor)))
    if (recovery === 'reconcile') {
      // A required result arrives after the explicit retry but before scheduling.
      // Accepting this result must neither observe nor acknowledge native Stop.
      await WorkDao.forDirectory(h.app.directory).transaction(async state => {
        state.executions.find(item => item.id === first.id)!.events.push({ id: 'pending-result-after-retry', kind: 'result', text: '已接受的必要结果，等待明确重试。', delivery: 'accepted', acceptance: 'unassessed' })
      })
    }
    await fixtures.run(() => app.reconcileControls())
    await vi.waitFor(() => expect(entered).toBe(2))
    await fixtures.run(() => app.reconcileControls())
    const resumedRule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    expect(resumedRule.items[0]!.state).toBe('active')
    expect(resumedRule.slots).toEqual([ref])
    const resumed = (await query({ type: 'task.detail', ref })).execution!
    expect(resumed.runtimeFailure?.userCancelled && !resumed.runtimeFailure.acknowledged).not.toBe(true)
    expect((await query({ type: 'task.detail', ref })).execution).toMatchObject({ id: first.id, owner: first.owner, epoch: first.epoch, session: first.session })
    expect((await query({ type: 'project.detail', projectId })).tasks).toHaveLength(1)
    agent.cancel({ kind: 'user' })
    await fixtures.run(() => agent.whenIdle())
    const laterStop = await h.host.execution.failure!(first)
    expect(laterStop).toMatchObject({ userCancelled: true })
    expect(laterStop!.id).not.toBe(stopped!.id)
    completed(await fixtures.run(() => app.execute(retry, recoveryActor)))
    await fixtures.run(() => app.reconcileControls())
    const replayed = (await query({ type: 'task.detail', ref })).execution!
    expect(replayed.runtimeFailure).toMatchObject({ id: laterStop!.id, userCancelled: true })
    expect(replayed.runtimeFailure!.acknowledged).not.toBe(true)
    expect((await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!.items[0]!.state).toBe('blocked')
    expect(entered).toBe(2)
  } finally { release(); await fixtures.close() }
}, 20_000)

it.each([
  [true, true], [false, true], [false, false],
] as const)('preserves a native user Stop across a human status turn (previously observed: %s, scan while running: %s)', async (previouslyObserved, scanWhileRunning) => {
  const fixtures = new ExecutionFixtures()
  let release = () => {}
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only', true)
    const app = new WorkApplication(h.app.directory, h.host, source, undefined, { enabled: scanWhileRunning })
    const execute = (command: unknown) => fixtures.run(async () => completed(await app.execute(command, actor)))
    const query = (request: unknown) => fixtures.run(async () => completed(await app.query(request, actor)))
    const connected = await execute({ type: 'source.connect', commandId: 'connect-stop', githubProject: { owner: 'example', type: 'org', number: 1 } })
    const projectId = connected.project!.id, sourceId = connected.source!.id
    await query({ type: 'source.issues', projectId, sourceId, page: 1, perPage: 20, assignee: '@me', state: 'open', refresh: true })
    const options = (await query({ type: 'source.execution-options', projectId, sourceId })).executionOptions!
    let entered = 0
    h.ctx.tools.register(defineTool({ name: 'hold_user_stop', description: 'Keep native conversation running after user Stop', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
      async execute(_, exec) {
        entered++
        await new Promise<void>(resolve => { release = resolve; exec.signal.addEventListener('abort', () => resolve(), { once: true }) })
        return { result: 'Status evidence read' }
      } }))
    h.model.uniqueToolIds = true
    h.model.nextTool = { name: 'hold_user_stop', arguments: {} }
    await execute({ type: 'continuous.configure', commandId: 'enable-stop', projectId, sourceId, expectedVersion: 0, assignee: '@me', labels: ['bug'], resource: options.resources[0]!.ref, model: options.defaults.model, agentPreset: options.defaults.agentPreset, permissionPreset: options.defaults.permissionPreset, enabled: true })
    const rule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!, ref = rule.active!
    const first = (await query({ type: 'task.detail', ref })).execution!
    const agent = h.ctx.agents.get(SessionId(first.session.sessionId))!
    await vi.waitFor(() => expect(entered).toBe(1))
    await execute({ type: 'continuous.set-enabled', commandId: 'pause-intake-stop', projectId, sourceId, expectedVersion: rule.version, enabled: false })
    agent.cancel({ kind: 'user' })
    await fixtures.run(() => agent.whenIdle())
    const stopped = await h.host.execution.failure!(first)
    expect(stopped).toMatchObject({ userCancelled: true, message: expect.stringContaining('Last model turn ended aborted') })
    if (previouslyObserved) {
      await fixtures.run(() => app.reconcileControls())
      expect((await query({ type: 'task.detail', ref })).execution!.runtimeFailure).toEqual(stopped)
      expect((await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!.slots).not.toContainEqual(ref)
    }
    h.model.nextTool = { name: 'hold_user_stop', arguments: {} }
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '现在是什么状态？只回答状态。' }], source: { kind: 'user' } }))
    await vi.waitFor(() => expect(entered).toBe(2))
    if (!scanWhileRunning) {
      release()
      await fixtures.run(() => agent.whenIdle())
    }
    const requests = h.model.requests.length
    await fixtures.run(() => app.reconcileControls())
    const during = (await query({ type: 'task.detail', ref })).execution!
    expect(during.runtimeFailure).toEqual(stopped)
    const duringRule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    expect(duringRule.items[0]).toMatchObject({ state: 'blocked', reason: stopped!.message })
    if (!previouslyObserved && scanWhileRunning) expect(duringRule.slots).toContainEqual(ref)
    else expect(duringRule.slots).not.toContainEqual(ref)
    expect(duringRule.items[0]!.resumeRequested).toBeUndefined()
    expect(agent.status).toBe(scanWhileRunning ? 'running' : 'idle')
    expect(h.model.requests).toHaveLength(requests)
    expect(during).toMatchObject({ id: first.id, owner: first.owner, epoch: first.epoch, session: first.session })
    expect(during.control).toEqual(first.control)
    release()
    await fixtures.run(() => agent.whenIdle())
    const last = (await new RuntimeHost(h.ctx).events(agent.id)).findLast(event => event.type === 'turn/end')!
    expect(last.data.reason.kind).toBe('completed')
    await fixtures.run(() => app.reconcileControls())
    expect((await query({ type: 'task.detail', ref })).execution!.runtimeFailure).toEqual(stopped)
    const after = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    expect(after.items[0]).toMatchObject({ state: 'blocked', reason: stopped!.message })
    expect(after.slots).not.toContainEqual(ref)
    expect((await query({ type: 'project.detail', projectId })).tasks).toHaveLength(1)
    const authority = { ref, executionId: first.id, owner: first.owner, epoch: first.epoch }
    if (scanWhileRunning) {
      if (!previouslyObserved) {
        await execute({ type: 'task.input', commandId: 'result-awaiting-retry', ...authority, kind: 'result', text: '仅保存待处理事实，等待显式恢复。' })
        expect((await query({ type: 'task.detail', ref })).execution!.runtimeFailure).toEqual(stopped)
      }
      h.model.nextTool = { name: 'hold_user_stop', arguments: {} }
      await execute(previouslyObserved
        ? { type: 'task.control', commandId: 'resume-native-stop', ...authority, action: 'resume', text: '明确继续原任务' }
        : { type: 'task.reconcile', commandId: 'retry-native-stop', ...authority })
      await fixtures.run(() => app.reconcileControls())
      await vi.waitFor(() => expect(entered).toBe(3))
      await fixtures.run(() => app.reconcileControls())
      expect((await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!.slots).toContainEqual(ref)
      const resumedFailure = (await query({ type: 'task.detail', ref })).execution!.runtimeFailure
      expect(resumedFailure?.userCancelled && !resumedFailure.acknowledged).not.toBe(true)
    } else {
      await execute({ type: 'task.input', commandId: 'business-input-after-stop', ...authority, kind: 'input', text: '已明确授权继续处理原任务' })
      expect((await query({ type: 'task.detail', ref })).execution!.runtimeFailure?.acknowledged).toBe(true)
      // Business input retains the existing pause-intake ordering policy.
      expect((await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!.slots).not.toContainEqual(ref)
    }
  } finally { release(); await fixtures.close() }
}, 20_000)

it('ends a real running root and native child through public cancellation, retaining capacity until owner jobs stop', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  const releaseTools = new Map<string, () => void>()
  let finishJob = () => {}
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    await h.ctx.plugin(LocalJobs)
    await h.ctx.plugin(ToolJobs, { completionDelivery: 'quiet' })
    await h.ctx.plugin(Subagents, { maxActiveSubagents: 8, maxDepth: 1 })
    h.ctx.subagents.registerProvider({ name: 'queue-end-native', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
      async prepareContinuable() { return {} }, async start() { throw Error('Only native continuable creation is used') } })
    const app = new WorkApplication(h.app.directory, h.host, source)
    const execute = (command: unknown) => fixtures.run(async () => completed(await app.execute(command, actor)))
    const query = (request: unknown) => fixtures.run(async () => completed(await app.query(request, actor)))
    installWorkTools(h.ctx, app, 'runtime')
    const connected = await execute({ type: 'source.connect', commandId: 'end-connect', githubProject: { owner: 'example', type: 'org', number: 1 } })
    const projectId = connected.project!.id, sourceId = connected.source!.id
    await query({ type: 'source.issues', projectId, sourceId, page: 1, perPage: 20, assignee: '@me', state: 'open', refresh: true })
    const options = (await query({ type: 'source.execution-options', projectId, sourceId })).executionOptions!
    await execute({ type: 'continuous.configure', commandId: 'end-configure', projectId, sourceId, expectedVersion: 0, assignee: '@me', labels: ['bug'], resource: options.resources[0]!.ref, model: options.defaults.model, agentPreset: options.defaults.agentPreset, permissionPreset: options.defaults.permissionPreset, enabled: true })
    const rule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!, ref = rule.active!
    const execution = (await query({ type: 'task.detail', ref })).execution!
    const parent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
    await fixtures.run(() => parent.whenIdle())
    const jobIds: ReturnType<typeof h.ctx.jobs.start>[] = []
    let jobCancelled = false
    h.ctx.tools.register(defineTool({ name: 'hold_queue_end', description: 'Held cancellation-aware real tool', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
      async execute(_, exec) {
        if (exec.agent!.id === parent.id) {
          jobIds.push(h.ctx.jobs.start({ kind: 'bash', owner: parent.id, label: 'retained terminal output', run(job) { job.append('unconsumed terminal evidence'); return { done: Promise.resolve({ status: 'completed', result: 'unaccepted evidence' }), cancel() {} } } }))
          jobIds.push(h.ctx.jobs.start({ kind: 'bash', owner: parent.id, label: 'cooperative stop pending', run(job) {
            job.append('partial output retained')
            const done = new Promise<{ status: 'killed'; result: string }>(resolve => { finishJob = () => resolve({ status: 'killed', result: 'stopped without acceptance' }) })
            return { done, cancel() { jobCancelled = true } }
          } }))
        }
        await new Promise<void>(resolve => { releaseTools.set(exec.agent!.id, resolve); exec.signal.addEventListener('abort', () => resolve(), { once: true }) })
        return { result: 'held tool settled' }
      } }))
    h.model.nextTool = { name: 'hold_queue_end', arguments: {} }
    const child = await fixtures.run(() => h.ctx.subagents.startContinuable({ provider: 'queue-end-native', label: 'owned native work', request: { parent, prompt: [{ type: 'text', text: 'Hold until cancelled' }] }, signal: signal! }))
    await vi.waitFor(() => expect(releaseTools.has(child.childId)).toBe(true))
    const unrelated = await fixtures.run(() => h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' }))
    const other = h.ctx.agents.get(unrelated.sessionId)!
    h.model.nextTool = { name: 'hold_queue_end', arguments: {} }
    other.followup(createUserMessage({ content: [{ type: 'text', text: 'Independent held work' }], source: { kind: 'user' } }))
    await vi.waitFor(() => expect(releaseTools.has(other.id)).toBe(true))
    await execute({ type: 'task.associate-session', commandId: 'end-review', ref, expectedVersion: (await query({ type: 'task.detail', ref })).task!.version, session: { runtimeId: 'runtime', sessionId: other.id }, purpose: 'review' })
    h.model.nextTool = { name: 'hold_queue_end', arguments: {} }
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Hold root work too' }], source: { kind: 'user' } }))
    await vi.waitFor(() => expect(releaseTools.has(parent.id)).toBe(true))
    await execute({ type: 'continuous.set-enabled', commandId: 'end-pause-intake', projectId, sourceId, expectedVersion: (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!.version, enabled: false })
    const taskBefore = (await query({ type: 'task.detail', ref })).task!
    const beforeLog = parent.session.snapshotEvents()
    const end = { type: 'task.control', commandId: 'real-end', ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch, action: 'end', text: '明确结束这条队列处理，不声明验收' }
    const pending = await execute(end)
    expect(pending.execution).toMatchObject({ control: { action: 'end', status: 'accepted' }, error: { code: expect.stringMatching(/^queue-end-/) } })
    expect(jobCancelled).toBe(true)
    await vi.waitFor(() => expect(parent.status).toBe('idle'))
    expect(h.ctx.agents.get(child.childId)?.status ?? 'inactive').not.toBe('running')
    expect(other.status).not.toBe('idle')
    expect((await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!.slots).toContainEqual(ref)
    finishJob()
    await fixtures.run(() => h.ctx.jobs.wait(jobIds[1]!, 1000, parent.id))
    await vi.waitFor(() => expect(h.ctx.agents.get(child.childId)).toBeUndefined())
    await fixtures.run(() => app.reconcileControls())
    const ended = await query({ type: 'task.detail', ref })
    expect(ended.execution, JSON.stringify(ended.execution?.error)).toMatchObject({ control: { action: 'end', status: 'applied' }, state: 'paused' })
    const finalRule = (await query({ type: 'continuous.status', projectId, sourceId })).continuousRule!
    expect(finalRule.slots).not.toContainEqual(ref)
    expect(finalRule.items[0]).toMatchObject({ state: 'completed', end: { status: 'applied' } })
    expect(finalRule.items.slice(1)).toEqual(rule.items.slice(1))
    const detail = await query({ type: 'task.detail', ref })
    expect(detail.task).toEqual(taskBefore)
    expect(detail.task!.completion).toBeUndefined()
    expect(detail.execution!.events).toEqual(expect.arrayContaining(execution.events))
    expect(parent.session.snapshotEvents()).toContainEqual(expect.objectContaining({ type: 'user/message', data: expect.objectContaining({ source: expect.objectContaining({ kind: 'subagent-settled', senderSessionId: child.childId }) }) }))
    expect(h.ctx.jobs.get(jobIds[0]!, parent.id).status).toBe('completed')
    expect(h.ctx.jobs.get(jobIds[1]!, parent.id).status).toBe('killed')
    expect(h.ctx.jobs.readAt(jobIds[0]!, 0, parent.id).chunks.map(chunk => chunk.text).join('')).toContain('unconsumed terminal evidence')
    const persisted = await fixtures.run(() => h.ctx.sessionController.inspect(parent.id))
    expect(persisted.events.slice(0, beforeLog.length)).toEqual(beforeLog)
    expect(persisted.events.some(event => event.type === 'tool/call' && event.data.name === 'job_output')).toBe(false)
    expect(persisted.events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'aborted')).toBe(true)
    expect(other.session.snapshotEvents().some(event => event.type === 'turn/end' && event.data.reason.kind === 'aborted')).toBe(false)
    const requestCount = h.model.requests.length
    await fixtures.run(() => app.reconcileControls())
    expect(h.model.requests).toHaveLength(requestCount)
    expect((await query({ type: 'task.detail', ref })).execution).toMatchObject({ id: execution.id, control: { action: 'end', status: 'applied' } })
    console.log('real queue end', JSON.stringify({ root: parent.id, child: child.childId, jobs: jobIds.map(id => h.ctx.jobs.get(id, parent.id)), terminal: finalRule.items[0]!.end, unrelatedRunning: other.status, completion: detail.task!.completion ?? null }))
  } finally {
    finishJob()
    for (const release of releaseTools.values()) release()
    await fixtures.close()
  }
}, 15000)
