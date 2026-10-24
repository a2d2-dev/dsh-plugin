import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Subagents from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
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
