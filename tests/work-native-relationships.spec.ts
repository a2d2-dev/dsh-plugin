import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { GitHubSource } from '../src/work-sources/github.ts'
import { refreshRepositoryCandidates } from '../src/work-sources/repository-candidates.ts'
import { continuousDependenciesReady } from '../src/work-continuous.ts'
import { planningBasis, validatePlan } from '../src/work-planning.ts'
import { screeningBasis } from '../src/work-screening.ts'
import { WorkApplication, WorkDao } from '../src/work.ts'
import type { WorkSnapshot } from '../src/work-schema.ts'
import type { ContinuousWorkRule, WorkResult } from '../src/work-types.ts'
import type { GitHubIssue } from '../src/work-sources/types.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (dirname(root) !== tmpdir() || !basename(root).startsWith('native-relations-') || await realpath(root) !== root) throw Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }) } })
const identity = { login: 'developer', nodeId: 'U_developer', name: null }
const repository = { owner: 'example', repository: 'repo' }
const time = '2026-10-21T00:00:00Z'
const actor = { operator: true }
const ok = (result: WorkResult) => { if (result.status !== 'completed') throw Error(JSON.stringify(result)); return result }
const reference = (number: number, state: 'open' | 'closed' = 'open') => ({ nodeId: `I_${number}`, number, title: `Work ${number}`, url: `https://github.com/example/repo/issues/${number}`, repository, state })
const issue = (number: number): GitHubIssue => ({ ...reference(number), body: 'Requirements', labels: [], assignees: ['developer'], updatedAt: time, observedAt: time, parent: null, subIssues: { items: [], totalCount: 0, hasNextPage: false }, dependencies: { availability: 'available', blockedBy: { items: [], totalCount: 0, hasNextPage: false } } })
const raw = (number: number, state = 'open') => ({ node_id: `I_${number}`, number, title: `Work ${number}`, html_url: `https://github.com/example/repo/issues/${number}`, body: 'Requirements', milestone: null, state, updated_at: time, created_at: time, assignees: [{ login: 'developer' }], labels: [], sub_issues_summary: { total: 0, completed: 0 }, issue_dependencies_summary: { total_blocked_by: 1, blocked_by: 1 } })
function rule(sourceId: string): ContinuousWorkRule { return { id: 'rule', sourceId, projectId: 'project', scope: { assignee: '*', labels: [] }, resource: { runtimeId: 'host', workspaceId: 'workspace' }, model: { provider: 'test', model: 'fixed' }, agentPreset: 'agent', permissionPreset: 'safe', items: [], planning: { instruction: 'Work within scope', supplements: [], blocks: [], scopeVersion: 1 }, queue: { concurrency: 1, refreshMinutes: 5, order: 'oldest', filterPrompt: 'All work' } } as unknown as ContinuousWorkRule }

async function observed(kind: 'repository' | 'project', options: { dependencyStatus?: number; total?: number; blockerState?: 'open' | 'closed' } = {}) {
  const requests: string[] = []
  const adapter = new GitHubSource({ credential: async () => 'host-only-test-token', fetch: async (input, init) => {
    const url = new URL(String(input)); requests.push(url.pathname + url.search)
    expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('manual'); expect(url.origin).toBe('https://api.github.com')
    if (url.pathname === '/user') return Response.json({ login: identity.login, node_id: identity.nodeId })
    if (url.pathname.endsWith('/issues')) return Response.json([raw(1)])
    if (url.pathname.endsWith('/issues/1')) return Response.json({ ...raw(1), issue_dependencies_summary: { total_blocked_by: options.total ?? 1, blocked_by: 1 } })
    if (url.pathname.endsWith('/sub_issues')) return Response.json([])
    if (url.pathname.endsWith('/parent')) return new Response(null, { status: 404 })
    if (url.pathname.endsWith('/dependencies/blocked_by')) return options.dependencyStatus ? new Response(null, { status: options.dependencyStatus }) : Response.json([raw(2, options.blockerState ?? 'open')])
    throw Error(`Unexpected route ${url.pathname}`)
  }, graphql: async () => ({ data: { viewer: { id: identity.nodeId, login: identity.login, name: null }, organization: { projectV2: { id: 'PVT', title: 'Project', url: 'https://github.com/orgs/example/projects/1', closed: false, items: { nodes: [{ id: 'ITEM', type: 'ISSUE', isArchived: false, fieldValues: { pageInfo: { hasNextPage: false }, nodes: [] }, content: { __typename: 'Issue', id: 'I_1', number: 1, title: 'Work 1', url: 'https://github.com/example/repo/issues/1', state: 'OPEN', repository: { name: 'repo', owner: { login: 'example' } }, body: 'Requirements', milestone: null, updatedAt: time, createdAt: time, closedAt: null, assignees: { nodes: [{ login: identity.login }] }, labels: { nodes: [] }, parent: null, subIssues: { totalCount: 0, nodes: [], pageInfo: { hasNextPage: false } }, subIssuesSummary: { total: 0, completed: 0 }, closedByPullRequestsReferences: { nodes: [] } } }], pageInfo: { hasNextPage: false, endCursor: null } } } } } }) })
  const root = await mkdtemp(join(tmpdir(), 'native-relations-')); roots.push(root)
  const app = new WorkApplication(root, { resources: async () => [], sessions: async () => [] }, adapter)
  const project = ok(await app.execute({ type: 'project.create', commandId: 'project', name: 'Relationships' }, actor)).project!
  const source = ok(await app.execute(kind === 'repository' ? { type: 'source.configure', commandId: 'source', projectId: project.id, repository } : { type: 'source.configure-project', commandId: 'source', projectId: project.id, githubProject: { owner: 'example', type: 'org', number: 1 } }, actor)).source!
  const dao = WorkDao.forDirectory(root)
  if (kind === 'repository') ok(await refreshRepositoryCandidates(apply => dao.transaction(apply), { projectId: project.id, sourceId: source.id }, adapter))
  else ok(await app.query({ type: 'source.issues', projectId: project.id, sourceId: source.id, page: 1, perPage: 20, assignee: '*', state: 'open', refresh: true }, actor))
  const state = await dao.read()
  return { requests, state, app, dao, scope: { projectId: project.id, sourceId: source.id }, rule: rule(source.id), issue: state.sources[0]!.observations[0]!.issue }
}

it.each(['repository', 'project'] as const)('hydrates %s observations through the production adapter before admission', async kind => {
  const h = await observed(kind)
  expect(h.requests).toContain('/repos/example/repo/issues/1/dependencies/blocked_by?per_page=100&page=1')
  expect(h.issue).toMatchObject({ parent: null, subIssues: { totalCount: 0, hasNextPage: false }, dependencies: { availability: 'available', blockedBy: { totalCount: 1, hasNextPage: false, items: [{ nodeId: 'I_2', state: 'open' }] } } })
  expect(continuousDependenciesReady(h.state, h.rule, 'I_1')).toBe(false)
  expect(screeningBasis(h.rule, h.state.sources[0]!).candidates[0]!.dependencies).toEqual(h.issue.dependencies)
  expect(h.state.tasks).toEqual([]); expect(h.state.executions).toEqual([])
  expect(JSON.stringify(h.state)).not.toContain('host-only-test-token')
})
it.each(['list', 'detail'] as const)('retains current native readiness after an ordinary repository %s refresh', async kind => {
  const h = await observed('repository', { blockerState: 'closed' })
  expect(continuousDependenciesReady(h.state, h.rule, 'I_1')).toBe(true)
  ok(await h.app.query(kind === 'list'
    ? { type: 'source.issues', ...h.scope, page: 1, perPage: 20, assignee: '*', state: 'open', refresh: true }
    : { type: 'source.issue', ...h.scope, number: 1, nodeId: 'I_1', refresh: true }, actor))
  const refreshed = await h.dao.read()
  expect(refreshed.sources[0]!.observations[0]!.issue.dependencies).toEqual(h.issue.dependencies)
  expect(continuousDependenciesReady(refreshed, h.rule, 'I_1')).toBe(true)
  expect(h.requests.filter(path => path.includes('/dependencies/blocked_by'))).toHaveLength(2)
})
it.each([403, 404, 422, 503])('records unavailable dependency API HTTP %s without admitting or hiding candidate work', async dependencyStatus => {
  const h = await observed('repository', { dependencyStatus })
  expect(h.issue.dependencies).toMatchObject({ availability: 'unavailable', code: expect.any(String) })
  expect(h.state.sources[0]!.repositorySnapshot!.nodeIds).toEqual(['I_1'])
  expect(continuousDependenciesReady(h.state, h.rule, 'I_1')).toBe(false)
})
it('refuses a dependency total-count mismatch and admits a completely observed closed external blocker', async () => {
  const mismatch = await observed('repository', { total: 2, blockerState: 'closed' })
  expect(mismatch.issue.dependencies).toMatchObject({ availability: 'available', blockedBy: { totalCount: 2, hasNextPage: true } })
  expect(continuousDependenciesReady(mismatch.state, mismatch.rule, 'I_1')).toBe(false)
  const complete = await observed('project', { blockerState: 'closed' })
  expect(continuousDependenciesReady(complete.state, complete.rule, 'I_1')).toBe(true)
})

it.each([false, true])('reads all native blocker pages and refuses repeated identities (repeat=%s)', async repeat => {
  const requests: string[] = []
  const adapter = new GitHubSource({ credential: async () => 'test', fetch: async input => {
    const url = new URL(String(input)); requests.push(url.pathname + url.search)
    if (url.pathname === '/user') return Response.json({ login: identity.login, node_id: identity.nodeId })
    if (url.pathname.endsWith('/issues/1')) return Response.json({ ...raw(1), issue_dependencies_summary: { total_blocked_by: 101 } })
    if (url.pathname.endsWith('/sub_issues')) return Response.json([])
    if (url.pathname.endsWith('/parent')) return new Response(null, { status: 404 })
    if (url.pathname.endsWith('/dependencies/blocked_by')) return Response.json(url.searchParams.get('page') === '1' ? Array.from({ length: 100 }, (_, index) => raw(index + 2)) : [raw(repeat ? 2 : 102)])
    throw Error('Unexpected route')
  } })
  const { issue } = await adapter.detail(repository, 1, { nativeRelationships: true })
  expect(requests).toContain('/repos/example/repo/issues/1/dependencies/blocked_by?per_page=100&page=2')
  if (repeat) expect(issue.dependencies).toMatchObject({ availability: 'unavailable', code: 'github-native-dependencies-incomplete' })
  else expect(issue.dependencies).toMatchObject({ availability: 'available', blockedBy: { totalCount: 101, hasNextPage: false, items: expect.arrayContaining([expect.objectContaining({ nodeId: 'I_102' })]) } })
})

function canonicalFixture() {
  const parent = issue(1), child = issue(2)
  const source = { id: 'source', projectId: 'project', provider: 'github', repository, enabled: true, version: 1, sequence: 1, requests: {}, pages: [], identity, repositorySnapshot: { sourceVersion: 1, identity, nodeIds: ['I_1'], observedAt: time }, observations: [{ issue: parent, sequence: 1 }] }
  const task = { id: 'child', projectId: 'foreign', agentId: 'agent', goal: 'Child', children: [], specification: { version: 2 }, progress: { stage: 'in-progress', specificationVersion: 2 } }
  const state = { sources: [source], tasks: [task], externalBindings: [{ nodeId: child.nodeId, ref: { projectId: task.projectId, taskId: task.id }, accepted: child, lastObserved: child }], executions: [] } as unknown as WorkSnapshot
  return { state, parent, child, task, rule: rule(source.id) }
}
it.each(['children', 'blockers'] as const)('requires current canonical acceptance for closed %s outside source membership', kind => {
  const h = canonicalFixture()
  const set = { items: [reference(2, 'closed')], totalCount: 1, hasNextPage: false }
  if (kind === 'children') h.parent.subIssues = set
  else h.parent.dependencies = { availability: 'available', blockedBy: set }
  expect(continuousDependenciesReady(h.state, h.rule, 'I_1')).toBe(false)
  const basis = planningBasis(h.state, h.rule)
  const relative = kind === 'children' ? basis.candidates[0]!.issue.subIssues!.items[0] : basis.candidates[0]!.issue.dependencies!.availability === 'available' ? basis.candidates[0]!.issue.dependencies!.blockedBy.items[0] : undefined
  expect(relative).toMatchObject({ nodeId: 'I_2', canonicalAccepted: false })
  const output = { steps: [{ nodeId: 'I_1', why: 'Work', nextAction: 'Verify', mode: 'new' }] }
  expect(() => validatePlan(output, basis, h.rule)).toThrowError(expect.objectContaining({ code: kind === 'children' ? 'planning-child-coverage' : 'planning-dependency-coverage' }))
  h.task.progress = { stage: 'done', specificationVersion: 1 }
  expect(continuousDependenciesReady(h.state, h.rule, 'I_1')).toBe(false)
  h.task.progress.specificationVersion = 2
  expect(continuousDependenciesReady(h.state, h.rule, 'I_1')).toBe(true)
  expect(validatePlan(output, planningBasis(h.state, h.rule), h.rule).steps).toHaveLength(1)
})
it.each(['missing-issue', 'parent', 'children', 'child-count', 'dependencies', 'duplicate-blocker'] as const)('never treats unknown or incomplete %s facts as ready', mode => {
  const h = canonicalFixture()
  if (mode === 'missing-issue') h.state.sources[0]!.observations = []
  if (mode === 'parent') delete h.parent.parent
  if (mode === 'children') delete h.parent.subIssues
  if (mode === 'child-count') h.parent.subIssues!.totalCount = 1
  if (mode === 'dependencies') delete h.parent.dependencies
  if (mode === 'duplicate-blocker') h.parent.dependencies = { availability: 'available', blockedBy: { items: [reference(3, 'closed'), reference(3, 'closed')], totalCount: 2, hasNextPage: false } }
  expect(continuousDependenciesReady(h.state, h.rule, 'I_1')).toBe(false)
})
it.each(['closed-canonical', 'wait-only'] as const)('rejects parent planning with %s child coverage', mode => {
  const h = canonicalFixture()
  h.child.parent = reference(1)
  if (mode === 'closed-canonical') h.child.state = 'closed'
  else { h.state.externalBindings = []; h.state.tasks = [] }
  h.parent.subIssues = { items: [reference(2, h.child.state)], totalCount: 1, hasNextPage: false }
  h.state.sources[0]!.observations.push({ issue: h.child, sequence: 1 })
  h.state.sources[0]!.repositorySnapshot!.nodeIds.push(h.child.nodeId)
  const steps = [...(mode === 'wait-only' ? [{ nodeId: 'I_2', why: 'Wait', nextAction: 'Wait', mode: 'wait' }] : []), { nodeId: 'I_1', why: 'Work', nextAction: 'Verify', mode: 'new' }]
  expect(() => validatePlan({ steps }, planningBasis(h.state, h.rule), h.rule)).toThrowError(expect.objectContaining({ code: 'planning-child-coverage' }))
})
it('retains accepted native children after a fresh discovery removes their edge', () => {
  const h = canonicalFixture()
  h.state.externalBindings.push({ nodeId: 'I_1', ref: { projectId: 'project', taskId: 'parent' }, accepted: { ...h.parent, subIssues: { items: [reference(2)], totalCount: 1, hasNextPage: false } }, lastObserved: h.parent } as WorkSnapshot['externalBindings'][number])
  expect(continuousDependenciesReady(h.state, h.rule, 'I_1')).toBe(false)
  h.task.progress = { stage: 'done', specificationVersion: 2 }
  expect(continuousDependenciesReady(h.state, h.rule, 'I_1')).toBe(true)
})
