import { expect, it } from 'vitest'
import { WorkPanelController } from '../src/client/work-panel-controller.ts'
import type { WorkClient } from '../src/client/work-api.ts'
import type { SourceCatalog, WorkSource } from '../src/work-sources/types.ts'
const catalog: SourceCatalog = { observedAt: '2026-10-21T00:00:00Z', openIssueCount: 31, pullRequests: [], pullRequestsComplete: true, views: [], fields: [], viewsComplete: true, limitations: [] }
const source = (id: string): WorkSource => ({ id, projectId: 'p', provider: 'github', repository: { owner: 'acme', repository: id }, enabled: true, version: 1, sequence: 0, requests: {}, pages: [], observations: [] })
it('does not let an old source switch start a later directory read that clears a new Issue', async () => {
  let delay = false, release!: (value: unknown) => void
  const identity = { login: 'me', nodeId: 'U', name: null }
  const issue = { nodeId: 'new-issue', number: 7, url: 'https://github.com/acme/new/issues/7', title: 'New Issue', body: '', repository: { owner: 'acme', repository: 'new' }, state: 'open' as const, labels: [], assignees: [], updatedAt: catalog.observedAt, observedAt: catalog.observedAt }
  const client: WorkClient = { command: async () => { throw Error('Unexpected command') }, query: async query => {
    if (query.type === 'project.detail') return { status: 'completed', project: { id: 'p' } as never, tasks: [] }
    if (query.type === 'source.list') return { status: 'completed', sources: [source('old'), source('new')] }
    if (query.type === 'source.issues') {
      if (delay && query.sourceId === 'old') return await new Promise<unknown>(resolve => { release = resolve }) as never
      return { status: 'completed', source: source(query.sourceId), page: { identity, items: [], observedAt: catalog.observedAt } }
    }
    if (query.type === 'source.catalog') return { status: 'completed', source: { ...source(query.sourceId), catalog }, catalog }
    if (query.type === 'source.issue') return { status: 'completed', source: source('new'), issue }
    throw Error('Unexpected query')
  } }
  const controller = new WorkPanelController(client, { selectPanel: () => {}, openSession: () => {} })
  await controller.selectProject('p'); delay = true
  const old = controller.selectSource('old')
  await controller.selectSource('new'); await controller.openIssue(7)
  release({ status: 'completed', source: source('old'), page: { identity, items: [], observedAt: catalog.observedAt } })
  await old
  expect(controller.getSnapshot().source).toMatchObject({ sourceId: 'new', issue: { nodeId: 'new-issue' } })
})
it('switches Repo source to overview and ignores late old catalog results while preserving the URL draft', async () => {
  let release!: (value: unknown) => void
  const client: WorkClient = { command: async () => { throw Error('Browsing must not send commands') }, query: async query => {
    if (query.type === 'project.detail') return { status: 'completed', project: { id: 'p' } as never, tasks: [] }
    if (query.type === 'source.list') return { status: 'completed', sources: [source('old'), source('new')] }
    if (query.type === 'source.issues') return { status: 'completed', source: source(query.sourceId), page: { identity: { login: 'me', nodeId: 'U', name: null }, items: [], observedAt: catalog.observedAt } }
    if (query.type === 'source.catalog') {
      if (query.sourceId === 'old' && query.refresh) return await new Promise<unknown>(resolve => { release = resolve }) as never
      return { status: 'completed', source: { ...source(query.sourceId), catalog }, catalog }
    }
    throw Error('Unexpected query')
  } }
  const controller = new WorkPanelController(client, { selectPanel: () => {}, openSession: () => {} })
  await controller.selectProject('p')
  controller.setSourceURLDraft('https://github.com/acme/unfinished')
  const pending = controller.browseDirectory(true)
  await controller.selectSource('new')
  release({ status: 'completed', source: { ...source('old'), catalog: { ...catalog, openIssueCount: 999 } }, catalog: { ...catalog, openIssueCount: 999 } })
  await pending
  expect(controller.getSnapshot().source).toMatchObject({ sourceId: 'new', tab: 'overview', catalog: { openIssueCount: 31 } })
  expect(controller.getSnapshot().connection.url).toBe('https://github.com/acme/unfinished')
})
