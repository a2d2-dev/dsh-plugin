import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkClient } from '../../src/client/work-api.ts'
import { WorkClientError } from '../../src/client/work-api.ts'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { mountProductionComponent } from './production-component-harness.ts'
import type { SourceCatalog, WorkSource, GitHubPullRequest } from '../../src/work-sources/types.ts'

const source: WorkSource = { id: 's', projectId: 'p', provider: 'github', title: 'acme/app', repository: { owner: 'acme', repository: 'app' }, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
const pr = (number: number, title: string): GitHubPullRequest => ({ nodeId: `PR${number}`, number, title, url: `https://github.com/acme/app/pull/${number}`, repository: source.repository!, state: 'open', draft: false, updatedAt: '2026-10-25T15:00:00Z', issues: [], issuesComplete: true, checks: null, review: null, membership: 'repository' })
async function setup(rows: GitHubPullRequest[], complete = true, available = true) {
  let failure = false
  const catalog: SourceCatalog = { observedAt: '2026-10-25T15:00:00Z', pullRequests: rows, pullRequestsComplete: complete, views: [], fields: [], viewsComplete: true, limitations: [] }
  const query = vi.fn<WorkClient['query']>(async query => {
    if (query.type === 'source.list') return { status: 'completed', sources: [source] }
    if (query.type === 'source.catalog') {
      if (failure) throw new WorkClientError({ status: 'failed', source, ...(available ? { catalog } : {}), error: { code: 'github-offline', message: 'Read failed' } })
      return { status: 'completed', source, ...(available ? { catalog } : {}) }
    }
    if (query.type === 'source.issues') return { status: 'completed', source, page: { identity: { nodeId: 'U1', login: 'reader', name: null }, items: [], observedAt: catalog.observedAt } }
    return { status: 'completed', tasks: [] }
  })
  const controller = new WorkPanelController({ query, command: async () => { throw Error('No writes') } }, { selectPanel() {}, openSession() {} })
  await controller.selectProject('p'); await controller.selectSourceTab('prs')
  return { controller, query, html: () => renderToStaticMarkup(createElement(WorkPanel, { controller })), fail: () => { failure = true } }
}

describe('PR workbench layout and truthful empty states', () => {
  it('replaces an empty table and duplicate messages with one empty state', async () => {
    const b = await setup([]), html = b.html()
    expect(html).toContain('当前来源暂无 PR')
    expect(html).not.toContain('PR 只读目录')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('当前搜索与列过滤没有匹配结果')
    expect(html).not.toContain('已加载全部当前查询结果')
    expect(html).toContain('aria-label="搜索 PR"')
  })
  it('keeps partial and failed observations distinct from no PRs', async () => {
    const unread = await setup([], true, false)
    expect(unread.html()).toContain('尚未读取 PR')
    expect(unread.html()).not.toContain('当前来源暂无 PR')
    const partial = await setup([], false)
    expect(partial.html()).toContain('已读取范围暂无 PR')
    expect(partial.html()).not.toContain('当前来源暂无 PR')
    const failed = await setup([]); failed.fail(); await failed.controller.browseDirectory(true)
    expect(failed.html()).toContain('暂时无法更新 PR')
    expect(failed.html()).not.toContain('当前来源暂无 PR')
  })
  it('filters from one visible local search and clears it without network calls', async () => {
    const b = await setup([pr(1, 'Fix parser'), pr(2, 'Document API')])
    expect(b.html()).toContain('>#1 Fix parser</a>')
    expect(b.html()).not.toContain('>acme/app #1 Fix parser</a>')
    expect(b.html()).not.toContain('当前范围完整观察 · 搜索与列操作')
    expect(b.html()).not.toContain('仅筛选已加载范围，不重新查询 GitHub')
    const h = mountProductionComponent({ controller: b.controller, issues: null, panel: 'none', onPanel() {} }, 'SourceDirectory', new URL('../../src/client/source-directory.tsx', import.meta.url))
    try {
      expect(h.inputs().filter(input => input.props['aria-label'] === '搜索 PR')).toHaveLength(1)
      const before = b.query.mock.calls.length
      h.change(h.inputs().find(input => input.props['aria-label'] === '搜索 PR'), 'parser')
      expect(h.text()).toContain('Fix parser'); expect(h.text()).not.toContain('Document API')
      h.change(h.inputs().find(input => input.props['aria-label'] === '搜索 PR'), 'missing')
      expect(h.text()).toContain('没有匹配的结果')
      h.click('清除筛选')
      expect(h.text()).toContain('Fix parser'); expect(h.text()).toContain('Document API')
      expect(h.inputs().find(input => input.props['aria-label'] === '搜索 PR')?.props.value).toBe('')
      expect(b.query.mock.calls).toHaveLength(before)
    } finally { h.unmount() }
  })
  it('retains the last readable PRs when refresh fails', async () => {
    const b = await setup([pr(1, 'Keep this PR')]); b.fail(); await b.controller.browseDirectory(true)
    expect(b.html()).toContain('Keep this PR')
    expect(b.html()).toContain('更新未完成，保留上次目录')
  })
})

it('shows one refresh animation and hides an old empty PR conclusion during refresh', async () => {
  const b = await setup([])
  const original = b.query.getMockImplementation()!
  let release!: () => void
  b.query.mockImplementation(async value => {
    if (value.type === 'source.catalog') await new Promise<void>(resolve => { release = resolve })
    return original(value)
  })
  const pending = b.controller.browseDirectory(true)
  const html = b.html()
  expect(html).toContain('aria-busy="true"')
  expect(html).toContain('正在读取 PR…')
  expect(html).not.toContain('当前来源暂无 PR')
  expect(html).not.toContain('正在读取来源目录…')
  expect(html.match(/class="[^"]*iconSpin[^"]*"/g)).toHaveLength(1)
  release(); await pending
  expect(b.html()).toContain('当前来源暂无 PR')
})

it('applies and clears PR filters locally through the shared query bar', async () => {
  const b = await setup([pr(1, 'Open change'), { ...pr(2, 'Closed change'), state: 'closed' }])
  const h = mountProductionComponent({ controller: b.controller, issues: null, panel: 'none', onPanel() {} }, 'SourceDirectory', new URL('../../src/client/source-directory.tsx', import.meta.url))
  try {
    const before = b.query.mock.calls.length
    h.click('筛选')
    h.change(h.nodes('select').find(node => node.props['aria-label'] === 'PR 状态'), 'closed')
    expect(h.text()).toContain('Open change')
    h.submit()
    expect(h.text()).toContain('Closed change')
    expect(h.text()).not.toContain('Open change')
    h.click('筛选1')
    h.change(h.nodes('select').find(node => node.props['aria-label'] === 'PR 类型'), 'draft')
    h.submit()
    expect(h.text()).toContain('没有匹配的 PR')
    h.click('清除筛选')
    expect(h.text()).toContain('Open change')
    expect(h.text()).toContain('Closed change')
    expect(b.query.mock.calls).toHaveLength(before)
  } finally { h.unmount() }
})
