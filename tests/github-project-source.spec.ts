import { describe, expect, it } from 'vitest'
import { GitHubSource } from '../src/work-sources/github.ts'
import { readGitHubProject } from '../src/work-sources/project.ts'
const target = { owner: 'a2d2-dev', type: 'org' as const, number: 1 }
const reference = (id = 'I_1', repository = 'one') => ({ id, number: 1, title: id, url: `https://github.com/a2d2-dev/${repository}/issues/1`, state: 'OPEN', repository: { name: repository, owner: { login: 'a2d2-dev' } } })
function issue(id = 'I_1', repository = 'one') { return { ...reference(id, repository), __typename: 'Issue', body: 'Original\n  source', updatedAt: '2026-10-20T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', closedAt: null,
  assignees: { nodes: [{ login: 'imneov' }] }, labels: { nodes: [{ name: 'ready-for-agent' }] }, parent: reference('I_parent', 'parent'),
  subIssues: { totalCount: 60, pageInfo: { hasNextPage: true }, nodes: [reference('I_child', 'child')] },
  subIssuesSummary: { total: 11, completed: 10 },
  closedByPullRequestsReferences: { nodes: [{ number: 143, title: 'feat: deliver', url: 'https://github.com/a2d2-dev/one/pull/143', state: 'MERGED', isDraft: false }] } } }
function item(content: unknown, id = 'PVTI_1') { return { id, type: 'ISSUE', isArchived: false, content, fieldValues: { pageInfo: { hasNextPage: false }, nodes: [
  { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'In progress', field: { id: 'F_status', name: 'Status' } },
  { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'P1', field: { id: 'F_priority', name: 'Priority' } },
  { __typename: 'ProjectV2ItemFieldIterationValue', title: 'Iteration 2', field: { id: 'F_iteration', name: 'Iteration' } },
  { __typename: 'ProjectV2ItemFieldUserValue' },
] } } }
function response(items: unknown[] = [item(issue())]) { return { data: { viewer: { id: 'U_1', login: 'imneov', name: 'LiuFeng' }, organization: { projectV2: { id: 'PVT_1', title: 'Actual Project', url: 'https://github.com/orgs/a2d2-dev/projects/1', closed: false, items: { totalCount: 12, nodes: items, pageInfo: { hasNextPage: true, endCursor: 'cursor-next' } } } } } } }

describe('GitHub Project source', () => {
  it('reads a fixed query with variables, authenticated identity, fields, and explicitly partial subissues', async () => {
    const source = new GitHubSource({ graphql: async (query, variables) => {
      expect(query).toContain('organization(login:$owner)')
      expect(query).not.toContain('mutation')
      expect(variables).toEqual({ owner: 'a2d2-dev', number: 1, first: 20, cursor: 'cursor-before' })
      return response([item(issue()), item(issue('I_other', 'two'), 'PVTI_2'), item(null, 'PVTI_private'), item({ __typename: 'DraftIssue', title: 'Draft' }, 'PVTI_draft'), item({ __typename: 'PullRequest', title: 'PR', url: 'https://github.com/a2d2-dev/one/pull/2' }, 'PVTI_pr')])
    } })
    const page = await source.project(target, { perPage: 20, cursor: 'cursor-before' })
    expect(page.identity).toEqual({ nodeId: 'U_1', login: 'imneov', name: 'LiuFeng' })
    expect(page.nextCursor).toBe('cursor-next')
    expect(page.total).toBe(12)
    expect(page.issues).toHaveLength(2)
    expect(page.issues[0]).toMatchObject({ nodeId: 'I_1', body: 'Original\n  source', createdAt: '2026-10-01T00:00:00Z', closedAt: null, parent: { nodeId: 'I_parent', repository: { repository: 'parent' } }, subIssues: { totalCount: 60, hasNextPage: true, items: [{ nodeId: 'I_child' }] }, subIssuesSummary: { total: 11, completed: 10 }, linkedPullRequests: [{ number: 143, state: 'merged', draft: false, url: 'https://github.com/a2d2-dev/one/pull/143' }] })
    expect(page.issues[1]).toMatchObject({ nodeId: 'I_other', number: 1, repository: { repository: 'two' } })
    expect(page.items.map(item => item.kind)).toEqual(['issue', 'issue', 'restricted', 'draft', 'pull-request'])
    expect(page.items[0]?.fields).toEqual([{ id: 'F_status', name: 'Status', type: 'single-select', value: 'In progress' }, { id: 'F_priority', name: 'Priority', type: 'single-select', value: 'P1' }, { id: 'F_iteration', name: 'Iteration', type: 'iteration', value: 'Iteration 2' }])
  })
  it('supports user Projects and completes an empty terminal page without inventing Issues', async () => {
    const page = await readGitHubProject({ owner: 'imneov', type: 'user', number: 2 }, { perPage: 1 }, async query => {
      expect(query).toContain('user(login:$owner)')
      const raw = response([])
      return { data: { viewer: raw.data.viewer, user: { projectV2: { ...raw.data.organization.projectV2, url: 'https://github.com/users/imneov/projects/2', items: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } }
    })
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeUndefined()
  })
  it.each([['RATE_LIMITED', 'github-rate-limited'], ['FORBIDDEN', 'github-forbidden'], ['NOT_FOUND', 'github-not-found'], ['INVALID_CURSOR_ARGUMENTS', 'github-cursor-invalid'], ['SOMETHING_ELSE', 'github-invalid-response']])('rejects %s even when GraphQL supplies partial data', async (type, code) => {
    await expect(readGitHubProject(target, { perPage: 20 }, async () => ({ ...response(), errors: [{ type, message: 'secret upstream text' }] }))).rejects.toMatchObject({ code })
  })
  it('refuses wrong Project identity, malformed scope, nonadvancing cursors, and incomplete nested data', async () => {
    let calls = 0
    const read = async () => { calls++; return response() }
    await expect(readGitHubProject({ ...target, owner: '../elsewhere' }, { perPage: 20 }, read)).rejects.toMatchObject({ code: 'github-invalid-scope' })
    expect(calls).toBe(0)
    await expect(readGitHubProject(target, { perPage: 20, cursor: 'cursor-next' }, read)).rejects.toMatchObject({ code: 'github-invalid-response' })
    await expect(readGitHubProject({ ...target, number: 2 }, { perPage: 20 }, read)).rejects.toMatchObject({ code: 'github-invalid-response' })
    await expect(readGitHubProject(target, { perPage: 20 }, async () => response([item({ ...issue(), parent: undefined })]))).rejects.toMatchObject({ code: 'github-invalid-response' })
    await expect(readGitHubProject(target, { perPage: 20 }, async () => response([item({ ...issue(), url: 'https://evil.test/issues/1' })]))).rejects.toMatchObject({ code: 'github-invalid-response' })
  })
})
