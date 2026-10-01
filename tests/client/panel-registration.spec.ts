import { Context, Service } from '@deepseek-ai/cordis'
import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../../src/client/index.tsx'

class StubSlots extends Service {
  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  inject(): () => void {
    return () => {}
  }

  register(): () => void {
    return () => {}
  }
}

interface RegisteredTab {
  readonly id: string
  readonly title: string
  readonly order?: number
  readonly single?: boolean
  readonly icon?: unknown
  readonly component: unknown
}

class StubSidebar extends Service {
  readonly tabs: RegisteredTab[] = []

  constructor(ctx: Context) {
    super(ctx, 'betterSidebar')
  }

  registerTab(tab: RegisteredTab): () => void {
    this.tabs.push(tab)
    return () => {
      const index = this.tabs.indexOf(tab)
      if (index >= 0) this.tabs.splice(index, 1)
    }
  }
}

async function mount(withSidebar: boolean): Promise<{ ctx: Context; sidebar?: StubSidebar }> {
  const ctx = new Context()
  await ctx.plugin(StubSlots).await()
  ctx.provide('sessions', {} as never)
  ctx.provide('remote', { session: {} } as never)
  ctx.provide('remote.session', {} as never)
  if (withSidebar) await ctx.plugin(StubSidebar).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  await Promise.resolve()
  return { ctx, sidebar: ctx.get('betterSidebar') as unknown as StubSidebar | undefined }
}

describe('A²D² panel tab registration', () => {
  it('registers the A²D² panel tab with the replacement id and title', async () => {
    const { sidebar } = await mount(true)

    expect(sidebar?.tabs).toHaveLength(1)
    expect(sidebar?.tabs[0]).toMatchObject({
      id: 'a2d2-panel',
      title: 'A²D²',
      order: 40,
      single: true,
    })
  })

  it('registers a renderable icon for the A²D² panel tab', async () => {
    const { sidebar } = await mount(true)

    const icon = sidebar?.tabs[0]?.icon

    expect(icon).toEqual(expect.any(Function))
    expect(isValidElement((icon as (size: number) => unknown)(20))).toBe(true)
  })

  it('skips the tab when better-sidebar is absent', async () => {
    const { sidebar } = await mount(false)

    expect(sidebar).toBeUndefined()
  })

  it('registers the A²D² panel tab when better-sidebar is provided after apply', async () => {
    const { ctx } = await mount(false)

    const sidebarFiber = ctx.plugin(StubSidebar)
    await sidebarFiber.await()
    await Promise.resolve()
    const sidebar = ctx.get('betterSidebar') as unknown as StubSidebar | undefined

    expect(sidebar?.tabs).toHaveLength(1)
    expect(sidebar?.tabs[0]).toMatchObject({
      id: 'a2d2-panel',
      title: 'A²D²',
      order: 40,
      single: true,
    })
  })

  it('unregisters the A²D² panel tab when better-sidebar is withdrawn', async () => {
    const { ctx } = await mount(false)
    const sidebarFiber = ctx.plugin(StubSidebar)
    await sidebarFiber.await()
    await Promise.resolve()
    const sidebar = ctx.get('betterSidebar') as unknown as StubSidebar | undefined

    expect(sidebar?.tabs).toHaveLength(1)

    await sidebarFiber.dispose()

    expect(sidebar?.tabs).toEqual([])
  })
})
