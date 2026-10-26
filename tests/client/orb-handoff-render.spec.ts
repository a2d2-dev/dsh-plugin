import { expect, it, vi } from 'vitest'
import { mountProductionComponent } from './production-component-harness.ts'

it('shows the TaskExecution and independent Goal boundary in the real orb confirmation before creating a session', () => {
  const command = vi.fn(), connectWorkspace = vi.fn(), openSession = vi.fn()
  const face = {
    projections: { faceOf: (key: string) => ({ getSnapshot: () => key === 'contextPressure' ? { projectedTokens: 180000, contextWindow: 256000 } : undefined, subscribe: () => () => {} }) },
    getSnapshot: () => ({ running: false }), subscribe: () => () => {}, command,
  }
  const services: Record<string, unknown> = { sessions: { binding: () => ({ session: face }) }, workspaces: {}, uiWorkspace: { connectWorkspace, openSession } }
  const view = mountProductionComponent({ ctx: { get: (key: string) => services[key] }, sessionId: 'ordinary-session' }, 'HandoffOrb', new URL('../../src/client/orb.tsx', import.meta.url), {
    window: { localStorage: { getItem: () => null } },
    document: { documentElement: { clientWidth: 1280, clientHeight: 900 }, body: {}, querySelector: () => null },
    fetch: vi.fn(() => new Promise(() => {})),
  })
  try {
    view.nodes('button').find(node => node.props['data-a2d2-orb'])!.props.onClick()
    view.nodes('button').find(node => node.props.title === '打开交接卡，填写 focus 后确认')!.props.onClick()
    expect(view.text()).toContain('交接到新会话')
    for (const term of ['TaskExecution', '独立 Goal activation', 'Issue 协调绑定', 'A²D² 接续', '人类', 'pause/resume']) expect(view.text()).toContain(term)
    expect(view.text()).toContain('不会自动取得')
    expect(view.text()).toContain('不会撤销')
    expect(view.text()).toContain('不代表持久 phase 暂停')
    expect(view.text()).toContain('不会跨会话迁移或自动 rearm')
    expect(view.nodes('button').some(node => node.props.children === '创建并交接')).toBe(true)
    expect(command).not.toHaveBeenCalled()
    expect(connectWorkspace).not.toHaveBeenCalled()
    expect(openSession).not.toHaveBeenCalled()
    view.click('取消')
    expect(view.text()).not.toContain('交接到新会话')
  } finally { view.unmount() }
})
