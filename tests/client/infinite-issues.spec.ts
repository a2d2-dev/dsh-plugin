import { describe, expect, it } from 'vitest'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { WorkClientError, type WorkClient } from '../../src/client/work-api.ts'
import type { GitHubIssue, WorkSource } from '../../src/work-sources/types.ts'
import type { WorkCompleted, WorkQuery } from '../../src/work-types.ts'

const identity = { login: 'reader', nodeId: 'U1', name: null }
const issue = (n: number): GitHubIssue => ({ nodeId: `I${n}`, number: n, title: `Issue ${n}`, body: '', url: `https://github.com/o/r/issues/${n}`, repository: { owner: 'o', repository: 'r' }, state: 'open', assignees: [], labels: [], updatedAt: '2026-10-24T00:00:00Z', observedAt: '2026-10-24T00:00:00Z' })
const source: WorkSource = { id: 's', projectId: 'p', provider: 'github', repository: { owner: 'o', repository: 'r' }, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
const page = (start: number, count: number, nextPage?: number): WorkCompleted => ({ status: 'completed', source, page: { identity, items: Array.from({ length: count }, (_, n) => issue(start + n)), observedAt: issue(1).observedAt, ...(nextPage ? { nextPage } : {}) } })
async function setup() {
  const queries: WorkQuery[] = []
  const client: WorkClient = {
    command: async () => { throw Error('read-only list must not write') },
    query: async q => {
      queries.push(q)
      if (q.type === 'project.detail') return { status: 'completed', tasks: [] }
      if (q.type === 'source.list') return { status: 'completed', sources: [source] }
      if (q.type === 'source.issues') return page(1, 100, 2)
      return { status: 'completed' }
    },
  }
  const panel = new WorkPanelController(client, { selectPanel() {}, openSession() {} })
  await panel.selectProject('p')
  return { panel, client, queries }
}

describe('continuous Issue list', () => {
  it('requests 100 initially, serializes append, deduplicates identities and retains membership during passive observation', async () => {
    const { panel, client, queries } = await setup()
    expect(queries.find(q => q.type === 'source.issues')).toMatchObject({ page: 1, perPage: 100 })
    let release!: (v: WorkCompleted) => void
    const old = client.query
    let appends = 0
    client.query = async q => {
      if (q.type === 'source.issues' && q.page === 2 && q.refresh) { appends++; return new Promise(resolve => { release = resolve }) }
      if (q.type === 'source.issues' && q.page === 2) return page(100,100,3)
      return old(q)
    }
    const pending = panel.moreIssues()
    await panel.moreIssues()
    expect(appends).toBe(1)
    expect(panel.getSnapshot().source.listing?.items).toHaveLength(100)
    expect(panel.getSnapshot().source.loadingMore).toBe(true)
    release(page(100, 100, 3))
    await pending
    expect(panel.getSnapshot().source.listing?.items).toHaveLength(199)
    expect(panel.getSnapshot().source.listing?.nextPage).toBe(3)
    await panel.observeCurrent()
    expect(panel.getSnapshot().source.listing?.items).toHaveLength(199)
    expect(panel.getSnapshot().source.listing?.nextPage).toBe(3)
  })
  it('updates tail continuation metadata during passive cache observation', async () => {
    const { panel, client } = await setup()
    const old=client.query
    client.query=async q=>q.type==='source.issues'?page(1,100):old(q)
    await panel.browseIssues({},true)
    expect(panel.getSnapshot().source.listing?.nextPage).toBeUndefined()
    client.query=async q=>q.type==='source.issues'?page(1,100,2):old(q)
    await panel.observeCurrent()
    expect(panel.getSnapshot().source.listing?.nextPage).toBe(2)
  })
  it('retains rows and failed cursor for retry, including structured cached failure pages', async () => {
    const { panel, client } = await setup()
    const requested: number[] = []
    client.query = async q => {
      if (q.type !== 'source.issues') return { status: 'completed' }
      requested.push(q.page)
      if (requested.length === 1) throw new WorkClientError({ status: 'failed', error: { code: 'github-offline', message: 'offline' }, ...{ page: page(101, 2).page } })
      return page(101, 17)
    }
    await panel.moreIssues()
    expect(panel.getSnapshot().source).toMatchObject({ loadingMore: false, moreError: 'github-offline: offline', listing: { nextPage: 2 } })
    expect(panel.getSnapshot().source.listing?.items).toHaveLength(100)
    await panel.moreIssues()
    expect(requested).toEqual([2, 2])
    expect(panel.getSnapshot().source.moreError).toBeNull()
    expect(panel.getSnapshot().source.listing?.items).toHaveLength(117)
    expect(panel.getSnapshot().source.listing?.nextPage).toBeUndefined()
  })
  it.each(['success', 'error'] as const)('ignores stale append %s after a new source query', async outcome => {
    const { panel, client } = await setup()
    let finish!: () => void
    client.query = async q => {
      if (q.type === 'source.issues' && q.page === 2) {
        await new Promise<void>(resolve => { finish = resolve })
        if (outcome === 'error') throw Error('old request failed')
        return page(101, 100)
      }
      return page(900, 1)
    }
    const pending = panel.moreIssues()
    await panel.browseIssues({ search: 'different' }, true)
    finish(); await pending
    expect(panel.getSnapshot().source).toMatchObject({ page: 1, search: 'different', loadingMore: false, moreError: null, listing: { items: [{ number: 900 }] } })
  })
  it('reads subsequent Project batches from the held snapshot without rescanning it', async () => {
    const { panel, client } = await setup()
    const projectSource: WorkSource = { ...source, repository: undefined, githubProject: { owner: 'o', type: 'org', number: 1 } }
    const calls: WorkQuery[] = []
    client.query = async q => {
      calls.push(q)
      if (q.type === 'source.list') return { status: 'completed', sources: [projectSource] }
      if (q.type === 'source.issues') return { ...page(q.page === 1 ? 1 : 101, 100, q.page === 1 ? 2 : undefined), source: projectSource }
      return { status: 'completed' }
    }
    await panel.showSources()
    await panel.moreIssues()
    expect(calls.find(q => q.type === 'source.issues' && q.page === 2)).toMatchObject({ refresh: false, perPage: 100 })
    expect(panel.getSnapshot().source.listing?.items).toHaveLength(200)
    expect(panel.getSnapshot().source.listing?.nextPage).toBeUndefined()
  })
  it('can traverse an empty raw page that still has Issue continuation and rejects nonadvancing cursors', async () => {
    const { panel, client } = await setup()
    client.query = async q => q.type === 'source.issues' && q.page === 2 ? page(101, 0, 3) : page(101, 1)
    await panel.moreIssues()
    expect(panel.getSnapshot().source.listing?.items).toHaveLength(100)
    await panel.moreIssues()
    expect(panel.getSnapshot().source.listing?.items).toHaveLength(101)
    expect(panel.getSnapshot().source.listing?.nextPage).toBeUndefined()
    await panel.browseIssues({}, true)
    client.query = async () => page(1, 1, 2)
    await panel.browseIssues({}, true)
    await panel.moreIssues()
    expect(panel.getSnapshot().source.moreError).toContain('未向前推进')
  })
})
