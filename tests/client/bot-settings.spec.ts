import { describe, expect, it, vi } from 'vitest'
import { mountProductionComponent } from './production-component-harness.ts'

describe('A2D2 Bot settings section', () => {
  it('enables delegation, saves the default Bot, and shows the saved state', async () => {
    let settings = { enabled: false, defaultBot: '' }
    let revision = 1
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? '{}')) as {
        method: string
        payload?: { settings?: typeof settings; expectedRevision?: number }
      }
      if (request.method === 'settings.get') {
        return new Response(JSON.stringify({ ok: true, value: { settings, revision, missingTools: [] } }))
      }
      if (request.method === 'settings.update' && request.payload?.settings) {
        settings = request.payload.settings
        revision++
        return new Response(JSON.stringify({ ok: true, value: { settings, revision, missingTools: [] } }))
      }
      throw new Error('unexpected Bot settings request')
    }) as unknown as typeof globalThis.fetch

    const component = mountProductionComponent(
      { fetch },
      'BotSettingsSection',
      new URL('../../src/client/bot-settings.tsx', import.meta.url),
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(component.text()).toContain('Grok Bot 工具已挂载')

    const enabled = component.inputs().find(input => input.props.type === 'checkbox')
    const defaultBot = component.inputs().find(input => input.props.type === 'text')
    expect(enabled).toBeDefined()
    expect(defaultBot).toBeDefined()
    expect(enabled.props['aria-label']).toBe('启用任务主会话的 Bot 委派')
    enabled.props.onChange({ currentTarget: { checked: true } })
    defaultBot.props.onChange({ currentTarget: { value: 'research-bot' } })
    expect(component.text()).toContain('保存')

    await component.nodes('button')[0]!.props.onClick()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settings).toEqual({ enabled: true, defaultBot: 'research-bot' })
    expect(component.text()).toContain('状态：已保存')
    expect(component.text()).not.toContain('>保存</button>')
  })
})
