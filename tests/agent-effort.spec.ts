import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import A2d2Service from '../src/index.ts'
import {
  DEFAULT_STAGE_AGENTS, StageAgentsSettingsSchema,
  validateCompleteStageAgentsSettings, validateStageAgentsSettings, stageAgentWarnings,
} from '../src/stage-agents.ts'
import {
  candidateRoute, candidateSelection, isModelCandidate,
} from '../src/stage-agent-data.ts'
import { parseConsultResponse, startSessionAsAgent } from '../src/client/consult-actions.ts'
import { classifyModelProbe } from '../src/config-page.ts'
import { generateConsultWithFallback } from '../src/consult.ts'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { StubLlm, stubAgent } from './stubs.ts'

const route = 'claude-bray/claude-opus-5-5'
const candidate = { route, reasoningEffort: 'medium' }
const settings = {
  ...DEFAULT_STAGE_AGENTS,
  agents: { ...DEFAULT_STAGE_AGENTS.agents, engineer: [candidate], reviewer: [{ route, reasoningEffort: 'high' }] },
  consult: [candidate],
}

describe('Agent candidate reasoning effort', () => {
  it('round-trips mixed legacy and structured candidates without modifying defaults', () => {
    expect(validateStageAgentsSettings(settings)).toEqual(settings)
    expect(validateCompleteStageAgentsSettings(settings)).toEqual(settings)
    expect(StageAgentsSettingsSchema(DEFAULT_STAGE_AGENTS as never)).toEqual(DEFAULT_STAGE_AGENTS)
    expect(candidateSelection(candidate)).toEqual({ provider: 'claude-bray', model: 'claude-opus-5-5', reasoningEffort: 'medium' })
    expect(candidateSelection(route)).not.toHaveProperty('reasoningEffort')
  })

  it.each([
    { route, reasoningEffort: '' }, { route, reasoningEffort: ' medium' },
    { route, reasoningEffort: null }, { route, reasoningEffort: 4 },
    { route, effort: 'medium' }, { route: 'bad' }, null, [],
  ])('rejects malformed candidate %j', bad => {
    expect(isModelCandidate(bad)).toBe(false)
    expect(() => validateCompleteStageAgentsSettings({ ...settings, consult: [bad] })).toThrow(/consult/)
  })

  it('still warns for the same model with different efforts', () => {
    expect(stageAgentWarnings(settings)[0]).toContain(route)
  })

  it('keeps structured candidates in the consult response and rejects malformed effort', () => {
    const response = { ok: true, value: { candidates: [], degraded: false, stageAgents: settings } }
    expect(parseConsultResponse(response)).toMatchObject({ value: { stageAgents: { agents: settings.agents } } })
    expect(() => parseConsultResponse({ ...response, value: {
      ...response.value, stageAgents: { ...settings, agents: { ...settings.agents, engineer: [{ route, reasoningEffort: '' }] } },
    } })).toThrow(/无效/)
  })

  it('browser startup calls only the host Agent endpoint, not the default-saving picker', async () => {
    const select = vi.fn()
    const registerSessionAgent = vi.fn(async () => {})
    await startSessionAsAgent({
      registerSessionAgent,
      modelDirectories: { directoryFor: () => ({ load: vi.fn(), select }) },
    }, 'session-new', { agent: 'engineer', label: '工程师', routes: [candidate] }, '新会话')
    expect(registerSessionAgent).toHaveBeenCalledWith('session-new', 'engineer')
    expect(select).not.toHaveBeenCalled()
  })

  it('uses official Agent.model.select with validated effort and leaves global defaults unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'a2d2-official-effort-'))
    const ctx = new Context()
    const id = SessionId('official-model')
    const select = vi.fn()
    const saveSelection = vi.fn()
    const selectModel = vi.fn()
    const resolveCallConfig = vi.fn(async (selection: unknown) => selection)
    ctx.provide('agents', { get: () => ({ ...stubAgent(root, id), model: { current: () => undefined, select } }) } as never)
    ctx.provide('sessionController', { selectModel } as never)
    ctx.provide('agentDefaultModel', { saveSelection } as never)
    try {
      await ctx.plugin(StubLlm, { routes: [route] })
      Object.assign(ctx.llm, { resolveCallConfig })
      await ctx.plugin(A2d2Service, { root, stageAgents: settings as never })
      await ctx.a2d2.initializeSessionAgent(root, id, 'engineer')
      expect(resolveCallConfig).toHaveBeenCalledWith(candidateSelection(candidate))
      expect(select).toHaveBeenCalledWith(candidateSelection(candidate))
      expect(selectModel).not.toHaveBeenCalled()
      expect(saveSelection).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('host initialization sets a session-local effort and never saves host defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'a2d2-effort-'))
    const ctx = new Context()
    const id = SessionId('session-effort')
    const live = stubAgent(root, id)
    const selectLocalModel = vi.fn(async () => ({ selected: candidateSelection(candidate) }))
    const selectModel = vi.fn()
    const saveSelection = vi.fn()
    const create = vi.fn(async () => ({ agent: live }))
    ctx.provide('agents', { get: () => live, create } as never)
    ctx.provide('sessionController', { selectLocalModel, selectModel } as never)
    ctx.provide('agentDefaultModel', { saveSelection } as never)
    try {
      await ctx.plugin(StubLlm, { routes: [route] })
      await ctx.plugin(A2d2Service, { root, stageAgents: settings as never })
      await ctx.a2d2.initializeSessionAgent(root, id, 'engineer')
      expect(selectLocalModel).toHaveBeenCalledWith({ sessionId: id, ...candidateSelection(candidate) })
      expect(selectModel).not.toHaveBeenCalled()
      expect(saveSelection).not.toHaveBeenCalled()
      expect(live.options).toEqual({})
      await ctx.a2d2.initializeSessionAgent(root, id, 'engineer')
      expect(selectLocalModel).toHaveBeenCalledTimes(1)
      await expect(ctx.a2d2.initializeSessionAgent(root, id, 'reviewer')).rejects.toThrow(/already recorded/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects hosts without the public local selector without calling the default-saving selector', async () => {
    const root = await mkdtemp(join(tmpdir(), 'a2d2-effort-api-'))
    const ctx = new Context()
    const id = SessionId('session-no-local-api')
    const selectModel = vi.fn()
    ctx.provide('sessionController', { selectModel } as never)
    try {
      await ctx.plugin(StubLlm, { routes: [route] })
      await ctx.plugin(A2d2Service, { root, stageAgents: settings as never })
      await expect(ctx.a2d2.initializeSessionAgent(root, id, 'engineer')).rejects.toThrow(/sessionController.selectLocalModel is required/)
      expect(selectModel).not.toHaveBeenCalled()
      expect(await ctx.a2d2.agentOfSession(root, id)).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retries failed installation without retaining an Agent record or poisoning the queue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'a2d2-effort-retry-'))
    const ctx = new Context()
    const id = SessionId('session-retry')
    const selectLocalModel = vi.fn()
      .mockRejectedValueOnce(new Error('installation failed'))
      .mockResolvedValue({ selected: candidateSelection(candidate) })
    ctx.provide('sessionController', { selectLocalModel } as never)
    try {
      await ctx.plugin(StubLlm, { routes: [route] })
      await ctx.plugin(A2d2Service, { root, stageAgents: settings as never })
      await expect(ctx.a2d2.initializeSessionAgent(root, id, 'engineer')).rejects.toThrow('installation failed')
      expect(await ctx.a2d2.agentOfSession(root, id)).toBeUndefined()
      await ctx.a2d2.initializeSessionAgent(root, id, 'engineer')
      expect(selectLocalModel).toHaveBeenCalledTimes(2)
      expect(await ctx.a2d2.agentOfSession(root, id)).toBe('engineer')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['engineer', 'reviewer'] as const)('serializes concurrent initialization as %s without blocking another session', async secondAgent => {
    const root = await mkdtemp(join(tmpdir(), 'a2d2-effort-concurrent-'))
    const ctx = new Context()
    const id = SessionId('session-concurrent')
    const other = SessionId('session-independent')
    let release!: () => void
    let entered!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const firstEntered = new Promise<void>(resolve => { entered = resolve })
    const selectLocalModel = vi.fn(async (request: { sessionId: SessionId }) => {
      if (request.sessionId === id) {
        entered()
        await blocked
      }
      return { selected: candidateSelection(candidate) }
    })
    ctx.provide('sessionController', { selectLocalModel } as never)
    try {
      await ctx.plugin(StubLlm, { routes: [route] })
      await ctx.plugin(A2d2Service, { root, stageAgents: settings as never })
      const first = ctx.a2d2.initializeSessionAgent(root, id, 'engineer')
      await firstEntered
      const results = Promise.allSettled([first, ctx.a2d2.initializeSessionAgent(root, id, secondAgent)])
      await ctx.a2d2.initializeSessionAgent(root, other, 'engineer')
      expect(await ctx.a2d2.agentOfSession(root, id)).toBeUndefined()
      release()
      const settled = await results
      expect(settled[0]?.status).toBe('fulfilled')
      if (secondAgent === 'engineer') expect(settled[1]?.status).toBe('fulfilled')
      else expect(settled[1]).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('already recorded') }) })
      expect(selectLocalModel.mock.calls.filter(([request]) => request.sessionId === id)).toHaveLength(1)
      expect(await ctx.a2d2.agentOfSession(root, id)).toBe('engineer')
      await ctx.a2d2.initializeSessionAgent(root, id, 'engineer')
      expect(selectLocalModel.mock.calls.filter(([request]) => request.sessionId === id)).toHaveLength(1)
    } finally {
      release()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('allows an already queued retry after installation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'a2d2-effort-queued-retry-'))
    const ctx = new Context()
    const id = SessionId('session-queued-retry')
    const selectLocalModel = vi.fn()
      .mockRejectedValueOnce(new Error('installation failed'))
      .mockResolvedValue({ selected: candidateSelection(candidate) })
    ctx.provide('sessionController', { selectLocalModel } as never)
    try {
      await ctx.plugin(StubLlm, { routes: [route] })
      await ctx.plugin(A2d2Service, { root, stageAgents: settings as never })
      const results = await Promise.allSettled([
        ctx.a2d2.initializeSessionAgent(root, id, 'engineer'),
        ctx.a2d2.initializeSessionAgent(root, id, 'engineer'),
      ])
      expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled'])
      expect(selectLocalModel).toHaveBeenCalledTimes(2)
      expect(await ctx.a2d2.agentOfSession(root, id)).toBe('engineer')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves a manual local model selection after successful initialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'a2d2-effort-manual-'))
    const ctx = new Context()
    const id = SessionId('session-manual')
    let selected = candidateSelection(candidate)
    const selectLocalModel = vi.fn(async (request: typeof selected & { sessionId: SessionId }) => {
      selected = { provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort }
      return { selected }
    })
    ctx.provide('sessionController', { selectLocalModel } as never)
    try {
      await ctx.plugin(StubLlm, { routes: [route] })
      await ctx.plugin(A2d2Service, { root, stageAgents: settings as never })
      await ctx.a2d2.initializeSessionAgent(root, id, 'engineer')
      await selectLocalModel({ sessionId: id, provider: 'manual', model: 'user-choice', reasoningEffort: 'high' })
      await ctx.a2d2.initializeSessionAgent(root, id, 'engineer')
      expect(selected).toEqual({ provider: 'manual', model: 'user-choice', reasoningEffort: 'high' })
      expect(selectLocalModel).toHaveBeenCalledTimes(2)
      expect(await ctx.a2d2.agentOfSession(root, id)).toBe('engineer')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates a subtask root with the configured CEO effort', async () => {
    const root = await mkdtemp(join(tmpdir(), 'a2d2-effort-root-'))
    const ctx = new Context()
    const parent = SessionId('session-parent')
    const live = new Map([[parent, stubAgent(root, parent)]])
    const create = vi.fn(async (options: { sessionId: SessionId }) => {
      live.set(options.sessionId, stubAgent(root, options.sessionId))
      return { sessionId: options.sessionId }
    })
    const selectLocalModel = vi.fn(async (request: unknown) => ({ selected: request }))
    ctx.provide('agents', { get: (id: SessionId) => live.get(id) } as never)
    ctx.provide('sessionController', { create, resolveAgent: async (id: SessionId) => ({ agent: live.get(id) }), selectLocalModel } as never)
    try {
      await ctx.plugin(StubLlm, { routes: [route] })
      await ctx.plugin(A2d2Service, { root, stageAgents: {
        ...settings, agents: { ...settings.agents, ceo: [candidate] },
      } as never })
      await ctx.a2d2.bindMainSession({ cwd: root, issue: 105, mainSession: parent, now: new Date() })
      await ctx.a2d2.openSubtask({ cwd: root, caller: parent, issue: 106, now: new Date() })
      expect(selectLocalModel.mock.calls[0]?.[0]).toMatchObject(candidateSelection(candidate))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('consult fallback sends each candidate own effort', async () => {
    const calls: GenerateOptions[] = []
    const text = JSON.stringify({
      position: 'Ready for specification.',
      location: { zone: 'main', station: 'grill', phaseDone: true },
      next: { station: 'to-spec', move: 'continue', reason: 'Retain context.' },
      candidates: [
        { label: 'Continue', input: '/to-spec', move: 'continue', station: 'to-spec' },
        { label: 'Review', input: '/code-review', move: 'subagent', station: 'code-review' },
      ],
    })
    const stream = (options: GenerateOptions): AsyncIterable<StreamChunk> => {
      calls.push(options)
      if (calls.length === 1) throw new Error('unavailable')
      return (async function* () {
        yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
        yield { type: 'text-delta' as const, index: 0, text }
        yield { type: 'block-end' as const, index: 0, block: { type: 'text' as const, text } }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      })()
    }
    const result = await generateConsultWithFallback({
      stream, routes: [candidate, { route: 'codex/model', reasoningEffort: 'high' }],
      sessionId: SessionId('session-consult'), prompt: 'Consult.',
      validation: { stageAgents: settings, sessionAgent: 'ceo' }, signal: new AbortController().signal,
    })
    expect(calls.map(call => call.reasoningEffort)).toEqual(['medium', 'high'])
    expect(result.answeredBy).toBe('codex/model')
    expect(result.fallbacks[0]?.route).toBe(route)
  })

  it('probe streams the explicit effort instead of the provider default', async () => {
    const stream = vi.fn(() => (async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'OK' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'OK' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })())
    await expect(classifyModelProbe({ route: candidate, stream })).resolves.toMatchObject({ status: 'normal' })
    expect(stream.mock.calls[0]).toEqual([expect.objectContaining({ reasoningEffort: 'medium' })])
    expect(candidateRoute(candidate)).toBe(route)
  })
})
