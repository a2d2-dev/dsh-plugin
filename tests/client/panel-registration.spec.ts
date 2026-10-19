import { Context, Service } from '@deepseek-ai/cordis'
import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../../src/client/index.tsx'

interface Registration { name: string; id?: string; key?: string; label?: () => string }
class Slots extends Service {
  entries: { options: Registration; component: (props: never) => unknown }[] = []
  constructor(ctx: Context) { super(ctx, 'slots') }
  inject(_name: string, callback: () => () => void): () => void { return callback() }
  register(options: Registration, component: (props: never) => unknown): () => void {
    const entry = { options, component }; this.entries.push(entry)
    return () => { this.entries.splice(this.entries.indexOf(entry), 1) }
  }
}
async function mount() {
  const ctx = new Context()
  await ctx.plugin(Slots).await()
  for (const name of inject.filter(name => name !== 'slots')) ctx.provide(name, {} as never)
  const fiber = ctx.plugin({ inject: [...inject], apply }); await fiber.await()
  return { ctx, fiber, slots: ctx.get('slots') as unknown as Slots }
}

describe('A²D² host panel contribution', () => {
  it('adds exactly one global entry and a matching main key without replacing the host shell', async () => {
    const { slots, fiber } = await mount()
    const entries = slots.entries.filter(entry => entry.options.name === 'sidebar.panellist')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ id: 'a2d2-panel' })
    expect(entries[0]?.options.label?.()).toBe('A²D² 控制面板')
    expect(isValidElement(entries[0]!.component({ size: 16, active: false } as never))).toBe(true)
    expect(slots.entries.filter(entry => entry.options.name === 'main').map(entry => entry.options.key)).toEqual(['a2d2-panel'])
    expect(slots.entries.filter(entry => ['root', 'sidebar', 'main.conversation'].includes(entry.options.name))).toEqual([])
    await fiber.dispose()
    expect(slots.entries).toEqual([])
  })

  it('provides a session-scoped lightweight return entry', async () => {
    const { slots } = await mount()
    expect(slots.entries.filter(entry => entry.options.name === 'conversation.session.header.actions')).toHaveLength(1)
  })
})
