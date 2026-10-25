import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkClient } from '../../src/client/work-api.ts'
import type { WorkCompleted } from '../../src/work-types.ts'
import type { GitHubAccount, GitHubRepositoryPage } from '../../src/work-sources/types.ts'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { GitHubAccountControl } from '../../src/client/github-account.tsx'
import { mountProductionComponent } from './production-component-harness.ts'
import { SourceConnect } from '../../src/client/source-connect.tsx'

const identity = { nodeId: 'U1', login: 'one', name: null }
const repo = { nodeId: 'R1', owner: 'one', name: 'project', url: 'https://github.com/one/project', description: 'Example repository', private: false, archived: false }
function setup() {
  let account: GitHubAccount = { status: 'connected', identity, login: { state: 'idle' } }
  let readPage = async (_page: number): Promise<GitHubRepositoryPage> => ({ identity: account.identity!, items: [repo], nextPage: 2 })
  const query = vi.fn<WorkClient['query']>(async value => {
    if (value.type === 'github.account') return { status: 'completed', githubAccount: account }
    if (value.type === 'github.repositories') return { status: 'completed', githubRepositories: await readPage(value.page) }
    throw Error('Unexpected query')
  })
  const command = vi.fn<WorkClient['command']>(async () => ({ status: 'completed', githubLogin: { state: 'pending', code: 'ABCD-1234', url: 'https://github.com/login/device' } }))
  const controller = new WorkPanelController({ query, command }, { selectPanel: vi.fn(), openSession: vi.fn() })
  return { controller, query, command, account: (next: GitHubAccount) => { account = next }, pages: (next: typeof readPage) => { readPage = next } }
}

describe('GitHub account and repository selection', () => {
  it('reuses the connected account, appends pages without duplicates and does not import or log in while browsing', async () => {
    const b = setup()
    await b.controller.refreshGitHubAccount()
    await b.controller.loadGitHubRepositories()
    b.pages(async () => ({ identity, items: [repo, { ...repo, nodeId: 'R2', name: 'second', url: 'https://github.com/one/second' }] }))
    await b.controller.loadGitHubRepositories()
    expect(b.controller.getSnapshot().github.items.map(item => item.nodeId)).toEqual(['R1', 'R2'])
    expect(b.controller.getSnapshot().github.nextPage).toBeNull()
    expect(b.command).not.toHaveBeenCalled()
    expect(b.query).toHaveBeenCalledWith({ type: 'github.repositories', page: 2 })
    const account = renderToStaticMarkup(createElement(GitHubAccountControl, { controller: b.controller, onManageSources: vi.fn() }))
    expect(account).toContain('@one')
    const trigger = account.match(/<summary[^>]*>(.*?)<\/summary>/)?.[1]
    expect(trigger).toBeDefined()
    expect(trigger).not.toContain('@one')
    expect(trigger).not.toContain('<svg')
    expect(account).toContain('aria-label="GitHub 账号：one"')
    expect(account).toContain('个人主页')
    expect(account).toContain('来源管理')
    expect(account).toContain('刷新状态')
    expect(account).toContain('重新授权')
    expect(account).toContain('退出登录')
    expect(account).not.toContain('使用当前 Harness 宿主')
    expect(account).not.toContain('连接 GitHub</button>')
    const picker = renderToStaticMarkup(createElement(SourceConnect, { controller: b.controller, onSaved: vi.fn() }))
    expect(picker).toContain('one/project')
    expect(picker).toContain('搜索仓库')
    expect(picker).toContain('添加仓库')
    expect(picker).toContain('已读取 2 个仓库')
    expect(picker).not.toContain('选择当前账号可访问的仓库')
    expect(picker).not.toContain('目录已加载完成')
    expect(picker).not.toContain('@one')
    expect(picker).toContain('全部归属')
    expect(picker).toContain('通过链接')
  })
  it('drops late repository responses and source candidates when the active account changes', async () => {
    const b = setup()
    await b.controller.refreshGitHubAccount()
    let complete!: (page: GitHubRepositoryPage) => void
    b.pages(() => new Promise(resolve => { complete = resolve }))
    const pending = b.controller.loadGitHubRepositories()
    b.account({ status: 'connected', identity: { ...identity, nodeId: 'U2', login: 'two' }, login: { state: 'idle' } })
    await b.controller.refreshGitHubAccount()
    complete({ identity, items: [repo], nextPage: 2 })
    await pending
    expect(b.controller.getSnapshot().github).toMatchObject({ account: { identity: { nodeId: 'U2' } }, items: [], repositoriesLoading: false, repositoriesLoaded: false })
    expect(b.controller.getSnapshot().connection.candidate).toBeNull()
  })
  it('starts login only on an explicit command and exposes the pending authorization code', async () => {
    const b = setup()
    b.account({ status: 'disconnected', login: { state: 'idle' } })
    await b.controller.refreshGitHubAccount()
    expect(b.command).not.toHaveBeenCalled()
    await b.controller.loginGitHub('start')
    expect(b.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'github.login', action: 'start' }))
    const html = renderToStaticMarkup(createElement(GitHubAccountControl, { controller: b.controller, onManageSources: vi.fn() }))
    expect(html).toContain('ABCD-1234')
    expect(html).toContain('https://github.com/login/device')
    expect(html).toContain('取消授权')
  })
  it('does not restart a slow account request on each poll', async () => {
    let complete!: (result: WorkCompleted) => void
    const query = vi.fn<WorkClient['query']>(() => new Promise(resolve => { complete = resolve }))
    const controller = new WorkPanelController({ query, command: vi.fn() }, { selectPanel: vi.fn(), openSession: vi.fn() })
    const first = controller.refreshGitHubAccount()
    await controller.refreshGitHubAccount()
    expect(query).toHaveBeenCalledOnce()
    complete({ status: 'completed', githubAccount: { status: 'connected', identity, login: { state: 'idle' } } })
    await first
    expect(controller.getSnapshot().github.account?.identity?.nodeId).toBe('U1')
  })
})


it('clears repository selections and discovered repositories after explicit logout', async () => {
  const b = setup()
  await b.controller.refreshGitHubAccount()
  await b.controller.loadGitHubRepositories()
  b.command.mockResolvedValueOnce({ status: 'completed', githubAccount: { status: 'disconnected', login: { state: 'idle' } } })
  await b.controller.logoutGitHub()
  expect(b.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'github.logout', login: 'one', nodeId: 'U1' }))
  expect(b.controller.getSnapshot().github).toMatchObject({ account: { status: 'disconnected' }, items: [], repositoriesLoaded: false, busy: false })
})

it('switches between repository selection and link entry without an accordion', async () => {
  const b = setup()
  await b.controller.refreshGitHubAccount(); await b.controller.loadGitHubRepositories()
  const onBack = vi.fn()
  const h = mountProductionComponent({ controller: b.controller, onSaved() {}, onBack }, 'SourceConnect', new URL('../../src/client/source-connect.tsx', import.meta.url))
  try {
    expect(h.nodes('details')).toHaveLength(0)
    expect(h.inputs().some(node => node.props['aria-label'] === '搜索仓库')).toBe(true)
    h.click('通过链接')
    expect(h.inputs().some(node => node.props.type === 'url')).toBe(true)
    expect(h.inputs().some(node => node.props['aria-label'] === '搜索仓库')).toBe(false)
    h.click('选择仓库')
    expect(h.inputs().some(node => node.props.type === 'url')).toBe(false)
    h.nodes('button').find(node => node.props['aria-label'] === '返回').props.onClick()
    expect(onBack).toHaveBeenCalledOnce()
    expect(b.command).not.toHaveBeenCalled()
  } finally { h.unmount() }
})

it('continues repository pages at the list end once and stops on exhaustion', async () => {
  const b = setup()
  await b.controller.refreshGitHubAccount(); await b.controller.loadGitHubRepositories()
  b.pages(async () => ({ identity, items: [{ ...repo, nodeId: 'R2', name: 'second' }] }))
  const observers: { callback: (entries: { isIntersecting: boolean }[]) => void; root: unknown }[] = []
  class Observer {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void, options: { root: unknown }) { observers.push({ callback, root: options.root }) }
    observe() {}
    disconnect() {}
  }
  const h = mountProductionComponent({ controller: b.controller, onSaved() {} }, 'SourceConnect', new URL('../../src/client/source-connect.tsx', import.meta.url), { IntersectionObserver: Observer })
  try {
    const list = {}
    h.nodes('div').find(node => node.props['aria-busy'] !== undefined).ref.current = list
    h.nodes('div').find(node => node.props['aria-label'] === '仓库加载状态').ref.current = {}
    h.change(h.inputs()[0], 'project')
    expect(h.text()).not.toContain('加载更多')
    expect(observers.at(-1)?.root).toBe(list)
    const before = b.query.mock.calls.length, observer = observers.at(-1)!
    observer.callback([{ isIntersecting: false }])
    expect(b.query.mock.calls).toHaveLength(before)
    observer.callback([{ isIntersecting: true }]); observer.callback([{ isIntersecting: true }])
    await expect.poll(() => b.controller.getSnapshot().github.items.length).toBe(2)
    expect(b.query.mock.calls).toHaveLength(before + 1)
    expect(b.query).toHaveBeenLastCalledWith({ type: 'github.repositories', page: 2 })
    const count = observers.length
    h.render()
    expect(observers).toHaveLength(count)
  } finally { h.unmount() }
})

it('stops automatic repository loading after failure and keeps explicit retry', async () => {
  const b = setup()
  await b.controller.refreshGitHubAccount(); await b.controller.loadGitHubRepositories()
  b.pages(async () => { throw Error('Network unavailable') })
  let intersect = (_entries: { isIntersecting: boolean }[]) => {}
  class Observer {
    constructor(callback: typeof intersect) { intersect = callback }
    observe() {}
    disconnect() {}
  }
  const h = mountProductionComponent({ controller: b.controller, onSaved() {} }, 'SourceConnect', new URL('../../src/client/source-connect.tsx', import.meta.url), { IntersectionObserver: Observer })
  try {
    h.nodes('div').find(node => node.props['aria-busy'] !== undefined).ref.current = {}
    h.nodes('div').find(node => node.props['aria-label'] === '仓库加载状态').ref.current = {}
    h.change(h.inputs()[0], 'project')
    intersect([{ isIntersecting: true }])
    await expect.poll(() => b.controller.getSnapshot().github.error).toContain('Network unavailable')
    const calls = b.query.mock.calls.length
    h.render(); intersect([{ isIntersecting: true }])
    expect(b.query.mock.calls).toHaveLength(calls)
    b.pages(async () => ({ identity, items: [] }))
    h.click('重试')
    await expect.poll(() => b.controller.getSnapshot().github.nextPage).toBeNull()
    expect(b.query.mock.calls).toHaveLength(calls + 1)
  } finally { h.unmount() }
})
