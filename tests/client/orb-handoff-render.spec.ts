import { expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import styles from '../../src/client/orb.module.css'
import { mountProductionComponent } from './production-component-harness.ts'

it.each([1280, 390])('shows the TaskExecution and independent Goal boundary in the real orb confirmation at %spx before creating a session', async width => {
  const command = vi.fn(), connectWorkspace = vi.fn(), openSession = vi.fn()
  const face = {
    projections: { faceOf: (key: string) => ({ getSnapshot: () => key === 'contextPressure' ? { projectedTokens: 180000, contextWindow: 256000 } : undefined, subscribe: () => () => {} }) },
    getSnapshot: () => ({ running: false }), subscribe: () => () => {}, command,
  }
  const services: Record<string, unknown> = { sessions: { binding: () => ({ session: face }) }, workspaces: {}, uiWorkspace: { connectWorkspace, openSession } }
  const view = mountProductionComponent({ ctx: { get: (key: string) => services[key] }, sessionId: 'ordinary-session' }, 'HandoffOrb', new URL('../../src/client/orb.tsx', import.meta.url), {
    cssModules: { './orb.module.css': styles },
    window: { localStorage: { getItem: () => null } },
    document: { documentElement: { clientWidth: width, clientHeight: 900 }, body: {}, querySelector: () => null },
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
    if (process.env.A2D2_LIFECYCLE_ARTIFACTS === '1') {
      const directory = resolve('docs/artifacts/issue-270-2026-10-26')
      await mkdir(directory, { recursive: true })
      let css = await readFile(new URL('../../src/client/orb.module.css', import.meta.url), 'utf8')
      for (const name of new Set([...css.matchAll(/\.([a-z][\w-]*)/g)].map(match => match[1]!))) css = css.replace(new RegExp(`\\.${name}\\b`, 'g'), `.${styles[name as keyof typeof styles]}`)
      await writeFile(resolve(directory, `orb-confirmation-${width}.html`), `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>#275 确认卡合同渲染</title><style>body{margin:0;background:Canvas;color:CanvasText;font:14px system-ui;color-scheme:light dark}header{padding:24px;max-width:640px}${css}</style><header><h1>#275 确认卡合同渲染</h1><p>合成合同夹具，使用真实生产卡片与样式。3080 实例未更新；本页不证明部署或 Task 接任。</p></header>${renderToStaticMarkup(view.render())}</html>`)
    }
    view.click('取消')
    expect(view.text()).not.toContain('交接到新会话')
  } finally { view.unmount() }
})
