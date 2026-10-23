import { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../../src/client/index.tsx'
import {
  A2d2ConfigSection,
  addConfigCandidate,
  configCandidateRows,
  configHighwayView,
  configUpdatePayload,
  configWarnings,
  loadModelRouteCatalog,
  moveConfigCandidate,
  normalizeConfigInjected,
  probeResultText,
  removeConfigCandidate,
  setConfigStageAgent,
  setConfigCandidateEffort,
} from '../../src/client/config-page.tsx'
import { DEFAULT_STAGE_AGENTS } from '../../src/stage-agent-data.ts'

class StubSlots extends Service {
  private readonly declared = new Set<string>()
  private readonly waiting = new Map<string, Array<() => void | (() => void)>>()
  private readonly registered = new Map<string, Array<{ options: Record<string, unknown>; component: unknown; inject?: unknown }>>()

  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  inject(name: string, setup: () => void | (() => void)): () => void {
    if (this.declared.has(name)) {
      const dispose = setup()
      return typeof dispose === 'function' ? dispose : () => {}
    }
    const list = this.waiting.get(name) ?? []
    list.push(setup)
    this.waiting.set(name, list)
    return () => {
      const current = this.waiting.get(name) ?? []
      const index = current.indexOf(setup)
      if (index >= 0) current.splice(index, 1)
    }
  }

  register(options: Record<string, unknown>, component: unknown): () => void {
    const name = String(options.name)
    const children = options.children as Record<string, unknown> | undefined
    if (children !== undefined) {
      for (const child of Object.keys(children)) this.declare(child)
      return () => {}
    }
    const entries = this.registered.get(name) ?? []
    const entry = { options, component, inject: options.inject }
    entries.push(entry)
    this.registered.set(name, entries)
    return () => {
      const current = this.registered.get(name) ?? []
      const index = current.indexOf(entry)
      if (index >= 0) current.splice(index, 1)
    }
  }

  entries(name: string): Array<{ options: Record<string, unknown>; component: unknown; inject?: unknown }> {
    return this.registered.get(name) ?? []
  }

  private declare(name: string): void {
    this.declared.add(name)
    const setups = this.waiting.get(name) ?? []
    this.waiting.delete(name)
    for (const setup of setups) setup()
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(StubSlots).await()
  ctx.provide('sessions', {} as never)
  const models = vi.fn(async () => ({
    ok: true as const,
    value: {
      groups: [
        { id: 'codex', name: 'Codex', models: [{ id: 'gpt-6', name: 'GPT-6' }] },
        { id: 'claude-bray', name: 'Claude Bray', models: [{ id: 'claude-fable-5-1', name: 'Fable 5.1' }] },
      ],
      failures: [],
    },
  }))
  const session = { modelCatalog: models }
  ctx.provide('remote', { session } as never)
  ctx.provide('remote.session', session as never)
  return { ctx, slots: ctx.get('slots') as unknown as StubSlots, models }
}

function declareSettings(slots: StubSlots): () => void {
  return slots.register({
    name: 'root',
    children: {
      'conversation.composer.dock': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('A2D2 config client registration', () => {
  it('keeps the existing client dependencies and registers the settings section lazily', async () => {
    expect(inject).toEqual(['slots', 'sessions', 'remote', 'remote.session'])
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    declareSettings(b.slots)
    await Promise.resolve()
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(A2d2ConfigSection)
    expect(entry.options).toMatchObject({ id: 'a2d2-config', order: 60 })
    expect(resolveSlotLabel(entry.options.label as SlotLabel)).toBe('A2D2 配置')

    const injected = entry.inject as unknown as () => {
      readonly loadModelRoutes: () => Promise<readonly string[]>
      readonly fetch: typeof fetch
    }
    await expect(injected().loadModelRoutes()).resolves.toEqual([
      'codex/gpt-6',
      'claude-bray/claude-fable-5-1',
    ])
    expect(b.models).toHaveBeenCalledOnce()
  })

  it('turns the DSH host model catalog into provider/model routes', async () => {
    await expect(loadModelRouteCatalog({
      session: {
        modelCatalog: async () => ({
          ok: true as const,
          value: {
            groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'model-a', name: 'A' }, { id: 'model-b', name: 'B' }] }],
            failures: [{ id: 'broken', name: 'Broken', message: 'down' }],
          },
        }),
      },
    })).resolves.toEqual(['provider/model-a', 'provider/model-b'])
  })

  it('fails loudly when the host refuses the model catalog', async () => {
    await expect(loadModelRouteCatalog({
      session: {
        modelCatalog: async () => ({ ok: false as const, error: { message: 'catalog unavailable' } }),
      },
    })).rejects.toThrow('catalog unavailable')
  })
})

describe('A2D2 config page view model', () => {
  it('edits and preserves per-candidate effort while keeping other Agents unchanged', () => {
    const route = 'claude-bray/claude-opus-5-5'
    const settings = { ...DEFAULT_STAGE_AGENTS, agents: {
      ...DEFAULT_STAGE_AGENTS.agents, engineer: [{ route, reasoningEffort: 'medium' }],
    } }
    const efforts = { [route]: [{ id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }] }
    const edited = setConfigCandidateEffort(settings, 'engineer', route, 'high', efforts)
    expect(edited.agents.engineer).toEqual([{ route, reasoningEffort: 'high' }])
    expect(edited.agents.ceo).toEqual(settings.agents.ceo)
    expect(settings.agents.engineer).toEqual([{ route, reasoningEffort: 'medium' }])
    expect(addConfigCandidate(edited, 'engineer', route, [route])).toBe(edited)
    const added = addConfigCandidate(edited, 'engineer', 'codex/model', ['codex/model'])
    expect(moveConfigCandidate(added, 'engineer', 0, 1).agents.engineer).toEqual(['codex/model', { route, reasoningEffort: 'high' }])
    expect(removeConfigCandidate(added, 'engineer', route).agents.engineer).toEqual(['codex/model'])
    expect(setConfigCandidateEffort(edited, 'engineer', route, '', efforts).agents.engineer).toEqual([route])
    expect(() => setConfigCandidateEffort(edited, 'engineer', route, 'max', efforts)).toThrow(/不支持/)
  })

  it('draws the whole Matt highway with stage Agent labels and a fixed standalone Agent', () => {
    const view = configHighwayView(DEFAULT_STAGE_AGENTS, ['claude-bray/claude-fable-5-1', 'codex/gpt-5.5'])

    expect(view.stations.map(station => [station.id, station.role, station.agent, station.models])).toEqual([
      ['grill', '澄清目标与约束', 'CEO', 'claude-fable-5-1'],
      ['to-spec', '沉淀规格与验收', 'CEO', 'claude-fable-5-1'],
      ['to-tickets', '拆成可实施工单', 'CEO', 'claude-fable-5-1'],
      ['implement', '实现与 TDD', '工程师', 'gpt-5.5'],
      ['code-review', '独立评审与收口', '评审', 'claude-fable-5-1'],
      ['prototype', '服务区：原型验证', 'CEO', 'claude-fable-5-1'],
      ['handoff', '服务区：交接', 'CEO', 'claude-fable-5-1'],
      ['triage', '匝道，并入 implement', 'CEO', 'claude-fable-5-1'],
      ['diagnosing-bugs', '匝道，并入 implement', 'CEO', 'claude-fable-5-1'],
      ['wayfinder', '匝道，并入 to-spec', 'CEO', 'claude-fable-5-1'],
      ['improve-codebase-architecture', '匝道，并入 grill', 'CEO', 'claude-fable-5-1'],
      ['domain-modeling', '路基：领域建模', 'CEO', 'claude-fable-5-1'],
      ['codebase-design', '路基：模块设计', 'CEO', 'claude-fable-5-1'],
      ['standalone', '独立区：其他 skill', 'CEO（任意 skill）', 'claude-fable-5-1'],
    ])
    expect(view.aside).toBe('服务区、匝道、路基、独立区均为 Matt 流程的一部分；匝道并入点由插件固定。')
  })

  it('edits stage Agents without changing the candidate lists', () => {
    const edited = setConfigStageAgent(DEFAULT_STAGE_AGENTS, 'to-spec', 'reviewer')

    expect(edited.stages['to-spec']).toBe('reviewer')
    expect(DEFAULT_STAGE_AGENTS.stages['to-spec']).toBe('ceo')
    expect(edited.agents).toEqual(DEFAULT_STAGE_AGENTS.agents)
    expect(edited.consult).toEqual(DEFAULT_STAGE_AGENTS.consult)
  })

  it('offers four editable candidate rows for CEO, engineer, reviewer, and consult', () => {
    const rows = configCandidateRows(DEFAULT_STAGE_AGENTS)

    expect(rows.map(row => [row.scope, row.label, row.routes])).toEqual([
      ['ceo', 'CEO', DEFAULT_STAGE_AGENTS.agents.ceo],
      ['engineer', '工程师', DEFAULT_STAGE_AGENTS.agents.engineer],
      ['reviewer', '评审', DEFAULT_STAGE_AGENTS.agents.reviewer],
      ['consult', '咨询', DEFAULT_STAGE_AGENTS.consult],
    ])
  })

  it('adds, removes, and sorts candidates only from the model catalog', () => {
    const added = addConfigCandidate(DEFAULT_STAGE_AGENTS, 'reviewer', 'codex/gpt-5.5', ['codex/gpt-5.5'])
    expect(added.agents.reviewer).toEqual(['claude-bray/claude-fable-5-1', 'codex/gpt-6', 'codex/gpt-5.5'])
    expect(() => addConfigCandidate(DEFAULT_STAGE_AGENTS, 'reviewer', 'missing/model', ['codex/gpt-5.5'])).toThrow('模型目录')

    const moved = moveConfigCandidate(added, 'reviewer', 2, -1)
    expect(moved.agents.reviewer).toEqual(['claude-bray/claude-fable-5-1', 'codex/gpt-5.5', 'codex/gpt-6'])

    const removed = removeConfigCandidate(moved, 'reviewer', 'codex/gpt-5.5')
    expect(removed.agents.reviewer).toEqual(DEFAULT_STAGE_AGENTS.agents.reviewer)
  })

  it('warns in Chinese and serializes the complete host settings shape with revision', () => {
    const warned = {
      ...DEFAULT_STAGE_AGENTS,
      agents: {
        ...DEFAULT_STAGE_AGENTS.agents,
        reviewer: DEFAULT_STAGE_AGENTS.agents.engineer,
      },
    }

    expect(configWarnings(warned)).toEqual([
      'a2d2: 评审和工程师的首选模型同为 codex/gpt-5.5；通常应为评审配置不同的首选模型',
    ])
    expect(configUpdatePayload(warned, 7)).toEqual({
      settings: warned,
      expectedRevision: 7,
    })
  })

  it('uses a stable default model-route loader across renders', () => {
    expect(normalizeConfigInjected({}).loadModelRoutes).toBe(normalizeConfigInjected({}).loadModelRoutes)
  })

  it('renders the model probe pending state without pretending it is normal', () => {
    expect(probeResultText({ status: 'pending', reason: '测试中' })).toBe('测试中…')
    expect(probeResultText({ status: 'normal', reason: 'OK' })).toBe('正常 · OK')
    expect(probeResultText({ status: 'refusal', reason: 'policy block' })).toBe('拒答 · policy block')
  })
})
