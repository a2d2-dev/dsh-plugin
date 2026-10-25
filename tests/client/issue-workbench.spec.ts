import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorkClient } from '../../src/client/work-api.ts'
import { WorkClientError } from '../../src/client/work-api.ts'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { mountProductionComponent } from './production-component-harness.ts'
import type { GitHubIssue, WorkSource } from '../../src/work-sources/types.ts'
import type { WorkQuery } from '../../src/work-types.ts'

const identity = { nodeId: 'U1', login: 'reader', name: null }
const source: WorkSource = { id: 's', projectId: 'p', provider: 'github', repository: { owner: 'acme', repository: 'app' }, title: 'acme/app', enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
const issue: GitHubIssue = { nodeId: 'I1', number: 1, title: 'Preserve a real work item', url: 'https://github.com/acme/app/issues/1', repository: source.repository!, body: 'Full source content', assignees: ['reader'], labels: ['ready'], state: 'open', updatedAt: '2026-10-25T15:00:00Z', observedAt: '2026-10-25T15:00:00Z' }
async function setup(initial: 'rows' | 'empty' | 'unread' | 'failed') {
  let mode = initial
  const requests: WorkQuery[] = []
  const client: WorkClient = {
    command: async () => { throw Error('Browsing must not write') },
    query: async query => {
      requests.push(query)
      if (query.type === 'source.issues') {
        if (mode === 'failed' || mode === 'unread') throw new WorkClientError({ status: 'failed', error: { code: mode === 'failed' ? 'github-offline' : 'source-page-unobserved', message: 'No current result' } })
        return { status: 'completed', source, page: { identity, items: mode === 'rows' ? [issue] : [], observedAt: issue.observedAt } }
      }
      if (query.type === 'source.list') return { status: 'completed', sources: [source] }
      if (query.type === 'project.detail') return { status: 'completed', project: { id: 'p', name: 'App', version: 1, defaultAgentId: 'a', resources: [] }, tasks: [] }
      return { status: 'completed', projects: [] }
    },
  }
  const controller = new WorkPanelController(client, { selectPanel() {}, openSession() {} })
  await controller.selectProject('p')
  await controller.selectSourceTab('issues')
  return { controller, requests, mode: (next: typeof mode) => { mode = next }, html: () => renderToStaticMarkup(createElement(WorkPanel, { controller })) }
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('Issue workbench hierarchy and states', () => {
  it('keeps one primary query and opens local options from a named icon instead of an accordion', async () => {
    const h = await setup('rows'), html = h.html()
    expect(html).toContain('placeholder="搜索 Issue"')
    expect(html).not.toContain('应用搜索与标签')
    expect(html).not.toContain('刷新 Issues</button>')
    expect(html).not.toContain('必须包含的标签')
    expect(html).toContain('aria-label="列表选项"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('<summary>列表选项')
    expect(html).not.toContain('搜索已加载 Issues')
    expect(html).not.toContain('<summary>来源状态与读取范围')
    expect(html).toContain('Issue 列操作')
    expect(html).toContain('会话 列操作')
    expect(html).toContain(issue.title)
    expect(html).not.toMatch(/<strong[^>]*>A²D² 控制面板<\/strong>/)
  })
  it('applies source query, ownership, remote state and processing filters together on submit', async () => {
    const b = await setup('rows')
    const h = mountProductionComponent({ controller: b.controller }, 'IssueSourcePanel')
    try {
      const toggle = h.nodes('button').find(button => button.props['aria-controls'] === 'a2d2-issue-filters')!
      expect(toggle.props['aria-expanded']).toBe(false)
      toggle.props.onClick()
      h.change(h.inputs().find(input => input.props['aria-label'] === '搜索来源 Issues'), ' #42 ')
      h.change(h.inputs().find(input => input.props['aria-label'] === 'Issue 标签'), 'ready, bug')
      h.change(h.nodes('select').find(select => select.props['aria-label'] === 'Issue 负责人'), '*')
      h.change(h.nodes('select').find(select => select.props['aria-label'] === 'Issue 远端状态'), 'all')
      h.change(h.nodes('select').find(select => select.props['aria-label'] === 'Issue 处理状态'), 'waiting')
      const prior = b.requests.length
      h.submit(); await settle()
      expect(b.requests.slice(prior)).toContainEqual(expect.objectContaining({ type: 'source.issues', search: '#42', assignee: '*', state: 'all', labels: ['ready', 'bug'], refresh: true }))
      expect(b.controller.getSnapshot().issueFilter).toBe('waiting')
      expect(h.nodes('button').find(button => button.props['aria-controls'] === 'a2d2-issue-filters')?.props['aria-expanded']).toBe(false)
    } finally { h.unmount() }
  })
  it('explains a filtered zero result and provides a working reset to all open Issues', async () => {
    const b = await setup('empty'), html = b.html()
    expect(html).toContain('没有符合当前条件的 Issue')
    expect(html).toContain('分配给我')
    expect(html).toContain('开放 Issue')
    expect(html).not.toContain('<table')
    const h = mountProductionComponent({ controller: b.controller }, 'IssueSourcePanel')
    try {
      b.mode('rows')
      h.click('开放 Issue'); await settle()
      expect(b.requests.at(-1)).toMatchObject({ type: 'source.issues', assignee: '*', state: 'open', refresh: true })
      expect(h.text()).toContain(issue.title)
    } finally { h.unmount() }
  })
  it('distinguishes an unobserved cache from a failed read and never calls either an empty repository', async () => {
    const unread = await setup('unread'), failed = await setup('failed')
    expect(unread.html()).toContain('尚未读取 Issue')
    expect(unread.html()).toContain('读取 Issue</button>')
    expect(failed.html()).toContain('暂时无法读取 Issue')
    expect(failed.html()).toContain('重试')
    for (const html of [unread.html(), failed.html()]) {
      expect(html).not.toContain('此来源还没有 Issue')
      expect(html).not.toContain('<table')
    }
  })
  it('preserves previously read rows when a refresh fails', async () => {
    const b = await setup('rows'); b.mode('failed')
    await b.controller.browseIssues({}, true)
    expect(b.html()).toContain(issue.title)
    expect(b.html()).toContain('更新未完成，保留上次列表')
    expect(b.html()).not.toContain('此来源还没有 Issue')
  })
})

it('does not offer the same reset again when all owners already have no open Issues', async () => {
  const b = await setup('empty')
  await b.controller.browseIssues({ assignee: '*' }, true)
  expect(b.html()).toContain('此来源暂无开放 Issue')
  expect(b.html()).toContain('全部状态')
  expect(b.html()).not.toContain('开放 Issue</button>')
})
