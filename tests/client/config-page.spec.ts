import { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../../src/client/index.tsx'
import {
  A2d2ConfigSection,
  configHighwayView,
  configModelRows,
  loadModelRouteCatalog,
  normalizeConfigInjected,
  probeResultText,
} from '../../src/client/config-page.tsx'
import { DEFAULT_STATION_MODELS } from '../../src/station-model-data.ts'

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
  it('draws the whole Matt highway and marks unconfigured stations as no model switch', () => {
    const view = configHighwayView(DEFAULT_STATION_MODELS)

    expect(view.stations.map(station => [station.id, station.role, station.models])).toEqual([
      ['grill', '澄清目标与约束', 'claude-fable-5-1'],
      ['to-spec', '沉淀规格与验收', 'claude-fable-5-1'],
      ['to-tickets', '拆成可实施工单', 'claude-fable-5-1'],
      ['implement', '实现与 TDD', 'gpt-5.5'],
      ['code-review', '独立评审与收口', 'claude-fable-5-1'],
      ['prototype', '服务区：原型验证', 'gpt-5.5'],
      ['handoff', '服务区：交接', '不切模型'],
      ['triage', '匝道，并入 implement', 'claude-fable-5-1'],
      ['diagnosing-bugs', '匝道，并入 implement', 'gpt-5.5'],
      ['wayfinder', '匝道，并入 to-spec', 'claude-fable-5-1'],
      ['improve-codebase-architecture', '匝道，并入 grill', 'claude-fable-5-1'],
      ['domain-modeling', '路基：领域建模', '不切模型'],
      ['codebase-design', '路基：模块设计', '不切模型'],
      ['standalone', '独立区：其他 skill', '不切模型'],
    ])
    expect(view.aside).toBe('服务区、匝道、路基、独立区均为 Matt 流程的一部分；匝道并入点由插件固定。')
  })

  it('offers editable route rows for every configured station and readonly rows for no-switch stations', () => {
    const rows = configModelRows(DEFAULT_STATION_MODELS)

    expect(rows.map(row => [row.scope, row.label, row.kind, row.routes])).toEqual([
      ['consult', '咨询', 'editable', DEFAULT_STATION_MODELS.consult],
      ['grill', '/grill · 澄清目标与约束', 'editable', DEFAULT_STATION_MODELS.stations.grill],
      ['to-spec', '/to-spec · 沉淀规格与验收', 'editable', DEFAULT_STATION_MODELS.stations['to-spec']],
      ['to-tickets', '/to-tickets · 拆成可实施工单', 'editable', DEFAULT_STATION_MODELS.stations['to-tickets']],
      ['implement', '/implement · 实现与 TDD', 'editable', DEFAULT_STATION_MODELS.stations.implement],
      ['code-review', '/code-review · 独立评审与收口', 'editable', DEFAULT_STATION_MODELS.stations['code-review']],
      ['prototype', '/prototype · 服务区：原型验证', 'editable', DEFAULT_STATION_MODELS.stations.prototype],
      ['handoff', '/handoff · 服务区：交接', 'fixed', []],
      ['triage', '/triage · 匝道，并入 implement', 'editable', DEFAULT_STATION_MODELS.stations.triage],
      ['diagnosing-bugs', '/diagnosing-bugs · 匝道，并入 implement', 'editable', DEFAULT_STATION_MODELS.stations['diagnosing-bugs']],
      ['wayfinder', '/wayfinder · 匝道，并入 to-spec', 'editable', DEFAULT_STATION_MODELS.stations.wayfinder],
      ['improve-codebase-architecture', '/improve-codebase-architecture · 匝道，并入 grill', 'editable', DEFAULT_STATION_MODELS.stations['improve-codebase-architecture']],
      ['domain-modeling', '/domain-modeling · 路基：领域建模', 'fixed', []],
      ['codebase-design', '/codebase-design · 路基：模块设计', 'fixed', []],
      ['standalone', '独立区 · 其他 skill', 'fixed', []],
    ])
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
