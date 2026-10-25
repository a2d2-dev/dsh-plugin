/// <reference types="node" />
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import panelStyles from '../../src/client/work-panel.module.css'
import delegationStyles from '../../src/client/continuous-delegation.module.css'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { WorkClientError } from '../../src/client/work-api.ts'
import type { WorkSource } from '../../src/work-sources/types.ts'

it.each(['project', 'prs'] as const)('distinguishes fresh, cached, failed and missing catalogs on %s', async tab => {
  const catalog = { observedAt: '2026-10-24T05:00:00Z', pullRequests: [], pullRequestsComplete: true, views: [{ id: 'v', number: 1, name: 'Actual view', filter: '', layout: 'TABLE_LAYOUT' }], fields: [], viewsComplete: true, limitations: [] }
  const source: WorkSource = { id: 's', projectId: 'p', provider: 'github', title: 'Actual Project', githubProject: { owner: 'acme', type: 'org', number: 1 }, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
  let failure = false, available = true
  const makeController = () => new WorkPanelController({
    command: async () => { throw Error('Browsing must not issue commands') },
    query: async query => {
      if (query.type === 'source.catalog') {
        if (failure) throw new WorkClientError({ status: 'failed', source, ...(available ? { catalog } : {}), error: { code: 'github-forbidden', message: 'GitHub Project permission denied (403)' } })
        return { status: 'completed', source, ...(available ? { catalog } : {}) }
      }
      return { status: 'completed', ...(query.type === 'projects.list' ? { projects: [{ id: 'p', name: 'Actual Project', version: 1, defaultAgentId: 'a', resources: [] }] } : query.type === 'source.list' ? { sources: [source] } : query.type === 'source.issues' ? { source, page: { identity: { login: 'viewer', nodeId: 'U', name: null }, items: [], observedAt: catalog.observedAt } } : { tasks: [] }) }
    },
  }, { selectPanel: () => {}, openSession: () => {} })
  const controller = makeController()
  const render = () => renderToStaticMarkup(createElement(WorkPanel, { controller }))
  await controller.load()
  await controller.selectSourceTab(tab)
  await controller.browseDirectory(true)
  expect(render()).toContain('data-source-freshness="fresh"')
  expect(render()).toContain('已更新')
  expect(render()).not.toContain('目录观察时间：')
  expect(render()).not.toContain('缓存读取账号：')
  expect(render()).not.toContain('来源状态 ·')
  expect(render()).toContain('dateTime="2026-10-24T05:00:00Z"')
  await controller.browseDirectory(false)
  expect(render()).toContain('data-source-freshness="cached"')
  expect(render()).toContain('dateTime="2026-10-24T05:00:00Z"')
  failure = true
  await controller.browseDirectory(true)
  expect(render()).toContain('github-forbidden')
  expect(render()).toContain('data-source-freshness="cached"')
  expect(render()).toContain('dateTime="2026-10-24T05:00:00Z"')
  available = false; failure = false
  const missing = makeController()
  await missing.load()
  await missing.selectSourceTab(tab)
  const empty = renderToStaticMarkup(createElement(WorkPanel, { controller: missing }))
  expect(empty).toContain('尚无缓存')
  expect(empty).not.toContain('缓存 / 最后已知观察 · 目录观察时间：')
})
it('renders Repo source tabs and unknown aggregate counts without presenting one Issue page as a total', async () => {
  const source: WorkSource = { id: 's', projectId: 'p', provider: 'github', title: 'acme/app', repository: { owner: 'acme', repository: 'app' }, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
  const controller = new WorkPanelController({ command: async () => { throw Error('Unexpected command') }, query: async q => ({ status: 'completed', ...(q.type === 'projects.list' ? { projects: [{ id: 'p', name: 'acme/app', version: 1, defaultAgentId: 'a', resources: [] }] } : q.type === 'source.list' ? { sources: [source] } : q.type === 'source.issues' ? { source, page: { identity: { login: 'viewer', nodeId: 'U', name: null }, items: [], observedAt: '2026-10-21T00:00:00Z', nextPage: 2 } } : { tasks: [] }) }) }, { selectPanel: () => {}, openSession: () => {} })
  await controller.load()
  const html = renderToStaticMarkup(createElement(WorkPanel, { controller }))
  expect(html).toContain('来源标签')
  expect(html).toContain('仓库')
  expect(html).toContain('开放 Issue')
  expect(html).toContain('尚未完整观察')
  expect(html).toContain('PR')
  expect(html).not.toContain('aria-label="Project 视图"')
  expect(html).toContain('来源操作')
  expect(html).toContain('aria-label="当前 GitHub 仓库或 Project"')
  expect(html).toContain('aria-label="刷新来源"')
  const statusSummary = html.match(/<summary aria-label="来源同步状态[^"']*"[^>]*>(.*?)<\/summary>/)?.[1]
  expect(statusSummary).toContain('<svg')
  expect(statusSummary).not.toContain('尚未刷新')
  expect(html).toContain('aria-label="来源同步状态：')
  expect(html).toContain('来源管理')
  expect((html.replace(/<[^>]*>/g, ' ').match(/acme\s*\/\s*app/g) ?? [])).toHaveLength(1)
  expect(html).not.toContain('需要关注 · 0')
  expect(html).not.toContain('正在处理 · 0')
  if (process.env.A2D2_INTEGRATED_ARTIFACTS === '1') {
    const directory = resolve('.local/v4-integrated')
    await mkdir(directory, { recursive: true })
    const styles = await Promise.all([
      ['../../src/client/work-panel.module.css', panelStyles],
      ['../../src/client/continuous-delegation.module.css', delegationStyles],
    ].map(async ([path, mapping]) => {
      let css = await readFile(new URL(path as string, import.meta.url), 'utf8')
      const names = new Set([...css.matchAll(/\.([a-z][\w-]*)/g)].map(match => match[1]!))
      for (const name of names) css = css.replace(new RegExp(`\\.${name}\\b`, 'g'), `.${(mapping as Record<string, string>)[name]}`)
      return css
    }))
    await writeFile(resolve(directory, 'source.html'), `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>#141 来源组件夹具</title><style>body{margin:0;color:#282d36;background:#fff;font:13px system-ui}aside{margin:12px;padding:10px;border:1px solid #d9d6ea;background:#f6f4fc}main{height:auto!important}${styles.join('\n')}</style><aside>#141 来源组件合同夹具 · 合成测试数据 · 非运行实例／未部署。仅验证布局；按钮命令未连接服务。</aside>${html}</html>`)
  }
})


it('observes the active source catalog without polling an unobserved Issue page from overview', async () => {
  const source: WorkSource = { id: 's', projectId: 'p', provider: 'github', title: 'acme/app', repository: { owner: 'acme', repository: 'app' }, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
  const catalog = { observedAt: '2026-10-24T05:00:00Z', pullRequests: [], pullRequestsComplete: true, views: [], fields: [], viewsComplete: true, limitations: [] }
  const requests: string[] = []
  const controller = new WorkPanelController({ command: async () => { throw Error('Unexpected write') }, query: async query => {
    requests.push(query.type)
    if (query.type === 'source.issues') throw new WorkClientError({ status: 'failed', error: { code: 'source-page-unobserved', message: 'This page has not been retrieved' } })
    return { status: 'completed', ...(query.type === 'projects.list' ? { projects: [{ id: 'p', name: 'acme/app', version: 1, defaultAgentId: 'a', resources: [] }] } : query.type === 'source.list' ? { sources: [source] } : query.type === 'source.catalog' ? { source, catalog } : { tasks: [] }) }
  } }, { selectPanel() {}, openSession() {} })
  await controller.load()
  await controller.selectSourceTab('overview')
  requests.length = 0
  await controller.observeCurrent()
  expect(requests).toContain('source.catalog')
  expect(requests).not.toContain('source.issues')
  expect(controller.getSnapshot().observationError).toBeNull()
  expect(controller.getSnapshot().source.catalog).toEqual(catalog)
})
