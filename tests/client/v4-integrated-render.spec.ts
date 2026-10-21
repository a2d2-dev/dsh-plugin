/// <reference types="node" />
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import panelStyles from '../../src/client/work-panel.module.css'
import executionStyles from '../../src/client/execution-components.module.css'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { WorkCompleted } from '../../src/work-types.ts'

it('wires authoritative execution, continuation and completion into one Issue workbench', async () => {
  const ref = { projectId: 'p', taskId: 't' }, session = { runtimeId: 'r', sessionId: 'current' }
  const detail: WorkCompleted = { status: 'completed', task: { id: 't', projectId: 'p', title: 'One issue title', goal: 'goal', version: 1, agentId: 'a', specification: { version: 1, text: 'scope', acceptance: [] }, specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [], completion: { operationId: 'op', commandId: 'done', specificationVersion: 1, executionId: 'e', owner: 'owner', epoch: 3, completedAt: '2026-01-01T00:00:00Z', closeout: { status: 'pending' } } }, executionGraph: { ref, executionId: 'e', owner: { id: 'owner', epoch: 3, agentId: 'a' }, currentSession: session, childTasks: [], nativeIssues: [{ issue: { nodeId: 'native', number: 99, title: '独立子工作要求', repository: { owner: 'acme', repository: 'repo' }, url: 'https://github.com/acme/repo/issues/99', state: 'open' }, status: 'unread' }], sessions: [{ session, role: 'current', status: 'idle', children: [], jobs: [{ id: 'job-1', owner: session, kind: 'check', label: '合同检查', status: 'completed', delivery: 'delivered', result: 'unknown', acceptance: 'unassessed', persistence: 'session-journal', registryEpoch: 'registry', instanceId: 'instance' }] }], events: [], history: [], settlement: 'unknown', blockers: [], limitations: ['观察未知', 'source-hierarchy-frozen: 主任务 → 独立子工作要求；已验收 Task 的业务结构保持冻结。原生来源关系已保留，本次未修改两端业务关系。'] } }
  const controller = new WorkPanelController({ command: async () => { throw Error('Unexpected write') }, query: async q => q.type === 'task.detail' ? detail : { status: 'completed', sources: [] } }, { selectPanel: () => {}, openSession: () => {} })
  await controller.openTask(ref)
  let html = renderToStaticMarkup(createElement(WorkPanel, { controller }))
  expect(html).toContain('本地已验收')
  expect(html).toContain('执行收口待处理')
  expect(html).not.toContain('未开始')
  expect(html.match(/<h1/g)).toHaveLength(1)
  expect(html).toContain('会话与执行')
  const pages = [{ name: 'overview', html }]
  controller.setDetailTab('sessions')
  html = renderToStaticMarkup(createElement(WorkPanel, { controller }))
  expect(html).toContain('协调负责人：owner')
  expect(html).toContain('source-hierarchy-frozen')
  expect(html).toContain('原生来源关系已保留')
  pages.push({ name: 'execution', html })
  controller.setDetailTab('continuation')
  html = renderToStaticMarkup(createElement(WorkPanel, { controller }))
  expect(html).toContain('提前接续目标')
  expect(html).toContain('相关执行结算未知')
  pages.push({ name: 'continuation', html })
  if (process.env.A2D2_INTEGRATED_ARTIFACTS === '1') {
    const directory = resolve('.local/v4-integrated')
    await mkdir(directory, { recursive: true })
    const styles = await Promise.all([
      ['../../src/client/work-panel.module.css', panelStyles],
      ['../../src/client/execution-components.module.css', executionStyles],
    ].map(async ([path, mapping]) => {
      let css = await readFile(new URL(path as string, import.meta.url), 'utf8')
      const names = new Set([...css.matchAll(/\.([a-z][\w-]*)/g)].map(match => match[1]!))
      for (const name of names) css = css.replace(new RegExp(`\\.${name}\\b`, 'g'), `.${(mapping as Record<string, string>)[name]}`)
      return css
    }))
    await Promise.all(pages.map(({name, html}) => writeFile(resolve(directory, `${name}.html`), `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>#141 v4 组件夹具</title><style>body{margin:0;color:#282d36;background:#fff;font:13px system-ui}aside{margin:12px;padding:10px;border:1px solid #d9d6ea;background:#f6f4fc}main{height:auto!important}${styles.join('\n')}</style><aside>#141 组件合同夹具 · 合成测试数据 · 非运行实例／未部署。实际产品组件与样式；仅验证布局。<nav>${pages.map(page=>`<a href="${page.name}.html">${page.name}</a>`).join(' · ')}</nav></aside>${html}</html>`)))
  }
})
