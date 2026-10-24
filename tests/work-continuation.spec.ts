import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { installWorkTools } from '../src/work-execution/tools.ts'
import type { WorkExecution } from '../src/work-types.ts'
import * as continuation from '../src/work-execution/continuation.ts'

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
const specificationPath = 'docs/specs/task-interaction-v4-delivery.md'
const standaloneToken = 'sk-abcdefghijklmnopqrstuvwxyz'
const material = { body: `Original full discussion\nRead ${specificationPath}.\nSensitive value (${standaloneToken}).\nKeep this whitespace. `, decisions: 'Use the accepted Task identity and retain its owner.', evidence: 'Controller created the selected model Session.', unfinished: 'Verify the successor result.', next: 'Continue the original acceptance check.' }
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
    expect(restored.model.requests).toHaveLength(1)
    expect(JSON.stringify(restored.model.requests[0]!.messages)).toContain(operation.successor.sessionId)
  }
  await fixtures.run(() => restored.app.reconcileControls())
  const recovered = await restored.app.execute(command, operator)
  expect(recovered, JSON.stringify(recovered)).toMatchObject({ execution: { id: h.execution.id, epoch: 2, session: operation.successor, continuation: { operationId: operation.operationId, materialRequestId: operation.materialRequestId, kickoffId: operation.kickoffId, phase: 'delivered' } } })
  await fixtures.run(() => restored.ctx.agents.get(SessionId(operation.successor.sessionId))!.whenIdle())
  expect(await fixtures.run(() => restored.ctx.sessionPersistence.list())).toHaveLength(2)
  const sourceLog = await fixtures.run(() => restored.ctx.sessionController.inspect(SessionId(operation.source.sessionId)))
  const successorLog = await fixtures.run(() => restored.ctx.sessionController.inspect(SessionId(operation.successor.sessionId)))
  expect(successorLog.events.findLast(event => event.type === 'session/title')?.data.title).toBe(`T:${h.ref.taskId.replaceAll('-', '').slice(0, 8)} · 会话 2 · Continue work`)
  expect(sourceLog.events.findLast(event => event.type === 'session/title')?.data.title).toBe(`T:${h.ref.taskId.replaceAll('-', '').slice(0, 8)} · 会话 1 · Continue work`)
  expect(sourceLog.events.filter(event => event.type === 'user/message' && event.data.id === operation.materialRequestId)).toHaveLength(1)
  expect(successorLog.events.filter(event => event.type === 'user/message' && event.data.id === operation.kickoffId)).toHaveLength(1)
  const kickoff = h.model.requests.concat(restored.model.requests).find(request => request.messages.some(message => message.id === operation.kickoffId))!
  expect(JSON.stringify(kickoff.messages)).toContain(specificationPath)
  expect(JSON.stringify(kickoff.messages)).not.toContain(standaloneToken)
  expect(sourceLog.events.filter(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === `intake-seal:${operation.operationId}`))).toHaveLength(1)
  if (cutoverInput) {
    expect(sourceLog.events.filter(event => event.type === 'user/message' && event.data.id === cutoverInput!.id)).toHaveLength(1)
    expect(successorLog.events.filter(event => event.type === 'user/message' && event.data.id === cutoverInput!.id)).toHaveLength(0)
  }
})

it('keeps the source authoritative when kickoff preparation fails and retries the reserved successor', async () => {
  const h = await setup()
  h.model.nextTool = { name: 'work_continuation_material', arguments: material }
  const command = { type: 'task.continue', commandId: 'prepare-message', ...fence(h.execution) }
  const prepare = vi.spyOn(continuation, 'successorMessage').mockImplementation(() => { throw new Error('Kickoff preparation failed') })
  try {
    await h.app.execute(command, operator)
    await fixtures.run(() => h.ctx.agents.get(SessionId(h.execution.session.sessionId))!.whenIdle())
    await fixtures.run(() => h.app.reconcileControls())
    const failed = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
    expect(failed).toMatchObject({ execution: { epoch: 1, session: h.execution.session, continuation: { phase: 'material-saved', error: { message: 'Kickoff preparation failed' } } } })
    if (failed.status !== 'completed' || !failed.execution?.continuation) throw Error('Missing failed operation')
    const operation = failed.execution.continuation
    expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)
    prepare.mockRestore()
    const recovered = await h.app.execute({ ...command, commandId: 'retry-prepared-message' }, operator)
    expect(recovered).toMatchObject({ execution: { epoch: 2, session: operation.successor, continuation: { operationId: operation.operationId, kickoffId: operation.kickoffId, phase: 'delivered' } } })
    await fixtures.run(() => h.ctx.agents.get(SessionId(operation.successor.sessionId))!.whenIdle())
    const log = await fixtures.run(() => h.ctx.sessionController.inspect(SessionId(operation.successor.sessionId)))
    expect(log.events.filter(event => event.type === 'user/message' && event.data.id === operation.kickoffId)).toHaveLength(1)
    expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(2)
  } finally { prepare.mockRestore() }
})

it.each(['cancelled', 'completed-without-material'] as const)('retries a consumed %s material request without replacing the operation or successor', async outcome => {
  const h = await setup()
  const source = h.ctx.agents.get(SessionId(h.execution.session.sessionId))!
  if (outcome === 'cancelled') {
    vi.spyOn(h.model, 'stream').mockImplementationOnce(async function* () {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('interrupted-material'), name: 'work_continuation_material', argumentsDelta: '{"body":"unfinished' }
      source.cancel({ kind: 'user' })
    })
  }
  const command = { type: 'task.continue', commandId: 'interrupted-material', ...fence(h.execution) }
  await h.app.execute(command, operator)
  await fixtures.run(() => source.whenIdle())
  await fixtures.run(() => h.app.reconcileControls())
  const failed = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  expect(failed).toMatchObject({ execution: { epoch: 1, continuation: { phase: 'material-requested', requestDelivery: 'consumed', error: { code: 'continuation-material-missing' } } } })
  if (failed.status !== 'completed' || !failed.execution?.continuation) throw new Error('Missing interrupted operation')
  const operation = failed.execution.continuation
  const sourceLog = await fixtures.run(() => h.ctx.sessionController.inspect(source.id))
  if (outcome === 'cancelled') expect(sourceLog.events).toContainEqual(expect.objectContaining({ type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } } }))

  // Neither recovery nor replay of the original intent authorizes another model turn.
  await fixtures.run(() => h.app.reconcileControls())
  await h.app.execute(command, operator)
  const beforeRetry = await fixtures.run(() => h.ctx.sessionController.inspect(source.id))
  expect(beforeRetry.events.filter(event => event.type === 'user/message' && event.data.id.startsWith('material-request:'))).toHaveLength(1)

  // A new explicit retry is allowed to request material, but still cannot take without it.
  const retry = { ...command, commandId: 'retry-missing-material' }
  const retried = await h.app.execute(retry, operator)
  expect(retried).toMatchObject({ execution: { epoch: 1, continuation: { operationId: operation.operationId, successor: operation.successor, kickoffId: operation.kickoffId } } })
  if (retried.status !== 'completed' || !retried.execution?.continuation) throw new Error('Missing retried operation')
  const retryId = retried.execution.continuation.materialRequestId
  expect(retryId).not.toBe(operation.materialRequestId)
  await fixtures.run(() => source.whenIdle())
  await fixtures.run(() => h.app.reconcileControls())
  await h.app.execute(retry, operator)
  const afterReplay = await fixtures.run(() => h.ctx.sessionController.inspect(source.id))
  expect(afterReplay.events.filter(event => event.type === 'user/message' && event.data.id === retryId)).toHaveLength(1)
  expect(afterReplay.events.filter(event => event.type === 'user/message' && event.data.id.startsWith('material-request:'))).toHaveLength(2)
  expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)

  // Lose the receipt of a later successful retry, then recover from real persisted logs.
  h.model.nextTool = { name: 'work_continuation_material', arguments: material }
  const deliver = h.host.execution.deliver.bind(h.host.execution)
  let lost = false
  vi.spyOn(h.host.execution, 'deliver').mockImplementation(async (execution, event, maintenance) => {
    const receipt = await deliver(execution, event, maintenance)
    if (!lost && event.id.startsWith('material-request:')) { lost = true; throw new Error('Retry delivery receipt lost') }
    return receipt
  })
  const successfulRetry = { ...command, commandId: 'retry-save-material' }
  await h.app.execute(successfulRetry, operator)
  await fixtures.run(() => source.whenIdle())
  expect(lost).toBe(true)
  await fixtures.dispose(h.ctx)
  const restored = await fixtures.mount(h.workspace.path)
  installWorkTools(restored.ctx, restored.app, 'runtime')
  const recovered = await restored.app.execute(successfulRetry, operator)
  expect(recovered).toMatchObject({ execution: { id: h.execution.id, ref: h.ref, epoch: 2, session: operation.successor, continuation: { operationId: operation.operationId, kickoffId: operation.kickoffId, phase: 'delivered', material } } })
  await fixtures.run(() => restored.ctx.agents.get(SessionId(operation.successor.sessionId))!.whenIdle())
  const finalSource = await fixtures.run(() => restored.ctx.sessionController.inspect(source.id))
  expect(finalSource.events.filter(event => event.type === 'user/message' && event.data.id.startsWith('material-request:'))).toHaveLength(3)
  const successorLog = await fixtures.run(() => restored.ctx.sessionController.inspect(SessionId(operation.successor.sessionId)))
  expect(successorLog.events.filter(event => event.type === 'user/message' && event.data.id === operation.kickoffId)).toHaveLength(1)
  expect(await fixtures.run(() => restored.ctx.sessionPersistence.list())).toHaveLength(2)
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
  const resolveAgent = h.ctx.sessionController.resolveAgent.bind(h.ctx.sessionController)
  vi.spyOn(h.ctx.sessionController, 'resolveAgent').mockImplementation(async id => {
    if (id !== source.id) { entered.resolve(); await release.promise }
    return resolveAgent(id)
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
    const title = inspection.events.findLast(event => event.type === 'session/title')!
    expect(title.data.title).toBe(`T:${h.ref.taskId.replaceAll('-', '').slice(0, 8)} · 会话 ${generation} · Continue work`)
    expect(title.seq).toBeLessThan(inspection.events.find(event => event.type === 'user/message')!.seq)
    const previous = await h.ctx.sessionController.inspect(SessionId(originals.at(-1)!))
    expect(previous.events.findLast(event => event.type === 'session/title')?.data.title).toBe(`T:${h.ref.taskId.replaceAll('-', '').slice(0, 8)} · 会话 ${generation - 1} · Continue work`)
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

it('keeps retired conversations usable after cold restore without restoring Task coordination', async () => {
  const h = await setup()
  const task = await h.app.query({ type: 'task.detail', ref: h.ref }, operator)
  if (task.status !== 'completed' || !task.task) throw new Error('Missing task')
  expect(await h.app.execute({ type: 'task.associate-session', commandId: 'related-control', ref: h.ref, expectedVersion: task.task.version, session: h.execution.session, purpose: 'related' }, operator)).toMatchObject({ status: 'completed' })
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
  expect(JSON.stringify(denied.content)).toContain('forbidden')
  expect(restored.model.requests).toHaveLength(1)
  expect(restored.model.requests[0]!.messages).toEqual(expect.arrayContaining([expect.objectContaining({ id: native.id, content: native.content })]))
  expect(JSON.stringify(restored.model.requests[0]!.messages)).toContain(`任务已转到会话 ${current.session.sessionId}`)
  expect(await restored.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { session: current.session, epoch: current.epoch, owner: current.owner } })
  expect(await restored.app.query({ type: 'session.work', session: h.execution.session }, operator)).toMatchObject({ work: [{ purpose: 'history', executionId: current.id, epoch: 1, currentSession: current.session }] })
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
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Explain the blocked automatic continuation' }], source: { kind: 'user' } }))
  await fixtures.run(() => agent.whenIdle())
  expect(h.model.requests).toHaveLength(2)
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



