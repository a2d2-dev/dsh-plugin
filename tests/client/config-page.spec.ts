import { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../../src/client/index.tsx'
import { A2d2ConfigSection, loadModelRouteCatalog } from '../../src/client/config-page.tsx'

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
    result: {
      ok: true as const,
      value: {
        groups: [
          { id: 'codex', name: 'Codex', models: [{ id: 'gpt-6', name: 'GPT-6' }] },
          { id: 'claude-bray', name: 'Claude Bray', models: [{ id: 'claude-fable-5-1', name: 'Fable 5.1' }] },
        ],
        failures: [],
      },
    },
  }))
  ctx.provide('connection', {
    api: { llm: { models } },
  } as never)
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
    expect(inject).toEqual(['slots', 'sessions'])
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
    expect(b.models).toHaveBeenCalledWith({})
  })

  it('turns the DSH host model catalog into provider/model routes', async () => {
    await expect(loadModelRouteCatalog({
      llm: {
        models: async () => ({
          result: {
            ok: true as const,
            value: {
              groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'model-a', name: 'A' }, { id: 'model-b', name: 'B' }] }],
              failures: [{ id: 'broken', name: 'Broken', message: 'down' }],
            },
          },
        }),
      },
    })).resolves.toEqual(['provider/model-a', 'provider/model-b'])
  })
})
