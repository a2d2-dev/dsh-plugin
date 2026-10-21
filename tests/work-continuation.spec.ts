import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { installWorkTools } from '../src/work-execution/tools.ts'
import type { WorkExecution } from '../src/work-types.ts'

let fixtures: ExecutionFixtures
const operator = { operator: true }
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
async function setup() {
  const directory = await fixtures.root()
  const h = await fixtures.mount(directory)
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const p = await h.app.execute({ type: 'project.create', commandId: 'project', name: 'Continuation', resource }, operator)
  if (p.status !== 'completed' || !p.project) throw new Error(JSON.stringify(p))
  const t = await h.app.execute({ type: 'task.create', commandId: 'task', projectId: p.project.id, title: 'Continue work', goal: 'Retain accepted decisions', specification: 'Two safe handoffs', acceptance: ['Original decisions survive'] }, operator)
  if (t.status !== 'completed' || !t.task) throw new Error(JSON.stringify(t))
  const ref = { projectId: p.project.id, taskId: t.task.id }
  installWorkTools(h.ctx, h.app, 'runtime')
  const started = await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: 1, resource, agentId: p.project.defaultAgentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  if (started.status !== 'completed' || !started.execution) throw new Error(JSON.stringify(started))
  await fixtures.run(() => h.ctx.agents.get(SessionId(started.execution!.session.sessionId))!.whenIdle())
  return { ...h, ref, execution: started.execution }
}
const material = { body: 'Original full discussion\nKeep this whitespace. ', decisions: 'Use the accepted Task identity and retain its owner.', evidence: 'Controller created the selected model Session.', unfinished: 'Verify the successor result.', next: 'Continue the original acceptance check.' }
function fence(execution: WorkExecution) { return { ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch } }
it.each(['material-request', 'successor-create', 'source-take', 'source-seal', 'successor-kickoff'] as const)('recovers the same operation and successor after the real %s receipt is lost', async checkpoint => {
  const h = await setup()
  h.model.nextTool = { name: 'work_continuation_material', arguments: material }
  let lost = false
  if (checkpoint === 'successor-create') {
    const ensure = h.host.execution.ensure.bind(h.host.execution)
    vi.spyOn(h.host.execution, 'ensure').mockImplementation(async (execution, allowed) => {
      const actual = await ensure(execution, allowed)
      if (!lost && execution.session.sessionId !== h.execution.session.sessionId) { lost = true; throw new Error('Successor exists; create receipt lost') }
      return actual
    })
  } else if (checkpoint === 'source-take' || checkpoint === 'source-seal') {
    const seal = h.host.execution.sealInput!.bind(h.host.execution)
    vi.spyOn(h.host.execution, 'sealInput').mockImplementation(async (execution, operationId) => {
      if (!lost) {
        lost = true
        if (checkpoint === 'source-seal') await seal(execution, operationId)
        throw new Error('Authority taken; source seal receipt not saved')
      }
      return seal(execution, operationId)
    })
  } else {
    const deliver = h.host.execution.deliver.bind(h.host.execution)
    vi.spyOn(h.host.execution, 'deliver').mockImplementation(async (execution, event, maintenance) => {
      const receipt = await deliver(execution, event, maintenance)
      if (!lost && event.id.startsWith(checkpoint === 'material-request' ? 'material-request:' : 'continuation:')) {
        lost = true
        throw new Error('Message accepted by real host; receipt lost')
      }
      return receipt
    })
  }
  const command = { type: 'task.continue', commandId: 'lost-continuation', ...fence(h.execution) }
  await h.app.execute(command, operator)
  await fixtures.run(() => h.ctx.agents.get(SessionId(h.execution.session.sessionId))!.whenIdle())
  if (checkpoint !== 'material-request') await fixtures.run(() => h.app.reconcileControls())
  expect(lost).toBe(true)
  const interrupted = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  if (interrupted.status !== 'completed' || !interrupted.execution?.continuation) throw new Error(JSON.stringify(interrupted))
  const operation = interrupted.execution.continuation
  const successor = h.ctx.agents.get(SessionId(operation.successor.sessionId))
  if (successor) await fixtures.run(() => successor.whenIdle())
  await fixtures.dispose(h.ctx)
  const restored = await fixtures.mount(h.workspace.path)
  installWorkTools(restored.ctx, restored.app, 'runtime')
  let cutoverInput: ReturnType<typeof createUserMessage> | undefined
  if (checkpoint === 'source-take' || checkpoint === 'source-seal') {
    const source = await fixtures.run(() => restored.ctx.sessionController.resolveAgent(SessionId(operation.source.sessionId)))
    if ('error' in source) throw new Error(JSON.stringify(source))
    cutoverInput = createUserMessage({ content: [{ type: 'text', text: 'Input at the durable cutover boundary' }], source: { kind: 'user' } })
    source.agent.followup(cutoverInput)
    await fixtures.run(() => source.agent.whenIdle())
    expect(restored.model.requests).toHaveLength(0)
  }
  await fixtures.run(() => restored.app.reconcileControls())
  const recovered = await restored.app.execute(command, operator)
  expect(recovered, JSON.stringify(recovered)).toMatchObject({ execution: { id: h.execution.id, epoch: 2, session: operation.successor, continuation: { operationId: operation.operationId, materialRequestId: operation.materialRequestId, kickoffId: operation.kickoffId, phase: 'delivered' } } })
  await fixtures.run(() => restored.ctx.agents.get(SessionId(operation.successor.sessionId))!.whenIdle())
  expect(await fixtures.run(() => restored.ctx.sessionPersistence.list())).toHaveLength(2)
  const sourceLog = await fixtures.run(() => restored.ctx.sessionController.inspect(SessionId(operation.source.sessionId)))
  const successorLog = await fixtures.run(() => restored.ctx.sessionController.inspect(SessionId(operation.successor.sessionId)))
  expect(sourceLog.events.filter(event => event.type === 'user/message' && event.data.id === operation.materialRequestId)).toHaveLength(1)
  expect(successorLog.events.filter(event => event.type === 'user/message' && event.data.id === operation.kickoffId)).toHaveLength(1)
  expect(sourceLog.events.filter(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === `intake-seal:${operation.operationId}`))).toHaveLength(1)
  if (cutoverInput) expect(successorLog.events.filter(event => event.type === 'user/message' && event.data.id === cutoverInput!.id)).toHaveLength(checkpoint === 'source-take' ? 1 : 0)
})

it('preserves queued Task and full native input while successor creation is parked', async () => {
  const h = await setup()
  h.model.nextTool = { name: 'work_continuation_material', arguments: material }
  await h.app.execute({ type: 'task.continue', commandId: 'parked-handoff', ...fence(h.execution) }, operator)
  const source = h.ctx.agents.get(SessionId(h.execution.session.sessionId))!
  await fixtures.run(() => source.whenIdle())
  let enteredResolve!: () => void
  let releaseResolve!: () => void
  const entered = { promise: new Promise<void>(resolve => { enteredResolve = resolve }), resolve: () => enteredResolve() }
  const release = { promise: new Promise<void>(resolve => { releaseResolve = resolve }), resolve: () => releaseResolve() }
  const create = h.ctx.sessionController.create.bind(h.ctx.sessionController)
  vi.spyOn(h.ctx.sessionController, 'create').mockImplementation(async request => {
    if (request?.sessionId !== source.id) { entered.resolve(); await release.promise }
    return create(request)
  })
  const recovery = fixtures.run(() => h.app.reconcileControls())
  const native = createUserMessage({ content: [{ type: 'text', text: 'Native decision with full stable identity' }], source: { kind: 'user' } })
  let inputId: string | undefined
  const cutover = createUserMessage({ content: [{ type: 'text', text: 'Input after owner commit and before intake seal' }], source: { kind: 'user' } })
  const seal = h.host.execution.sealInput!.bind(h.host.execution)
  vi.spyOn(h.host.execution, 'sealInput').mockImplementation(async (execution, operationId) => {
    source.followup(cutover)
    return seal(execution, operationId)
  })
  try {
    await entered.promise
    const accepted = await h.app.execute({ type: 'task.input', commandId: 'queued-during-create', ...fence(h.execution), text: 'Task decision accepted during slow create', kind: 'input' }, operator)
    expect(accepted).toMatchObject({ status: 'completed', execution: { epoch: 1 } })
    if (accepted.status === 'completed') inputId = accepted.execution!.events.find(event => event.text === 'Task decision accepted during slow create')!.id
    source.followup(native)
    expect(await h.app.execute({ type: 'task.update-spec', commandId: 'no-stale-goal', ref: h.ref, expectedVersion: 2, goal: 'Changed while preparing', specification: 'Changed', acceptance: ['Changed'] }, operator)).toMatchObject({ status: 'failed', error: { code: 'continuation-in-progress' } })
  } finally { release.resolve() }
  await recovery
  const result = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  expect(result, JSON.stringify(result)).toMatchObject({ execution: { epoch: 2, continuation: { phase: 'delivered' } } })
  if (result.status !== 'completed' || !result.execution) throw new Error('No successor')
  const successor = h.ctx.agents.get(SessionId(result.execution.session.sessionId))!
  await fixtures.run(() => successor.whenIdle())
  await fixtures.run(() => h.app.reconcileControls())
  const log = await fixtures.run(() => h.ctx.sessionController.inspect(successor.id))
  expect(log.events.filter(event => event.type === 'user/message' && event.data.id === native.id)).toHaveLength(1)
  expect(log.events.filter(event => event.type === 'user/message' && event.data.id === cutover.id)).toHaveLength(1)
  expect(log.events.filter(event => event.type === 'user/message' && event.data.id === inputId)).toHaveLength(1)
  expect(h.model.requests.some(request => request.messages.some(message => message.id === native.id))).toBe(true)
})

it('hands the same Task to two real successor Sessions with source-authored decisions and stable identity', async () => {
  const h = await setup()
  let execution = h.execution
  const originals: string[] = []
  for (let generation = 2; generation <= 3; generation++) {
    originals.push(execution.session.sessionId)
    h.model.nextTool = { name: 'work_continuation_material', arguments: material }
    const accepted = await h.app.execute({ type: 'task.continue', commandId: `continue-${generation}`, ...fence(execution) }, operator)
    expect(accepted).toMatchObject({ status: 'completed', execution: { continuation: { sourceEpoch: generation - 1 } } })
    await fixtures.run(() => h.ctx.agents.get(SessionId(execution.session.sessionId))!.whenIdle())
    await fixtures.run(() => h.app.reconcileControls())
    const result = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
    expect(result, JSON.stringify(result)).toMatchObject({ execution: { id: h.execution.id, owner: h.execution.owner, epoch: generation, continuation: { phase: 'delivered' } } })
    if (result.status === 'completed' && result.execution) execution = result.execution
    await fixtures.run(() => h.ctx.agents.get(SessionId(execution.session.sessionId))!.whenIdle())
    expect(execution.continuation?.material).toMatchObject(material)
    const inspection = await fixtures.run(() => h.ctx.sessionController.inspect(SessionId(execution.session.sessionId)))
    expect(JSON.stringify(inspection.events)).toContain(material.decisions)
  }
  expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(3)
  expect(execution.retired?.map(item => item.session.sessionId)).toEqual(originals)
  expect(execution.ref).toEqual(h.ref)
})

async function rotate(h: Awaited<ReturnType<typeof setup>>) {
  h.model.nextTool = { name: 'work_continuation_material', arguments: material }
  const result = await h.app.execute({ type: 'task.continue', commandId: 'rotate', ...fence(h.execution) }, operator)
  expect(result.status).toBe('completed')
  await fixtures.run(() => h.ctx.agents.get(SessionId(h.execution.session.sessionId))!.whenIdle())
  await fixtures.run(() => h.app.reconcileControls())
  const current = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  if (current.status !== 'completed' || !current.execution) throw new Error(JSON.stringify(current))
  expect(current.execution.continuation?.phase, JSON.stringify(current)).toBe('delivered')
  await fixtures.run(() => h.ctx.agents.get(SessionId(current.execution!.session.sessionId))!.whenIdle())
  return current.execution
}
it('inherits the actual Session-local reasoning effort and Project Agent instructions', async () => {
  const h = await setup()
  const defaultSaves = vi.spyOn(h.ctx.agentDefaultModel, 'saveSelection')
  const resolve = h.model.resolveModel.bind(h.model)
  vi.spyOn(h.model, 'resolveModel').mockImplementation(async (provider, model) => ({ ...await resolve(provider, model), reasoning: { efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }, { id: ReasoningEffortId('high'), name: 'High' }], defaultEffort: ReasoningEffortId('low') } }))
  await fixtures.run(() => h.ctx.sessionController.selectModel({ sessionId: SessionId(h.execution.session.sessionId), provider: 'contract', model: 'selected', reasoningEffort: ReasoningEffortId('high') }))
  defaultSaves.mockClear()
  const current = await rotate(h)
  expect(current.actual).toMatchObject({ provider: 'contract', model: 'selected', reasoningEffort: 'high', cwd: h.workspace.path, permissionPreset: 'workspace-write' })
  const successor = h.ctx.agents.get(SessionId(current.session.sessionId))!
  expect(successor.session.requestHeader()?.config).toMatchObject({ reasoningEffort: 'high' })
  const kickoff = h.model.requests.find(request => request.messages.some(message => message.id === current.continuation!.kickoffId))!
  expect(JSON.stringify(kickoff.messages)).toContain('Coordinate accepted work and its acceptance criteria.')
  expect(JSON.stringify(kickoff.messages)).toContain('work_organize')
  expect(defaultSaves).not.toHaveBeenCalled()
})

it('keeps retired native input and tools fenced after cold restore while history stays read-only', async () => {
  const h = await setup()
  const current = await rotate(h)
  await fixtures.dispose(h.ctx)
  const restored = await fixtures.mount(h.workspace.path)
  installWorkTools(restored.ctx, restored.app, 'runtime')
  expect(restored.ctx.agents.get(SessionId(h.execution.session.sessionId))).toBeUndefined()
  const history = await restored.app.query({ type: 'task.history', ref: h.ref, session: h.execution.session, limit: 2 }, operator)
  expect(history).toMatchObject({ status: 'completed', transcript: { session: h.execution.session, events: [expect.anything(), expect.anything()], nextCursor: 2 } })
  expect(restored.ctx.agents.get(SessionId(h.execution.session.sessionId))).toBeUndefined()
  expect(await restored.app.query({ type: 'task.history', ref: h.ref, session: current.session }, operator)).toMatchObject({ status: 'failed', error: { code: 'unrelated-history' } })
  const resolved = await fixtures.run(() => restored.ctx.sessionController.resolveAgent(SessionId(h.execution.session.sessionId)))
  if ('error' in resolved) throw new Error(JSON.stringify(resolved))
  const native = createUserMessage({ content: [{ type: 'text', text: 'Retired input cannot regain authority' }], source: { kind: 'user' } })
  resolved.agent.followup(native)
  await fixtures.run(() => resolved.agent.whenIdle())
  const denied = await fixtures.run(() => restored.ctx.tools.execute({ callId: ToolCallId('retired-progress'), name: 'work_control', arguments: { action: 'progress', text: 'Late tool write' }, agent: resolved.agent, signal: new AbortController().signal }))
  expect(denied.isError).toBe(true)
  expect(restored.model.requests).toHaveLength(0)
  expect(await restored.app.query({ type: 'session.work', session: h.execution.session }, operator)).toMatchObject({ work: [{ purpose: 'history', executionId: current.id, epoch: 1 }] })
})

it.each([100, 200_001])('automatically continues at a 200K soft target and observes successor context of %i tokens', async successorTokens => {
  const h = await setup()
  const resolve = h.model.resolveModel.bind(h.model)
  vi.spyOn(h.model, 'resolveModel').mockImplementation(async (provider, model) => ({ ...await resolve(provider, model), context: { contextWindow: 512_000 }, defaultMaxTokens: 8_000 }))
  const seen: string[] = []
  h.ctx.provide('tokenMeter' as never, { measure(session: { id: string; seq: number }) { seen.push(session.id); return { totalTokens: session.id === h.execution.session.sessionId ? 200_001 : successorTokens, logRevision: session.seq, baseline: { kind: 'estimated' } } } } as never)
  h.model.nextTool = { name: 'work_continuation_material', arguments: material }
  expect(await h.app.execute({ type: 'task.configure-continuation', commandId: 'auto-policy', ...fence(h.execution), policy: { version: 1, enabled: true, targetTokens: 200_000, reserveTokens: 16_000 } }, operator)).toMatchObject({ status: 'completed' })
  await fixtures.run(() => h.app.reconcileControls())
  await fixtures.run(() => h.ctx.agents.get(SessionId(h.execution.session.sessionId))!.whenIdle())
  await fixtures.run(() => h.app.reconcileControls())
  const result = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  expect(result, JSON.stringify(result)).toMatchObject({ execution: { epoch: 2, continuation: { automatic: true, phase: 'delivered', material }, continuationPolicy: { targetTokens: 200_000 } } })
  if (result.status !== 'completed' || !result.execution) throw new Error('No successor')
  await fixtures.run(() => h.ctx.agents.get(SessionId(result.execution!.session.sessionId))!.whenIdle())
  await fixtures.run(() => h.app.reconcileControls())
  expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { epoch: 2, continuationObservation: { totalTokens: successorTokens, baseline: 'estimated', capacity: 512_000, outputReserve: 8_000 }, ...(successorTokens > 200_000 ? { continuationBlocked: { code: 'continuation-target-too-small' } } : {}) } })
  await fixtures.run(() => h.app.reconcileControls())
  expect(seen).toContain(h.execution.session.sessionId)
  expect(seen).toContain(result.execution.session.sessionId)
  expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(2)
})

it('observes a real failed source turn without treating idle as completion or automatically rotating', async () => {
  const h = await setup()
  const stream = vi.spyOn(h.model, 'stream').mockImplementationOnce(async function* () { throw new Error('deterministic provider failure') })
  await h.app.execute({ type: 'task.input', commandId: 'failed-provider-input', ...fence(h.execution), text: 'Attempt concrete work', kind: 'input' }, operator)
  await fixtures.run(() => h.ctx.agents.get(SessionId(h.execution.session.sessionId))!.whenIdle())
  stream.mockRestore()
  const resolve = h.model.resolveModel.bind(h.model)
  vi.spyOn(h.model, 'resolveModel').mockImplementation(async (provider, model) => ({ ...await resolve(provider, model), context: { contextWindow: 512_000 }, defaultMaxTokens: 8_000 }))
  h.ctx.provide('tokenMeter' as never, { measure(session: { seq: number }) { return { totalTokens: 200_001, logRevision: session.seq, baseline: { kind: 'estimated' } } } } as never)
  await h.app.execute({ type: 'task.configure-continuation', commandId: 'failed-policy', ...fence(h.execution), policy: { version: 1, enabled: true, targetTokens: 200_000, reserveTokens: 16_000 } }, operator)
  await fixtures.run(() => h.app.reconcileControls())
  const result = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  expect(result, JSON.stringify(result)).toMatchObject({ execution: { epoch: 1, runtimeFailure: { message: expect.stringContaining('error'), userCancelled: false } } })
  if (result.status !== 'completed') throw new Error('Missing execution')
  expect(result.execution?.continuation).toBeUndefined()
  expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)
})

it.each(['unknown', 'invalid', 'changed', 'stale'] as const)('blocks automatic advances visibly when model measurement is %s', async mode => {
  const h = await setup()
  let capacity = mode === 'invalid' ? 256_000 : 512_000
  const resolve = h.model.resolveModel.bind(h.model)
  if (mode !== 'unknown') vi.spyOn(h.model, 'resolveModel').mockImplementation(async (provider, model) => ({ ...await resolve(provider, model), context: { contextWindow: capacity }, defaultMaxTokens: 8_000 }))
  h.ctx.provide('tokenMeter' as never, { measure(session: { seq: number }) { return { totalTokens: 100, logRevision: session.seq - (mode === 'stale' ? 1 : 0), baseline: { kind: 'usage' } } } } as never)
  await h.app.execute({ type: 'task.configure-continuation', commandId: 'policy', ...fence(h.execution), policy: { version: 1, enabled: true, targetTokens: 300_000, reserveTokens: 16_000 } }, operator)
  await fixtures.run(() => h.app.reconcileControls())
  if (mode === 'changed') { capacity = 600_000; await fixtures.run(() => h.app.reconcileControls()) }
  const code = { unknown: 'continuation-metadata-unknown', invalid: 'continuation-policy-invalid', changed: 'continuation-route-changed', stale: 'continuation-meter-stale' }[mode]
  expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { epoch: 1, continuationBlocked: { code } } })
  const agent = h.ctx.agents.get(SessionId(h.execution.session.sessionId))!
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Do not advance with unsafe metadata' }], source: { kind: 'user' } }))
  await fixtures.run(() => agent.whenIdle())
  expect(h.model.requests).toHaveLength(1)
  expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)
})

it('does not prompt or rotate while explicitly waiting and does not rotate without source material', async () => {
  const h = await setup()
  await h.app.execute({ type: 'task.control', commandId: 'wait', ...fence(h.execution), action: 'wait', text: 'Need accepted human decision' }, operator)
  await h.app.execute({ type: 'task.configure-continuation', commandId: 'policy', ...fence(h.execution), policy: { version: 1, enabled: true, targetTokens: 200_000, reserveTokens: 16_000 } }, operator)
  await fixtures.run(() => h.app.reconcileControls())
  expect(await h.app.execute({ type: 'task.continue', commandId: 'waiting-continue', ...fence(h.execution) }, operator)).toMatchObject({ status: 'failed', error: { code: 'continuation-not-ready' } })
  expect(h.model.requests).toHaveLength(1)
  await h.app.execute({ type: 'task.configure-continuation', commandId: 'disable-policy', ...fence(h.execution), policy: { version: 2, enabled: false, targetTokens: 200_000, reserveTokens: 16_000 } }, operator)
  await h.app.execute({ type: 'task.control', commandId: 'resume', ...fence(h.execution), action: 'resume', text: 'Human decision accepted' }, operator)
  await h.app.execute({ type: 'task.continue', commandId: 'missing-material', ...fence(h.execution) }, operator)
  await fixtures.run(() => h.ctx.agents.get(SessionId(h.execution.session.sessionId))!.whenIdle())
  await fixtures.run(() => h.app.reconcileControls())
  await fixtures.run(() => h.app.reconcileControls())
  expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { epoch: 1, continuation: { phase: 'material-requested', error: { code: 'continuation-material-missing' } } } })
  expect(h.model.requests).toHaveLength(2)
  expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)
})



