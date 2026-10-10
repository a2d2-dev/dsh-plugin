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

  it('creates a subtask root with the configured CEO effort', async () => {
    const root = await mkdtemp(join(tmpdir(), 'a2d2-effort-root-'))
    const ctx = new Context()
    const parent = SessionId('session-parent')
    const create = vi.fn(async (options: { sessionId: SessionId }) => ({ agent: stubAgent(root, options.sessionId) }))
    ctx.provide('agents', { create } as never)
    try {
      await ctx.plugin(StubLlm, { routes: [route] })
      await ctx.plugin(A2d2Service, { root, stageAgents: {
        ...settings, agents: { ...settings.agents, ceo: [candidate] },
      } as never })
      await ctx.a2d2.bindMainSession({ cwd: root, issue: 105, mainSession: parent, now: new Date() })
      await ctx.a2d2.openSubtask({ cwd: root, caller: parent, issue: 106, now: new Date() })
      expect(create.mock.calls[0]?.[0]).toMatchObject({ agentOptions: candidateSelection(candidate) })
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
