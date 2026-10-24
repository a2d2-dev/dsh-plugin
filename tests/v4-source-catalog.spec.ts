import { expect, it } from 'vitest'
import { readSourceCatalog } from '../src/work-sources/catalog.ts'
import { filterProjectItems } from '../src/work-sources/views.ts'
import type { GitHubProjectItem, GitHubIssue } from '../src/work-sources/types.ts'

it('reads every repository PR page with repository identity, merge/draft facts and Issue/check/review evidence', async () => {
  const queries: string[] = []
  const catalog = await readSourceCatalog({ repository: { owner: 'acme', repository: 'app' } }, async (query, variables) => {
    queries.push(query)
    return { data: { viewer: {id:'U',login:'viewer',name:null}, repository: { issues: { totalCount: 123 }, pullRequests: { totalCount: 2, pageInfo: { hasNextPage: !variables.cursor, endCursor: variables.cursor ? null : 'next' }, nodes: [{ id: variables.cursor ? 'P2' : 'P1', number: variables.cursor ? 2 : 1, title: 'Change', url: `https://github.com/acme/app/pull/${variables.cursor ? 2 : 1}`, state: variables.cursor ? 'MERGED' : 'OPEN', isDraft: !variables.cursor, updatedAt: '2026-10-21T00:00:00Z', repository: { name: 'app', owner: { login: 'acme' } }, closingIssuesReferences: { nodes: [{ number: 5, url: 'https://github.com/acme/app/issues/5', title: 'Fix' }], pageInfo: { hasNextPage: false } }, reviewDecision: 'APPROVED', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } }] } } } }
  })
  expect(queries).toHaveLength(2)
  expect(catalog).toMatchObject({ openIssueCount: 123, pullRequestsComplete: true, pullRequests: [{ repository: { owner: 'acme', repository: 'app' }, state: 'open', draft: true, checks: 'SUCCESS', review: 'APPROVED' }, { state: 'merged', draft: false }] })
})
it('paginates Project views and merges real PR membership with partial Issue cross references', async () => {
  const terminal = { hasNextPage: false, endCursor: null }, requests: string[] = []
  const pull = { __typename: 'PullRequest', id: 'P', number: 3, title: 'Change', url: 'https://github.com/acme/app/pull/3', state: 'MERGED', isDraft: false, updatedAt: '2026-10-21T00:00:00Z', repository: { name: 'app', owner: { login: 'acme' } }, closingIssuesReferences: { nodes: [], pageInfo: { hasNextPage: false } }, reviewDecision: null, commits: { nodes: [] } }
  const result = await readSourceCatalog({ githubProject: { owner: 'acme', type: 'user', number: 1 } }, async (query, variables) => {
    requests.push(query)
    const project = query.includes('views(first:') ? { views: { pageInfo: variables.cursor ? terminal : { hasNextPage: true, endCursor: 'view-next' }, nodes: [{ id: variables.cursor ? 'v2' : 'v1', number: variables.cursor ? 2 : 1, name: 'Real view', filter: 'assignee:@me is:open', layout: 'TABLE_LAYOUT' }] } }
      : query.includes('fields(first:') ? { fields: { pageInfo: terminal, nodes: [{ id: 'status', name: 'Status', dataType: 'SINGLE_SELECT' }] } }
      : { items: { pageInfo: terminal, nodes: [{ isArchived: false, content: pull }, { isArchived: false, content: { __typename: 'Issue', number: 5, title: 'Native Issue', url: 'https://github.com/acme/app/issues/5', timelineItems: { pageInfo: { hasPreviousPage: true }, nodes: [{ source: pull }] } } }] } }
    return { data: { viewer: { id: 'U', login: 'viewer', name: null }, user: { projectV2: project } } }
  })
  expect(requests).toHaveLength(4)
  expect(result).toMatchObject({ views: [{ number: 1 }, { number: 2 }], viewsComplete: true, pullRequestsComplete: false, pullRequests: [{ nodeId: 'P', state: 'merged', membership: 'project', issues: [{ number: 5, url: 'https://github.com/acme/app/issues/5' }] }], limitations: [expect.stringContaining('部分历史引用')] })
})
it('applies actual view filters before pagination and refuses unsupported syntax rather than showing all items', () => {
  const issue = { nodeId: 'I1', labels: ['ready'], assignees: ['viewer'], state: 'open', repository: { owner: 'acme', repository: 'app' } } as GitHubIssue
  const item: GitHubProjectItem = { id: 'item', kind: 'issue', archived: false, issueNodeId: 'I1', fields: [{ id: 'status', name: 'Status', type: 'single-select', value: 'In Progress' }], fieldsPartial: false }
  expect(filterProjectItems('is:issue is:open assignee:@me status:"In Progress" label:ready', [item], [issue], 'viewer')).toMatchObject({ supported: true, items: [item] })
  expect(filterProjectItems('status:Done or label:ready', [item], [issue], 'viewer')).toMatchObject({ supported: true, items: [item] })
  expect(filterProjectItems('-label:done', [{ ...item, kind: 'restricted', issueNodeId: undefined, fields: [] }], [], 'viewer')).toMatchObject({ supported: true, items: [] })
  expect(filterProjectItems('no:status', [{ ...item, fieldsPartial: true, fields: [] }], [issue], 'viewer', ['Status'])).toMatchObject({ supported: false, reason: expect.any(String) })
  expect(filterProjectItems('(status:Done OR label:ready)', [item], [issue], 'viewer')).toMatchObject({ supported: false, reason: expect.any(String) })
})
