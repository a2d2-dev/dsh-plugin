import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQuery from '@deepseek-ai/dsh-session-query'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import A2d2Service from '../src/index.ts'
import * as runtimePlugin from '../src/task-runtime.ts'
import { RuntimeStore } from '../src/task-runtime/store.ts'
import { handoffDocumentName, HANDOFF_SUMMARY_PLACEHOLDER } from '../src/handoff-document.ts'
import { handoffsDirectory } from '../src/store.ts'
import { StubCommands } from './stubs.ts'

class Query extends SessionQuery {
  async searchSessions(): Promise<never> { throw new Error('search is outside this fixture') }
  async searchEvents(): Promise<never> { throw new Error('search is outside this fixture') }
}
class Adapter extends LlmAdapter {
  calls = 0
  text = 'New work'
  nextTool?: string
  hang = false
  beforeResponse?: (request: GenerateOptions) => Promise<void>
  async listModels(provider: string) { return [{ provider, id: 'model', name: 'Model' }] }
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  async *stream(_request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++
    await this.beforeResponse?.(_request)
    if (this.hang) {
      await new Promise<void>((_resolve, reject) => {
        _request.signal?.addEventListener('abort', () => reject(new Error('fixture request interrupted')), { once: true })
      })
      return
    }
    if (this.nextTool) {
      const name = this.nextTool
      this.nextTool = undefined
      const id = ToolCallId('fixture-call')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'a2d2-runtime-'))
  roots.push(path)
  return path
}
async function mount(path: string, enabled = true, adapter = new Adapter()) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['fixture'], adapter)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root: join(path, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Query)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(path, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(StubCommands)
  const selections: string[] = []
  ctx.provide('sessionController', {
    async resolveAgent(sessionId: SessionId) {
      return { agent: ctx.agents.get(sessionId) ?? (await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: { provider: 'fixture', model: 'model' } })).agent }
    },
    async selectLocalModel(request: { sessionId: SessionId; provider: string; model: string }) {
      const agent = ctx.agents.get(request.sessionId)!
      selections.push(request.sessionId)
      agent.ctx.on('agent/request', async (_payload, next) => ({ ...await next(), provider: request.provider, model: request.model }))
      return { selected: { provider: request.provider, model: request.model } }
    },
  } as never)
  await ctx.plugin(A2d2Service, { root: path, stageAgents: { agents: { ceo: ['fixture/model'] } } as never })
  await ctx.plugin(runtimePlugin, { enabled, homeDir: join(path, 'runtime'), pollMs: 3600000, maxAutoTurns: 8, maxFailures: 3 })
  const runner = ctx.a2d2TaskRuntime.runner
  return { ctx, runner, adapter, selections, path }
}
type Harness = Awaited<ReturnType<typeof mount>>
async function initial(h: Harness) {
  const { agent } = await h.ctx.agents.create({ sessionId: SessionId('session-original'), meta: { cwd: h.path }, agentOptions: { provider: 'fixture', model: 'model' } })
  const workspace = await h.ctx.workspaceRegistry.create(h.path)
  await workspace.attachSession(agent.id)
  await h.ctx.a2d2.bindMainSession({ cwd: h.path, issue: 112, mainSession: agent.id, now: new Date() })
  return agent
}
async function fill(h: Harness, source: SessionId) {
  const path = join(handoffsDirectory(h.path), handoffDocumentName(source))
  await writeFile(path, (await readFile(path, 'utf8')).replace(HANDOFF_SUMMARY_PLACEHOLDER, 'Continue issue #112 from its recorded acceptance criteria.'))
}
async function rotate(h: Harness, agent: Agent) {
  let record = await h.runner.control(h.path, agent.id, 'rotate')
  await agent.whenIdle()
  await fill(h, agent.id)
  await h.runner.tick(record)
  record = (await h.runner.status(h.path, agent.id))!
  await h.runner.tick(record)
  const next = await h.runner.host.agent(record.current)
  await next.whenIdle()
  return next
}

describe('task runtime over real DSH loop, JSONL persistence, query and workspace services', () => {
  it('wakes a persisted unconsumed handoff after reconstruction without adding a second model message', async () => {
    const path = await root()
    let h = await mount(path)
    const source = await initial(h)
    await h.runner.start(path, source.id)
    await source.whenIdle()
    const deliver = h.runner.host.deliver.bind(h.runner.host)
    vi.spyOn(h.runner.host, 'deliver').mockImplementationOnce(async (id, item, inMaintenance) => {
      await deliver(id, item, inMaintenance)
      // Process-exit checkpoint: the real send and flush happened inside
      // maintenance, but disposal prevents its wake latch from being released.
      source.cancel({ kind: 'disposed' }, { keepInbox: true })
    })
    const record = await h.runner.control(path, source.id, 'rotate')
    const instruction = record.operation!.instruction!
    expect(instruction.delivered).toBe(true)
    expect(await h.runner.host.deliveryState(source.id, instruction)).toBe('queued')
    expect(source.status).toBe('idle')
    await h.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(h.ctx), 1)
    const adapter = new Adapter()
    adapter.beforeResponse = async () => { await fill(h, source.id) }
    h = await mount(path, true, adapter)
    await h.runner.recover()
    const resumed = await h.runner.host.agent(source.id)
    await resumed.whenIdle()
    expect(await h.runner.host.deliveryState(source.id, instruction)).toBe('consumed')
    const messages = (await h.runner.host.events(source.id)).filter(event => event.type === 'user/message')
    expect(messages.filter(event => event.data.id === instruction.message.id)).toHaveLength(1)
    expect(messages.some(event => event.data.source?.eventId === 'wake-inbox')).toBe(false)
    expect(adapter.calls).toBe(1)
    await h.runner.tick(record)
    await h.runner.tick(record)
    const settled = (await h.runner.store.read(record))!
    await (await h.runner.host.agent(settled.current)).whenIdle()
    expect(settled.generation).toBe(1)
    expect(settled.state).toBe('running')
  })

  it.each([
    ['watching', 'open', true], ['pending', undefined, true], ['ended', 'merged', false],
    ['denied', undefined, false], ['not_installed', undefined, false], ['failed', undefined, false],
  ] as const)('waits only for an active registration: %s', async (status, state, waiting) => {
    const h = await mount(await root())
    const agent = await initial(h)
    h.ctx.tools.register(defineTool({
      name: 'github_watch', description: 'Scripted registration result', parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', required: true }, state: { type: 'string' } } },
        render: (_args, value) => [{ type: 'text', text: value.status }],
        presentationMeta: (_args, value) => ({ a2d2GitHubWatch: value }),
      },
      async execute() { if (status === 'failed') throw new Error('registration failed'); return { status, ...(state ? { state } : {}) } },
      presentCall: () => ({ card: 'generic', title: 'Watch', kind: 'other' }),
    }))
    h.adapter.nextTool = 'github_watch'
    const record = await h.runner.start(h.path, agent.id)
    await agent.whenIdle()
    expect(await h.runner.host.waitingOnWatch(agent.id)).toBe(waiting)
    await h.runner.tick(record)
    expect((await h.runner.store.read(record))?.state).toBe(waiting ? 'waiting-event' : 'running')
  })

  it('durably accepts an event while successor creation holds the transition lock longer than its timeout', async () => {
    const h = await mount(await root())
    const source = await initial(h)
    await h.runner.start(h.path, source.id)
    await source.whenIdle()
    const record = await h.runner.control(h.path, source.id, 'rotate')
    await source.whenIdle()
    await fill(h, source.id)
    let entered!: () => void
    let release!: () => void
    const inside = new Promise<void>(resolve => { entered = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    const create = h.runner.host.ensureSuccessor.bind(h.runner.host)
    vi.spyOn(h.runner.host, 'ensureSuccessor').mockImplementationOnce(async next => { entered(); await held; return create(next) })
    const transition = h.runner.tick(record)
    await inside
    const releaseTimer = setTimeout(release, 2300)
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const accepted = await Promise.race([
        h.runner.enqueue(record, 'slow-creation-event', 'Arrived during slow successor creation'),
        new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('event enqueue waited for the transition lock')), 1500) }),
      ])
      expect(accepted).toBe(true)
      await h.runner.enqueue(record, 'slow-creation-event', 'duplicate')
      expect(await new RuntimeStore(h.runner.store.directory).pending(record)).toHaveLength(1)
      expect((await h.runner.status(h.path, source.id))?.inbox).toHaveLength(1)
      await transition
    } finally { clearTimeout(releaseTimer); if (deadline) clearTimeout(deadline); release(); await transition }
    await h.runner.tick(record)
    const current = (await h.runner.store.read(record))!.current
    const successor = await h.runner.host.agent(current)
    await successor.whenIdle()
    await h.runner.tick(record)
    await successor.whenIdle()
    await h.runner.tick(record)
    expect((await h.runner.host.events(current)).filter(event => event.type === 'user/message' && event.data.source?.eventId === 'slow-creation-event')).toHaveLength(1)
    expect(await h.runner.store.pending(record)).toEqual([])
  })

  it('retries an interrupted active turn once with a durable recovery message after host restart', async () => {
    const path = await root()
    let h = await mount(path)
    const agent = await initial(h)
    h.adapter.hang = true
    const record = await h.runner.start(path, agent.id)
    await vi.waitFor(() => expect(h.adapter.calls).toBe(1))
    await h.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(h.ctx), 1)
    h = await mount(path)
    await h.runner.recover()
    await h.runner.tick(record)
    const resumed = await h.runner.host.agent(agent.id)
    await resumed.whenIdle()
    const events = await h.runner.host.events(agent.id)
    expect(events.filter(event => event.type === 'user/message' && event.data.source?.eventId?.startsWith('recover:')), JSON.stringify({ record: await h.runner.store.read(record), events: events.map(event => ({ type: event.type, reason: event.data.reason })) })).toHaveLength(1)
    expect(h.adapter.calls).toBe(1)
    expect((await h.runner.store.read(record))?.state).toBe('running')
  })

  it('keeps the execution fence after scheduler shutdown and rotates healthy generations automatically', async () => {
    const h = await mount(await root())
    const agent = await initial(h)
    h.runner.options.maxAutoTurns = 1
    const record = await h.runner.start(h.path, agent.id)
    await agent.whenIdle()
    await h.runner.tick(record)
    expect((await h.runner.store.read(record))?.operation?.step).toBe('prepare')
    await h.runner.close()
    const calls = h.adapter.calls
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'must stay fenced after unload' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(h.adapter.calls).toBe(calls)
  })

  it('accepts the disabled default configuration without requiring a runtime directory', () => {
    expect(runtimePlugin.Config({})).toMatchObject({ enabled: false, pollMs: 2000 })
    expect(runtimePlugin.Config({ enabled: false })).not.toHaveProperty('homeDir')
  })

  it('observes a real in-flight question and resumes the same turn after its answer', async () => {
    const h = await mount(await root())
    const agent = await initial(h)
    let answer!: () => void
    const answered = new Promise<void>(resolve => { answer = resolve })
    h.ctx.tools.register(defineTool({
      name: 'ask_user_question', description: 'Fixture question with an actual pending tool lifetime', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { answer: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.answer }] },
      async execute() { await answered; return { answer: 'Continue' } },
      presentCall: () => ({ card: 'generic', title: 'Question', kind: 'other' }),
    }))
    h.adapter.nextTool = 'ask_user_question'
    const record = await h.runner.start(h.path, agent.id)
    try {
      await vi.waitFor(async () => expect(await h.runner.host.askedHuman(agent.id)).toBe(true))
      await h.runner.tick(record)
      expect((await h.runner.store.read(record))?.state).toBe('waiting-human')
      expect(h.adapter.calls).toBe(1)
    } finally { answer() }
    await agent.whenIdle()
    expect(await h.runner.host.askedHuman(agent.id)).toBe(false)
    expect(h.adapter.calls).toBe(2)
    expect((await h.runner.store.read(record))?.state).toBe('running')
  })

  it('holds rotation until the native child settles and its notification reaches the parent', async () => {
    const h = await mount(await root())
    const parent = await initial(h)
    const record = await h.runner.start(h.path, parent.id)
    await parent.whenIdle()
    const { agent: child } = await h.ctx.agents.create({ sessionId: SessionId('session-native-child'), parentAgent: parent,
      meta: { cwd: h.path, parentSession: parent.id, origin: 'subagent' }, agentOptions: { provider: 'fixture', model: 'model' } })
    Reflect.apply(parent.session.append, parent.session, ['subagent/catalog', { version: 0, childId: child.id, childCreatedAt: child.session.header.createdAt, mode: 'continuable', label: 'fixture' }])
    await h.runner.control(h.path, parent.id, 'rotate')
    expect((await h.runner.store.read(record))?.operation?.step).toBe('prepare')
    expect((await h.runner.store.read(record))?.error).toContain('native subagents')
    child.followup(createUserMessage({ content: [{ type: 'text', text: 'Finish fixture' }], source: { kind: 'user' } }))
    await child.whenIdle()
    await h.runner.tick(record)
    expect((await h.runner.store.read(record))?.operation?.step).toBe('prepare')
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Child finished' }],
      source: { kind: 'subagent-settled', senderSessionId: child.id, form: 'notice', summary: 'Child finished' } as never }))
    await parent.whenIdle()
    await h.runner.tick(record)
    await parent.whenIdle()
    expect((await h.runner.store.read(record))?.operation?.step).toBe('write')
  })

  it('lets the human command bind and start an issue without a model bookkeeping prompt', async () => {
    const h = await mount(await root())
    const { agent } = await h.ctx.agents.create({ sessionId: SessionId('session-command'), meta: { cwd: h.path }, agentOptions: { provider: 'fixture', model: 'model' } })
    const workspace = await h.ctx.workspaceRegistry.create(h.path)
    await workspace.attachSession(agent.id)
    const command = (h.ctx.commands as unknown as StubCommands).find(agent, 'task-runtime')!
    const result = await command.handler({ agent, rawInput: 'start 112 Runtime acceptance' } as never)
    await agent.whenIdle()
    expect(result.kind).toBe('success')
    expect((await h.ctx.a2d2.taskOfMainSession(h.path, agent.id))?.name).toBe('Runtime acceptance')
    expect((await h.runner.status(h.path, agent.id))?.current).toBe(agent.id)
  })

  it('requires explicit enable/start and continues active tasks without a model intent report', async () => {
    const h = await mount(await root(), false)
    const agent = await initial(h)
    await expect(h.runner.start(h.path, agent.id)).rejects.toThrow('disabled')
    expect(await h.runner.store.list()).toEqual([])
    h.runner.options.enabled = true
    const record = await h.runner.start(h.path, agent.id)
    await agent.whenIdle()
    expect(h.adapter.calls).toBe(1)
    await h.runner.tick(record)
    expect((await h.runner.store.read(record))?.drive?.id).toMatch(/^continue:/)
    await h.runner.tick(record)
    await agent.whenIdle()
    expect(h.adapter.calls).toBe(2)
    await h.runner.decide(h.path, agent.id, 'wait-event', 'Waiting for review')
    await h.runner.tick(record)
    await h.runner.tick(record)
    expect(h.adapter.calls).toBe(2)
    expect((await h.runner.store.read(record))?.state).toBe('waiting-event')
  })

  it('performs two handoffs, preserves workspace/model initialization, routes an in-handoff event and fences both old sessions', async () => {
    const h = await mount(await root())
    const source = await initial(h)
    const started = await h.runner.start(h.path, source.id)
    await source.whenIdle()
    const first = await rotate(h, source)
    let record = await h.runner.control(h.path, first.id, 'rotate')
    await first.whenIdle()
    await h.runner.enqueue(record, 'pr:112:merged', 'PR #112 merged during handoff')
    await h.runner.enqueue(record, 'pr:112:merged', 'duplicate')
    await fill(h, first.id)
    await h.runner.tick(record)
    record = (await h.runner.store.read(record))!
    await h.runner.tick(record)
    const second = await h.runner.host.agent(record.current)
    await second.whenIdle()
    await h.runner.tick(record)
    await second.whenIdle()
    expect((await h.runner.store.read(record))?.generation).toBe(2)
    expect(h.selections).toEqual([first.id, second.id])
    expect(h.ctx.workspaceRegistry.get(started.workspace as never)?.sessionIds).toEqual(expect.arrayContaining([source.id, first.id, second.id]))
    const events = await h.runner.host.events(second.id)
    expect(events.filter(event => event.type === 'user/message' && event.data.source?.eventId === 'pr:112:merged')).toHaveLength(1)
    const before = h.adapter.calls
    for (const old of [source, first]) {
      old.followup(createUserMessage({ content: [{ type: 'text', text: 'stale execution attempt' }], source: { kind: 'user' } }))
      await old.whenIdle()
    }
    expect(h.adapter.calls).toBe(before)
    expect((await h.runner.host.events(source.id)).at(-1)?.data.reason).toEqual({ kind: 'blocked' })
    await expect(h.ctx.a2d2.takeHandoff({ cwd: h.path, source: second.id, successor: SessionId('intruder') })).rejects.toThrow('runtime owns')
    await expect(h.ctx.a2d2.bindMainSession({ cwd: h.path, issue: 112, mainSession: source.id, now: new Date() })).rejects.toThrow('already has main session')
  })

  it('recovers the same successor after process-level host reconstruction following create failure', async () => {
    const path = await root()
    let h = await mount(path)
    const source = await initial(h)
    await h.runner.start(path, source.id)
    await source.whenIdle()
    let record = await h.runner.control(path, source.id, 'rotate')
    await source.whenIdle()
    await fill(h, source.id)
    const create = h.runner.host.ensureSuccessor.bind(h.runner.host)
    vi.spyOn(h.runner.host, 'ensureSuccessor').mockImplementationOnce(async next => { await create(next); throw new Error('fault after successor creation') })
    await h.runner.tick(record)
    record = (await h.runner.store.read(record))!
    const reserved = record.operation!.successor
    expect(record.error).toBe('fault after successor creation')
    expect(h.ctx.agents.get(reserved)).toBeDefined()
    await h.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(h.ctx), 1)
    h = await mount(path)
    await h.runner.recover()
    await h.runner.tick(record)
    record = (await h.runner.store.read(record))!
    expect(record.current).toBe(reserved)
    expect(record.generation).toBe(1)
    expect((await h.ctx.a2d2.list(path))[0]?.members).toHaveLength(2)
    expect((await h.ctx.sessionPersistence.list()).map(item => item.header.id).sort()).toEqual([source.id, reserved].sort())
  })

  it('recovers a committed take and a delivered event without repeating their messages', async () => {
    const h = await mount(await root())
    const source = await initial(h)
    await h.runner.start(h.path, source.id)
    await source.whenIdle()
    let record = await h.runner.control(h.path, source.id, 'rotate')
    await source.whenIdle()
    await fill(h, source.id)
    const take = h.ctx.a2d2.takeHandoff.bind(h.ctx.a2d2)
    vi.spyOn(h.ctx.a2d2, 'takeHandoff').mockImplementationOnce(async request => { await take(request); throw new Error('fault after take commit') })
    await h.runner.tick(record)
    expect((await h.runner.store.read(record))?.operation?.continuation).toBeDefined()
    await h.runner.tick(record)
    record = (await h.runner.store.read(record))!
    const successor = await h.runner.host.agent(record.current)
    await successor.whenIdle()
    await h.runner.enqueue(record, 'event-1', 'one durable event')
    const deliver = h.runner.host.deliver.bind(h.runner.host)
    vi.spyOn(h.runner.host, 'deliver').mockImplementationOnce(async (id, item) => { await deliver(id, item); throw new Error('fault after delivery flush') })
    await h.runner.tick(record)
    await successor.whenIdle()
    await h.runner.tick(record)
    await successor.whenIdle()
    const messages = (await h.runner.host.events(successor.id)).filter(event => event.type === 'user/message')
    expect(messages.filter(event => event.data.source?.eventId === 'event-1')).toHaveLength(1)
    expect(messages.filter(event => event.data.source?.eventId?.startsWith('take:'))).toHaveLength(1)
  })

  it('bounds no-progress continuations, pauses execution, and completes without another round', async () => {
    const h = await mount(await root())
    const agent = await initial(h)
    const record = await h.runner.start(h.path, agent.id)
    await agent.whenIdle()
    for (let i = 0; i < 8; i++) { await h.runner.tick(record); await agent.whenIdle() }
    expect((await h.runner.store.read(record))?.state).toBe('blocked')
    expect((await h.runner.store.read(record))?.error).toContain('No new progress')
    await h.runner.control(h.path, agent.id, 'resume')
    await agent.whenIdle()
    await h.runner.control(h.path, agent.id, 'stop')
    const calls = h.adapter.calls
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'paused' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(h.adapter.calls).toBe(calls)
    await h.runner.control(h.path, agent.id, 'resume')
    await agent.whenIdle()
    await h.ctx.a2d2.completeTask({ cwd: h.path, caller: agent.id, summary: 'accepted' })
    await h.runner.tick(record)
    expect((await h.runner.store.read(record))?.state).toBe('done')
  })

  it('does not admit a second runtime owner or concurrent duplicate tick', async () => {
    const h = await mount(await root())
    const agent = await initial(h)
    const [a, b] = await Promise.all([h.runner.start(h.path, agent.id), h.runner.start(h.path, agent.id)])
    await agent.whenIdle()
    expect(a.current).toBe(b.current)
    expect(h.adapter.calls).toBe(1)
    const other = new RuntimeStore(h.runner.store.directory)
    await expect(other.own(a, async () => {})).rejects.toThrow('timed out')
    await h.runner.decide(h.path, agent.id, 'wait-event', '')
    await Promise.all([h.runner.tick(a), h.runner.tick(a), h.runner.tick(a)])
    expect(h.adapter.calls).toBe(1)
  })
})

it('uses an actual cross-process lock and recovers ownership after the holder exits', async () => {
  const path = await root()
  const store = new RuntimeStore(path)
  const address = { projectRoot: path, task: 'issue-112' as never }
  const script = `import { RuntimeStore } from ${JSON.stringify(new URL('../src/task-runtime/store.ts', import.meta.url).href)}; const store = new RuntimeStore(process.argv[1]); await store.own(JSON.parse(process.argv[2]), async () => { setInterval(() => {}, 1000); console.log('locked'); await new Promise(() => {}); });`
  const child = spawn(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', script, path, JSON.stringify(address)], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  const ready = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error(`lock child exited before acquiring: ${stderr}`) })])
  expect(String(ready[0])).toContain('locked')
  try { await expect(store.own(address, async () => {})).rejects.toThrow('timed out') }
  finally { child.kill('SIGKILL'); await once(child, 'exit') }
  let owned = false
  await store.own(address, async () => { owned = true })
  expect(owned).toBe(true)
})
