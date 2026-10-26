import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Subagents from '@deepseek-ai/dsh-subagent'
import LocalJobs from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { installWorkTools } from '../src/work-execution/tools.ts'
import { installWorkProgressTools } from '../src/work-progress-tools.ts'
import { RuntimeHost } from '../src/task-runtime/host.ts'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import type { WorkResult } from '../src/work-types.ts'
const operator = { operator: true }
const ok = (result: WorkResult) => { if (result.status !== 'completed') throw Error(JSON.stringify(result)); return result }
const report = { specificationVersion: 1, stage: 'done' as const, summary: 'verified', next: '', blockers: [], criteria: [{ index: 0, passed: true, evidence: ['verified native results'] }] }

it('accepts a real model work_report without waiting for its own running tool', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    installWorkProgressTools(h.ctx, h.app, 'runtime')
    const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
    const project = ok(await h.app.execute({ type: 'project.create', commandId: 'project', name: 'completion', resource }, operator)).project!
    const task = ok(await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.id, title: 'verify', goal: 'verify', specification: 'native results', acceptance: ['verified'] }, operator)).task!
    const ref = { projectId: project.id, taskId: task.id }
    const execution = ok(await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: task.version, agentId: task.agentId, resource, model: { provider: 'contract', model: 'default' }, agentPreset: 'contract', permissionPreset: 'read-only' }, operator)).execution!
    const agent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
    await fixtures.run(() => agent.whenIdle())
    h.model.nextTool = { name: 'work_report', arguments: { report } }
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Verify the collected results and report acceptance.' }], source: { kind: 'user' } }))
    await fixtures.run(() => agent.whenIdle())
    expect(ok(await h.app.query({ type: 'task.detail', ref }, operator)).task!.completion).toBeDefined()
    expect(h.model.requests).toHaveLength(3)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)).toMatchObject({ data: { reason: { kind: 'completed' } } })
    const completionLog = await fixtures.run(() => h.ctx.sessionController.inspect(agent.id))
    const completionResult = completionLog.events.find(event => event.type === 'tool/result')!
    expect(completionResult).toMatchObject({ data: { message: { isError: false } } })
    expect(completionLog.events.findLast(event => event.type === 'assistant/message')).toMatchObject({
      data: { message: { content: [{ type: 'text', text: 'Recorded work progress' }] } },
    })
    expect(completionLog.events.findLast(event => event.type === 'assistant/message')!.seq).toBeGreaterThan(completionResult.seq)
    await h.app.reconcileCompletions()
    const completed = ok(await h.app.query({ type: 'task.detail', ref }, operator)).task!.completion!
    expect(completed.closeout.status).toBe('settled')
    let toolCalls = 0
    h.ctx.tools.register(defineTool({ name: 'conversation_lookup', description: 'Read a fact during a conversation', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
      async execute() { toolCalls++; return { result: 'Still available after completion' } },
    }))
    h.model.nextTool = { name: 'conversation_lookup', arguments: {} }
    const followup = createUserMessage({ content: [{ type: 'text', text: 'What was completed? Look up the relevant fact.' }], source: { kind: 'user' } })
    agent.followup(followup)
    await fixtures.run(() => agent.whenIdle())
    expect(h.model.requests).toHaveLength(5)
    expect(toolCalls).toBe(1)
    expect(h.model.requests[3]!.messages).toEqual(expect.arrayContaining([expect.objectContaining({ id: followup.id, content: followup.content })]))
    expect(JSON.stringify(h.model.requests[3]!.messages)).toContain('已完成')
    await h.app.reconcileCompletions()
    expect(ok(await h.app.query({ type: 'task.detail', ref }, operator)).task!.completion).toEqual(completed)
    expect(await h.app.sessionControl(execution.session, 'late', 'resume', 'more')).toMatchObject({ status: 'failed', error: { code: 'task-completed' } })
    await fixtures.run(() => h.ctx.sessions.flush(agent.session))
    {
      await using handle = await h.ctx.sessionPersistence.open(agent.id, 'read')
      const persisted = await handle.read()
      const input = persisted.events.find(event => event.type === 'user/message' && event.data.id === followup.id)!
      expect(input).toMatchObject({ data: { content: followup.content } })
      expect(persisted.events.filter(event => event.type === 'user/message' && event.data.id === followup.id)).toHaveLength(1)
      expect(persisted.events.findLast(event => event.type === 'assistant/message')!.seq).toBeGreaterThan(input.seq)
      expect(persisted.events.findLast(event => event.type === 'assistant/message')).toMatchObject({ data: { message: { content: [{ type: 'text', text: 'Recorded work progress' }] } } })
    }
    // A cold DSH context reads the same accepted Task and JSONL history without
    // starting a model. A new human message alone starts the conversation turn.
    await fixtures.dispose(h.ctx)
    const restored = await fixtures.mount(h.workspace.path, 'read-only')
    installWorkProgressTools(restored.ctx, restored.app, 'runtime')
    await restored.app.reconcileControls()
    expect(restored.model.requests).toHaveLength(0)
    const recovered = await fixtures.run(() => new RuntimeHost(restored.ctx).agent(agent.id))
    const question = createUserMessage({ content: [{ type: 'text', text: 'Explain the accepted result after restart.' }], source: { kind: 'user' } })
    recovered.followup(question)
    await fixtures.run(() => recovered.whenIdle())
    expect(restored.model.requests).toHaveLength(1)
    expect(restored.model.requests[0]!.messages).toContainEqual(expect.objectContaining({ id: question.id, content: question.content }))
    expect(restored.model.requests[0]!.messages).toContainEqual(expect.objectContaining({ id: followup.id, content: followup.content }))
    await restored.app.reconcileControls()
    expect(restored.model.requests).toHaveLength(1)
    const final = ok(await restored.app.query({ type: 'task.detail', ref }, operator))
    expect(final.task!.completion).toEqual(completed)
    expect(final.progress!.stage).toBe('done')
    expect(final.execution).toMatchObject({ id: execution.id, owner: execution.owner, epoch: execution.epoch, session: execution.session })
    expect(await fixtures.run(() => restored.ctx.sessionPersistence.list())).toHaveLength(1)
    await fixtures.run(() => restored.ctx.sessions.flush(recovered.session))
    await using handle = await restored.ctx.sessionPersistence.open(recovered.id, 'read')
    const persisted = await handle.read()
    const input = persisted.events.find(event => event.type === 'user/message' && event.data.id === question.id)!
    expect(input).toMatchObject({ data: { content: question.content } })
    expect(persisted.events.filter(event => event.type === 'user/message' && event.data.id === question.id)).toHaveLength(1)
    expect(persisted.events.findLast(event => event.type === 'assistant/message')!.seq).toBeGreaterThan(input.seq)
    expect(persisted.events.findLast(event => event.type === 'assistant/message')).toMatchObject({ data: { message: { content: [{ type: 'text', text: 'Recorded work progress' }] } } })
  } finally { await fixtures.close() }
})

it('keeps native continuable result intake authorized until the settled notice reaches the real parent log', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  let release!: () => void
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    await h.ctx.plugin(Subagents, { maxActiveSubagents: 8, maxDepth: 1 })
    h.ctx.subagents.registerProvider({ name: 'fresh-local', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
      async prepareContinuable() { return {} }, async start() { throw Error('Only native continuable creation is used') } })
    installWorkProgressTools(h.ctx, h.app, 'runtime')
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    h.ctx.tools.register(defineTool({ name: 'hold_native', description: 'Deterministic result producer', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
      async execute() { entered(); await gate; return { result: 'native verification passed' } } }))
    const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
    const project = ok(await h.app.execute({ type: 'project.create', commandId: 'project', name: 'native', resource }, operator)).project!
    const task = ok(await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.id, title: 'native', goal: 'verify', specification: 'native results', acceptance: ['verified'] }, operator)).task!
    const ref = { projectId: project.id, taskId: task.id }
    const execution = ok(await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: task.version, agentId: task.agentId, resource, model: { provider: 'contract', model: 'default' }, agentPreset: 'contract', permissionPreset: 'read-only' }, operator)).execution!
    const parent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
    await fixtures.run(() => parent.whenIdle())
    h.model.nextTool = { name: 'hold_native', arguments: {} }
    const child = await fixtures.run(() => h.ctx.subagents.startContinuable({ provider: 'fresh-local', label: 'verification', request: { parent, prompt: [{ type: 'text', text: 'Verify the native result' }] }, signal: signal! }))
    await started
    expect(await h.app.sessionReport(execution.session, 'too-early', report)).toMatchObject({ status: 'failed', error: { code: 'completion-results-unsettled' } })
    expect(ok(await h.app.query({ type: 'task.detail', ref }, operator)).task!.completion).toBeUndefined()
    release()
    await fixtures.run(() => h.ctx.agents.get(child.childId)!.whenIdle())
    await fixtures.run(() => parent.whenIdle())
    await expect.poll(async () => (await h.host.execution.observation!(execution)).sessions.find(row => row.role === 'current')!.children).toContainEqual(expect.objectContaining({ session: { runtimeId: 'runtime', sessionId: child.childId }, result: 'consumed' }))
    expect((await new RuntimeHost(h.ctx).events(parent.id)).some(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled' && event.data.source.senderSessionId === child.childId)).toBe(true)
    expect(ok(await h.app.query({ type: 'task.detail', ref }, operator)).task!.completion).toBeUndefined()
    h.model.nextTool = { name: 'work_report', arguments: { report } }
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Review the newly collected native result and confirm acceptance.' }], source: { kind: 'user' } }))
    await fixtures.run(() => parent.whenIdle())
    await h.app.reconcileCompletions()
    const final = ok(await h.app.query({ type: 'task.detail', ref }, operator))
    expect(final.task!.completion!.closeout.status).toBe('settled')
    expect(final.execution).toMatchObject({ id: execution.id, owner: execution.owner, epoch: execution.epoch, session: execution.session })
  } finally { release?.(); await fixtures.close() }
})

it('records the native owner capability boundary when returned child jobs are removed with its activation', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    await h.ctx.plugin(LocalJobs)
    await h.ctx.plugin(ToolJobs, { completionDelivery: 'quiet' })
    await h.ctx.plugin(Subagents, { maxActiveSubagents: 8, maxDepth: 1 })
    h.ctx.subagents.registerProvider({ name: 'fresh-local', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
      async prepareContinuable() { return {} }, async start() { throw Error('Only native continuable creation is used') } })
    installWorkTools(h.ctx, h.app, 'runtime')
    const jobs: ReturnType<typeof h.ctx.jobs.start>[] = []
    h.ctx.tools.register(defineTool({ name: 'produce_native_jobs', description: 'Produce real exact-owner terminal jobs', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
      async execute(_, exec) {
        for (const label of ['first', 'second']) jobs.push(h.ctx.jobs.start({ kind: 'bash', owner: exec.agent!.id, label,
          run(job) { job.append(`${label} native output`); return { done: Promise.resolve({ status: 'completed', result: `${label} exact child evidence` }), cancel() {} } } }))
        for (const id of jobs) {
          await h.ctx.jobs.wait(id, 1000, exec.agent!.id)
          expect(h.ctx.jobs.get(id, exec.agent!.id)).toMatchObject({ status: 'completed', owner: exec.agent!.id })
        }
        return { result: 'Two native jobs are terminal; formal output remains pending.' }
      } }))
    const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
    const project = ok(await h.app.execute({ type: 'project.create', commandId: 'project', name: 'native jobs', resource }, operator)).project!
    const task = ok(await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.id, title: 'native jobs', goal: 'verify', specification: 'two exact child results', acceptance: ['verified'] }, operator)).task!
    const ref = { projectId: project.id, taskId: task.id }
    const execution = ok(await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: task.version, agentId: task.agentId, resource, model: { provider: 'contract', model: 'default' }, agentPreset: 'contract', permissionPreset: 'read-only' }, operator)).execution!
    const fence = { ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }
    const parent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
    const runtime = new RuntimeHost(h.ctx)
    await fixtures.run(() => parent.whenIdle())
    h.model.nextTool = { name: 'produce_native_jobs', arguments: {} }
    const child = await fixtures.run(() => h.ctx.subagents.startContinuable({ provider: 'fresh-local', label: 'two job owner', request: { parent, prompt: [{ type: 'text', text: 'Produce two background verification results' }] }, signal: signal! }))
    await expect.poll(async () => (await runtime.events(parent.id)).filter(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled').length).toBe(1)
    await fixtures.run(() => parent.whenIdle())
    expect(h.ctx.agents.get(child.childId)).toBeUndefined()
    expect(jobs).toHaveLength(2)
    const before = await h.host.execution.observation!(execution)
    expect(before.sessions.find(row => row.role === 'current')!.children[0]!).toMatchObject({ session: { runtimeId: 'runtime', sessionId: child.childId }, returned: true, result: 'consumed' })
    // The installed formal Jobs provider ties registration to the exact live
    // owner Agent. Natural native settlement disposes that Agent and removes
    // both records; this is not a reachable completed/pending collection case.
    expect(h.ctx.jobs.list(child.childId)).toEqual([])
    for (const id of jobs) expect(() => h.ctx.jobs.get(id, child.childId)).toThrow()
    expect(before.sessions.find(row => row.session.sessionId === child.childId)!.jobs).toEqual([])
    await expect(h.host.execution.flushSession!({ runtimeId: 'runtime', sessionId: child.childId })).rejects.toThrow('owned by subagent routing')
    expect((await runtime.events(child.childId)).some(event => event.type === 'tool/call' && event.data.name === 'job_output')).toBe(false)
    console.log('R1 native owner capability', JSON.stringify({ child: child.childId, terminalJobsBeforeReturn: jobs, returned: true, noticeConsumed: true, reachableJobsAfterReturn: 0, genericResume: 'owned by subagent routing' }))
  } finally { await fixtures.close() }
})

it.for(['ready', 'waiting', 'paused'] as const)('continues the same operation after a running native child settles under %s control', async (state, { signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  let release!: () => void
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    await h.ctx.plugin(Subagents, { maxActiveSubagents: 8, maxDepth: 1 })
    h.ctx.subagents.registerProvider({ name: 'fresh-local', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
      async prepareContinuable() { return {} }, async start() { throw Error('Only native continuable creation is used') } })
    installWorkTools(h.ctx, h.app, 'runtime')
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    h.ctx.tools.register(defineTool({ name: 'hold_native', description: 'Deterministic result producer', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
      async execute() { entered(); await gate; return { result: 'late native evidence' } } }))
    const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
    const project = ok(await h.app.execute({ type: 'project.create', commandId: 'project', name: 'native continuation', resource }, operator)).project!
    const task = ok(await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.id, title: 'native', goal: 'verify', specification: 'native continuation', acceptance: ['verified'] }, operator)).task!
    const ref = { projectId: project.id, taskId: task.id }
    const execution = ok(await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: task.version, agentId: task.agentId, resource, model: { provider: 'contract', model: 'default' }, agentPreset: 'contract', permissionPreset: 'read-only' }, operator)).execution!
    const fence = { ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }
    const parent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
    await fixtures.run(() => parent.whenIdle())
    if (state !== 'ready') await h.app.execute({ type: 'task.control', commandId: 'hold', ...fence, action: state === 'waiting' ? 'wait' : 'pause', text: 'Keep original control' }, operator)
    const held = ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!
    h.model.nextTool = { name: 'hold_native', arguments: {} }
    const child = await fixtures.run(() => h.ctx.subagents.startContinuable({ provider: 'fresh-local', label: 'late verification', request: { parent, prompt: [{ type: 'text', text: 'Produce late native evidence' }] }, signal: signal! }))
    await started
    const reserved = ok(await h.app.execute({ type: 'task.continue', commandId: 'continue-with-live-child', ...fence }, operator)).execution!
    const op = reserved.continuation!
    expect(reserved).toMatchObject({ epoch: 1, continuation: { phase: 'reserved', error: { code: 'continuation-waiting-executions' } } })
    // Release only after reservation. Subagents itself delivers the required
    // notice; forged messages below are separate rejection probes.
    const childAgent = h.ctx.agents.get(child.childId)!
    let businessCalls = 0
    h.ctx.tools.register(defineTool({ name: 'business_probe', description: 'A business dispatcher must not run in settlement maintenance', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
      async execute() { businessCalls++; return { result: 'Would dispatch nested business work' } } }))
    let attempted = false
    h.model.selectTool = request => {
      if (attempted || !request.messages.some(message => (message as { source?: { kind?: string } }).source?.kind === 'subagent-settled')) return
      attempted = true
      return state === 'waiting' ? { name: 'business_probe', arguments: {} } : { name: 'work_control', arguments: { action: 'progress', text: 'Forbidden settlement business work' } }
    }
    const unrelated = createUserMessage({ content: [{ type: 'text', text: 'Unrelated automatic business input must stay queued.' }], source: { kind: 'a2d2-work-dispatch' } })
    await fixtures.run(() => parent.runMaintenance(async () => {
      release()
      await childAgent.whenIdle()
      await expect.poll(() => [...parent.inbox.nextTurn, ...parent.inbox.nextStep].some(message => message.source?.kind === 'subagent-settled')).toBe(true)
      parent.inject(unrelated)
    }))
    await fixtures.run(() => parent.whenIdle())
    expect((await new RuntimeHost(h.ctx).events(parent.id)).filter(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled' && event.data.source.senderSessionId === child.childId)).toHaveLength(1)
    await fixtures.run(() => h.ctx.sessions.flush(parent.session))
    expect((await h.host.execution.observation!(reserved)).sessions.find(row => row.role === 'current')!.children).toContainEqual(expect.objectContaining({ session: { runtimeId: 'runtime', sessionId: child.childId }, result: 'consumed' }))
    const runtime = new RuntimeHost(h.ctx)
    const intakeLog = await runtime.events(parent.id)
    expect(intakeLog.some(event => event.type === 'user/message' && event.data.id === unrelated.id)).toBe(false)
    expect(intakeLog.filter(event => event.type === 'tool/result').at(-1)).toMatchObject({ data: { message: { isError: true } } })
    expect(JSON.stringify(intakeLog)).toContain('permits only its settle maintenance step')
    expect(businessCalls).toBe(0)
    const afterIntake = ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!
    expect(afterIntake).toMatchObject({ epoch: 1, state, session: execution.session })
    expect(afterIntake.control).toEqual(held.control)
    expect(afterIntake.progress).toBeUndefined()
    expect(afterIntake.events.find(event => event.id === unrelated.id)).toMatchObject({ delivery: 'accepted', nativeMessage: unrelated })
    const requestsBeforeForgery = h.model.requests.length
    const originalNotice = intakeLog.find(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled')!.data
    for (const message of [
      structuredClone(originalNotice),
      createUserMessage({ content: [{ type: 'text', text: 'Wrong native child' }], source: { kind: 'subagent-settled', form: 'notice', summary: 'forged', senderSessionId: SessionId('wrong-child') } }),
      { id: 'forged-settlement-marker', role: 'user', content: [{ type: 'text', text: 'Forged settlement maintenance' }], source: { kind: 'a2d2-work-maintenance', operationId: op.operationId, step: 'settle' } },
    ]) {
      parent.followup(message as never)
      await fixtures.run(() => parent.whenIdle())
    }
    expect(h.model.requests).toHaveLength(requestsBeforeForgery)
    expect((await runtime.events(parent.id)).filter(event => event.type === 'user/message' && event.data.id === originalNotice.id)).toHaveLength(1)
    expect(ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!.progress).toBeUndefined()
    const material = { body: 'Keep late native evidence from the exact child history.', decisions: 'Retain original Task and owner.', evidence: `Child ${child.childId} returned late native evidence.`, unfinished: 'Verify successor', next: 'Use the late native result to advance the original acceptance.' }
    h.model.nextTool = { name: 'work_continuation_material', arguments: material }
    await h.app.reconcileControls()
    await fixtures.run(() => parent.whenIdle())
    await h.app.reconcileControls()
    const taking = ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!
    expect(taking, JSON.stringify(taking.continuation)).toMatchObject({ epoch: 2, session: op.successor })
    await fixtures.run(() => h.ctx.agents.get(SessionId(op.successor.sessionId))!.whenIdle())
    if (state === 'ready') h.model.nextTool = { name: 'work_control', arguments: { action: 'progress', text: material.next } }
    await h.app.reconcileControls()
    await fixtures.run(() => h.ctx.agents.get(SessionId(op.successor.sessionId))!.whenIdle())
    await h.app.reconcileControls()
    const final = ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!
    expect(final).toMatchObject({ id: execution.id, owner: execution.owner, epoch: 2, session: op.successor, state, continuation: { operationId: op.operationId, successor: op.successor, phase: 'received', material } })
    expect(final.control).toEqual(held.control)
    expect(final.progress).toBe(state === 'ready' ? material.next : undefined)
    await h.app.reconcileControls()
    expect(ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!.epoch).toBe(2)
  } finally { release?.(); await fixtures.close() }
})
