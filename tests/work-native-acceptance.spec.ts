import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, basename, join } from 'node:path'
import { GitHubSource } from '../src/work-sources/github.ts'
import { WorkApplication, type WorkHost } from '../src/work.ts'
import type { WorkResult, WorkTask } from '../src/work-types.ts'
import type { GitHubIssue, GitHubSourcePort } from '../src/work-sources/types.ts'
import type { ExecutionObservation } from '../src/work-execution/observation.ts'
const operator = { operator: true }
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (dirname(root) !== tmpdir() || !basename(root).startsWith('native-acceptance-') || await realpath(root) !== root) throw Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }) } })
const ok = (result: WorkResult) => { if (result.status !== 'completed') throw Error(JSON.stringify(result)); return result }
const identity = { login: 'developer', nodeId: 'U_developer', name: null }
const repository = { owner: 'example', repository: 'repo' }
const issue = (number: number): GitHubIssue => ({ nodeId: `I_${number}`, number, url: `https://github.com/example/repo/issues/${number}`, repository, title: `Work ${number}`, body: 'Verify the specified result', labels: [], assignees: ['developer'], state: 'open', observedAt: '2026-10-21T00:01:00Z', updatedAt: '2026-10-21T00:00:00Z', subIssues: { items: [], totalCount: 0, hasNextPage: false } })
const report = { specificationVersion: 1, stage: 'done' as const, summary: 'verified', next: '', blockers: [], criteria: [{ index: 0, passed: true, evidence: ['verification result'] }], closeExternal: true }
async function setup(change: (parent: GitHubIssue, child: GitHubIssue) => void = () => {}, observation: () => Promise<ExecutionObservation> = async () => ({ settlement: 'settled', sessions: [], blockers: [], reminders: [], limitations: [] })) {
  const root = await mkdtemp(join(tmpdir(), 'native-acceptance-')); roots.push(root)
  const resource = { runtimeId: 'runtime', workspaceId: 'workspace' }
  const choices = { models: [{ provider: 'contract', model: 'default' }], agentPresets: ['contract'], permissionPresets: ['read-only'], defaults: { model: { provider: 'contract', model: 'default' }, agentPreset: 'contract', permissionPreset: 'read-only' } }
  const host: WorkHost = { resources: async () => [{ ref: resource, title: 'local' }, { ref: { ...resource, workspaceId: 'foreign' }, title: 'foreign' }], sessions: async () => [], execution: {
    connect() {}, status: () => 'idle', check: async () => choices, choices: async () => choices, ensure: async () => ({ runtimeId: 'runtime', cwd: root, provider: 'contract', model: 'default', agentPreset: 'contract', permissionPreset: 'read-only', sandbox: 'read-only', approval: 'never' }),
    settle: async () => {}, maintain: async (_, body) => body(), wake: async () => {}, deliver: async () => 'consumed', observe: async () => 'consumed', observation,
  } }
  const parent = issue(1), child = issue(2)
  parent.subIssues = { items: [{ nodeId: child.nodeId, number: child.number, url: child.url, title: child.title, repository: child.repository, state: child.state }], totalCount: 1, hasNextPage: false }
  change(parent, child)
  let writes = 0
  const reads: string[] = []
  const source: GitHubSourcePort = { list: async () => ({ identity, items: [parent, child], observedAt: parent.observedAt }), detail: async (_, number) => { reads.push(`${_.owner}/${_.repository}#${number}`); return { identity, issue: structuredClone(number === 1 ? parent : child) } }, close: async () => { writes++; return { status: 'closed' } } }
  const app = new WorkApplication(root, host, source)
  const project = ok(await app.execute({ type: 'project.create', commandId: 'project', name: 'native', resource }, operator)).project!
  const configured = ok(await app.execute({ type: 'source.configure', commandId: 'source', projectId: project.id, repository }, operator)).source!
  await app.query({ type: 'source.issues', projectId: project.id, sourceId: configured.id, page: 1, perPage: 20, assignee: '*', state: 'all', refresh: true }, operator)
  const local = ok(await app.execute({ type: 'task.create', commandId: 'parent', projectId: project.id, title: 'parent', goal: 'verify all necessary results', specification: 'verify', acceptance: ['verified'] }, operator)).task!
  const ref = { projectId: project.id, taskId: local.id }
  ok(await app.execute({ type: 'source.link', commandId: 'link', ref, expectedVersion: local.version, sourceId: configured.id, nodeId: parent.nodeId }, operator))
  const start = async (task: WorkTask, selected = resource) => ok(await app.execute({ type: 'task.start', commandId: `start:${task.id}`, ref: { projectId: task.projectId, taskId: task.id }, expectedVersion: task.version, agentId: task.agentId, resource: selected, model: { provider: 'contract', model: 'default' }, agentPreset: 'contract', permissionPreset: 'read-only' }, operator)).execution!
  const execution = await start(ok(await app.query({ type: 'task.detail', ref }, operator)).task!)
  return { app, ref, execution, project, configured, parent, child, start, reads, writes: () => writes, detail: async () => ok(await app.query({ type: 'task.detail', ref }, operator)) }
}
it('refuses to link two independently imported root Issues as a local parent and child', async () => {
  const h = await setup(parent => { parent.subIssues = { items: [], totalCount: 0, hasNextPage: false } })
  const child = ok(await h.app.execute({ type: 'source.import', commandId: 'root-child', projectId: h.project.id, sourceId: h.configured.id, nodeId: h.child.nodeId }, operator)).task!
  const before = await h.detail()
  expect(await h.app.execute({ type: 'task.link-child', commandId: 'invented-edge', ref: h.ref, expectedVersion: before.task!.version,
    child: { projectId: child.projectId, taskId: child.id }, childExpectedVersion: child.version }, operator)).toMatchObject({ status: 'failed', error: { code: 'native-child-relationship-required' } })
  expect((await h.detail()).task).toEqual(before.task)
  expect(ok(await h.app.query({ type: 'task.detail', ref: { projectId: child.projectId, taskId: child.id } }, operator)).task).toEqual(child)
  expect(h.writes()).toBe(0)
})

it.each(['unknown', 'partial', 'count-mismatch', 'duplicate', 'foreign-repository', 'foreign-owner', 'wrong-number', 'wrong-node'] as const)('refuses operator linking with %s native relationship evidence', async mode => {
  const h = await setup(parent => {
    if (mode === 'unknown') delete parent.subIssues
    else if (mode === 'partial') parent.subIssues!.hasNextPage = true
    else if (mode === 'count-mismatch') parent.subIssues!.totalCount = 2
    else if (mode === 'duplicate') { parent.subIssues!.items.push(structuredClone(parent.subIssues!.items[0]!)); parent.subIssues!.totalCount = 2 }
    else if (mode === 'foreign-repository') parent.subIssues!.items[0]!.repository = { ...repository, repository: 'other' }
    else if (mode === 'foreign-owner') parent.subIssues!.items[0]!.repository = { ...repository, owner: 'other' }
    else if (mode === 'wrong-number') parent.subIssues!.items[0]!.number = 99
    else parent.subIssues!.items[0]!.nodeId = 'I_other'
  })
  const child = ok(await h.app.execute({ type: 'source.import', commandId: 'observed-child', projectId: h.project.id, sourceId: h.configured.id, nodeId: h.child.nodeId }, operator)).task!
  const before = await h.detail()
  expect(await h.app.execute({ type: 'task.link-child', commandId: 'unproven-edge', ref: h.ref, expectedVersion: before.task!.version,
    child: { projectId: child.projectId, taskId: child.id }, childExpectedVersion: child.version }, operator)).toMatchObject({ status: 'failed', error: { code: 'native-child-relationship-required' } })
  expect((await h.detail()).task).toEqual(before.task)
  expect(ok(await h.app.query({ type: 'task.detail', ref: { projectId: child.projectId, taskId: child.id } }, operator)).task).toEqual(child)
})

it('links a completely read and explicitly accepted native child and still requires its independent acceptance', async () => {
  const h = await setup(parent => { parent.subIssues = { items: [], totalCount: 0, hasNextPage: false } })
  const imported = ok(await h.app.execute({ type: 'source.import', commandId: 'import-child', projectId: h.project.id, sourceId: h.configured.id, nodeId: h.child.nodeId }, operator))
  h.parent.subIssues = { items: [{ nodeId: h.child.nodeId, number: h.child.number, url: h.child.url, title: h.child.title, repository, state: 'open' }], totalCount: 1, hasNextPage: false }
  h.parent.observedAt = '2026-10-22T00:00:00Z'
  ok(await h.app.sessionReadRelatedIssue(h.execution.session))
  const link = async (commandId: string) => h.app.execute({ type: 'task.link-child', commandId, ref: h.ref, expectedVersion: (await h.detail()).task!.version,
    child: imported.ref!, childExpectedVersion: ok(await h.app.query({ type: 'task.detail', ref: imported.ref! }, operator)).task!.version }, operator)
  expect(await link('observed-only-link')).toMatchObject({ status: 'failed', error: { code: 'native-child-relationship-required' } })
  ok(await h.app.sessionOrganize(h.execution.session, 'accept-child-scope', { kind: 'source-children', expectedVersion: (await h.detail()).task!.version, observedAt: h.parent.observedAt }))
  expect(ok(await link('accepted-native-link')).task!.children).toEqual([imported.ref])
  const linkedChild = ok(await h.app.query({ type: 'task.detail', ref: imported.ref! }, operator)).task!
  const child = ok(await h.app.execute({ type: 'task.update-spec', commandId: 'spec-child', ref: imported.ref!, expectedVersion: linkedChild.version, goal: 'verify', specification: 'verify', acceptance: ['verified'] }, operator)).task!
  expect((await h.detail()).execution).toMatchObject({ id: h.execution.id, owner: h.execution.owner, epoch: h.execution.epoch })
  expect(await h.app.sessionReport(h.execution.session, 'child-unaccepted', report)).toMatchObject({ status: 'failed', error: { code: 'native-child-acceptance-required' } })
  const childExecution = await h.start(child)
  ok(await h.app.sessionReport(childExecution.session, 'independent-child-accepted', { ...report, specificationVersion: child.specification.version, closeExternal: false }))
  ok(await h.app.sessionReport(h.execution.session, 'parent-accepted', { ...report, closeExternal: false }))
  expect((await h.detail()).task!.completion).toBeDefined()
  expect(h.writes()).toBe(0)
})

it('ignores a legacy local edge between bound root Issues when accepting the parent', async () => {
  const h = await setup(parent => { parent.subIssues = { items: [], totalCount: 0, hasNextPage: false } })
  const child = ok(await h.app.execute({ type: 'source.import', commandId: 'legacy-root-child', projectId: h.project.id, sourceId: h.configured.id, nodeId: h.child.nodeId }, operator)).task!
  // Arrange the public persisted format from the old operator link command.
  const file = join(h.app.directory, 'work-v3.json')
  const snapshot = JSON.parse(await readFile(file, 'utf8')) as { tasks: WorkTask[] }
  snapshot.tasks.find(task => task.id === h.ref.taskId)!.children = [{ projectId: child.projectId, taskId: child.id }]
  snapshot.tasks.find(task => task.id === child.id)!.parent = h.ref
  await writeFile(file, JSON.stringify(snapshot))
  const reloaded = new WorkApplication(h.app.directory, h.app.host, h.app.source)
  expect(ok(await reloaded.sessionReport(h.execution.session, 'ignore-invented-necessity', report)).task!.completion).toBeDefined()
  expect(ok(await reloaded.query({ type: 'task.detail', ref: { projectId: child.projectId, taskId: child.id } }, operator)).task!.completion).toBeUndefined()
})

it.each(['open', 'closed'] as const)('refuses parent acceptance when a necessary %s native child has never been imported', async state => {
  const h = await setup((parent, child) => { child.state = state; parent.subIssues!.items[0]!.state = state })
  expect(await h.app.sessionReport(h.execution.session, 'early', report)).toMatchObject({ status: 'failed', error: { code: 'native-child-acceptance-required' } })
  await h.app.reconcileCompletions()
  expect((await h.detail()).task!.completion).toBeUndefined()
  expect(h.writes()).toBe(0)
  expect(ok(await h.app.query({ type: 'project.detail', projectId: h.project.id }, operator)).tasks).toHaveLength(1)
})

it('records evidence for an unimported external child without making another Task or Session', async () => {
  const h = await setup()
  const externalChildren = [{ nodeId: h.child.nodeId, updatedAt: h.child.updatedAt, basis: 'Accepted child specification: verification output matches the required result', evidence: ['https://github.com/example/repo/issues/2#issuecomment-42 contains the reviewed verification output'] }]
  expect(await h.app.sessionReport(h.execution.session, 'external-without-read', { ...report, externalChildren })).toMatchObject({ status: 'failed', error: { code: 'native-child-evidence-unobserved' } })
  ok(await h.app.sessionReadRelatedIssue(h.execution.session, h.child.nodeId))
  ok(await h.app.sessionReport(h.execution.session, 'external-reviewed', { ...report, externalChildren }))
  expect((await h.detail()).task!.completion).toBeDefined()
  expect(ok(await h.app.query({ type: 'project.detail', projectId: h.project.id }, operator)).tasks).toHaveLength(1)
  expect(h.reads).toEqual(['example/repo#2'])
})

it.each(['unknown', 'partial', 'count-mismatch'] as const)('refuses %s native scope without a completion or close intent', async mode => {
  const h = await setup(parent => { if (mode === 'unknown') delete parent.subIssues; else if (mode === 'partial') parent.subIssues!.hasNextPage = true; else parent.subIssues!.totalCount = 2 })
  expect(await h.app.sessionReport(h.execution.session, 'incomplete', report)).toMatchObject({ status: 'failed', error: { code: 'native-child-scope-incomplete' } })
  await h.app.reconcileCompletions()
  expect((await h.detail()).task!.completion).toBeUndefined()
  expect(h.writes()).toBe(0)
})
it('accepts a completely read empty scope and keeps pure local work free of invented source requirements', async () => {
  const h = await setup(parent => { parent.subIssues = { items: [], totalCount: 0, hasNextPage: false } })
  ok(await h.app.sessionReport(h.execution.session, 'no-native-children', report))
  const task = ok(await h.app.execute({ type: 'task.create', commandId: 'local', projectId: h.project.id, title: 'local', goal: 'local', specification: 'local', acceptance: ['verified'] }, operator)).task!
  const execution = await h.start(task)
  ok(await h.app.sessionReport(execution.session, 'pure-local', { ...report, closeExternal: false }))
  expect(ok(await h.app.query({ type: 'task.detail', ref: execution.ref }, operator)).task!.completion).toBeDefined()
})
it('uses foreign canonical acceptance and refuses external evidence that would bypass its unfinished work', async () => {
  const h = await setup()
  const resource = { runtimeId: 'runtime', workspaceId: 'foreign' }
  const project = ok(await h.app.execute({ type: 'project.create', commandId: 'foreign', name: 'foreign', resource }, operator)).project!
  const source = ok(await h.app.execute({ type: 'source.configure', commandId: 'foreign-source', projectId: project.id, repository }, operator)).source!
  ok(await h.app.query({ type: 'source.issue', projectId: project.id, sourceId: source.id, number: 2, refresh: true }, operator))
  const task = ok(await h.app.execute({ type: 'task.create', commandId: 'foreign-child', projectId: project.id, title: 'child', goal: 'verify', specification: 'verify', acceptance: ['verified'] }, operator)).task!
  const ref = { projectId: project.id, taskId: task.id }
  const linked = ok(await h.app.execute({ type: 'source.link', commandId: 'foreign-link', ref, sourceId: source.id, expectedVersion: task.version, nodeId: h.child.nodeId }, operator)).task!
  ok(await h.app.sessionReadRelatedIssue(h.execution.session, h.child.nodeId))
  const externalChildren = [{ nodeId: h.child.nodeId, updatedAt: h.child.updatedAt, basis: 'external closed state cannot replace canonical acceptance', evidence: [h.child.url] }]
  expect(await h.app.sessionReport(h.execution.session, 'foreign-unfinished', { ...report, externalChildren })).toMatchObject({ status: 'failed', error: { code: 'native-child-acceptance-required' } })
  expect((await h.detail()).task!.completion).toBeUndefined()
  const childExecution = await h.start(linked, resource)
  ok(await h.app.sessionReport(childExecution.session, 'child-accepted', { ...report, closeExternal: false }))
  ok(await h.app.sessionReport(h.execution.session, 'foreign-verified', report))
  expect((await h.detail()).task!.children).toEqual([])
  expect(ok(await h.app.query({ type: 'task.detail', ref }, operator)).execution).toMatchObject({ id: childExecution.id, owner: childExecution.owner, session: childExecution.session })
})
it('requires explicit owner acceptance of a newly read complete scope and does not expand it on source refresh', async () => {
  const h = await setup(parent => { delete parent.subIssues })
  h.parent.subIssues = { items: [], totalCount: 0, hasNextPage: false }
  h.parent.observedAt = '2026-10-22T00:00:00Z'
  ok(await h.app.sessionReadRelatedIssue(h.execution.session))
  expect(await h.app.sessionReport(h.execution.session, 'observed-only', report)).toMatchObject({ status: 'failed', error: { code: 'native-child-scope-incomplete' } })
  const before = (await h.detail()).task!
  ok(await h.app.sessionOrganize(h.execution.session, 'accept-complete-scope', { kind: 'source-children', expectedVersion: before.version, observedAt: h.parent.observedAt }))
  h.parent.subIssues = { items: [{ nodeId: h.child.nodeId, url: h.child.url, repository, number: 2, title: h.child.title, state: 'open' }], totalCount: 1, hasNextPage: false }
  h.parent.observedAt = '2026-10-23T00:00:00Z'
  ok(await h.app.sessionReadRelatedIssue(h.execution.session))
  ok(await h.app.sessionReport(h.execution.session, 'accepted-empty-business-scope', report))
  expect((await h.detail()).bindings![0]!.acceptedChildren!.items).toEqual([])
})
it('never removes necessary children when the latest native observation shrinks', async () => {
  const h = await setup()
  h.parent.subIssues = { items: [], totalCount: 0, hasNextPage: false }
  h.parent.observedAt = '2026-10-22T00:00:00Z'
  ok(await h.app.sessionReadRelatedIssue(h.execution.session))
  expect(await h.app.sessionOrganize(h.execution.session, 'cannot-drop-child', { kind: 'source-children', expectedVersion: (await h.detail()).task!.version, observedAt: h.parent.observedAt })).toMatchObject({ status: 'failed', error: { code: 'native-child-scope-shrunk' } })
  expect(await h.app.sessionReport(h.execution.session, 'still-required', report)).toMatchObject({ status: 'failed', error: { code: 'native-child-acceptance-required' } })
})
it('limits source reads to the current coordinator and known related identities before any remote I/O', async () => {
  const h = await setup()
  expect(await h.app.sessionReadRelatedIssue({ runtimeId: 'runtime', sessionId: 'foreign' }, h.child.nodeId)).toMatchObject({ status: 'failed', error: { code: 'forbidden' } })
  expect(await h.app.sessionReadRelatedIssue(h.execution.session, h.child.nodeId, 99)).toMatchObject({ status: 'failed', error: { code: 'forbidden' } })
  expect(await h.app.sessionReadRelatedIssue(h.execution.session, 'I_unrelated')).toMatchObject({ status: 'failed', error: { code: 'source-reference-unrelated' } })
  expect(h.reads).toEqual([])
  const original = h.app.source!.detail
  h.app.source!.detail = async (...args) => { const result = await original(...args); return { ...result, issue: { ...result.issue, nodeId: 'I_wrong' } } }
  expect(await h.app.sessionReadRelatedIssue(h.execution.session, h.child.nodeId)).toMatchObject({ status: 'failed', error: { code: 'source-identity-changed' } })
})

it('reads the real adapter native child endpoint completely before presenting a scope for explicit acceptance', async () => {
  const requests: string[] = []
  const raw = (number: number) => ({ node_id: `I_${number}`, number, html_url: `https://github.com/example/repo/issues/${number}`, title: `Work ${number}`, body: 'verify', state: 'open', milestone: null, updated_at: '2026-10-21T00:00:00Z', labels: [], assignees: [] })
  const adapter = new GitHubSource({ credential: async () => 'host-only-credential', fetch: async (input, init) => {
    const url = String(input); requests.push(url)
    expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('manual')
    if (url.endsWith('/user')) return Response.json({ login: identity.login, node_id: identity.nodeId })
    if (url.endsWith('/issues/1')) return Response.json({ ...raw(1), sub_issues_summary: { total: 101, completed: 0 } })
    if (url.endsWith('/sub_issues?per_page=100&page=1')) return Response.json(Array.from({ length: 100 }, (_, index) => raw(index + 2)))
    if (url.endsWith('/sub_issues?per_page=100&page=2')) return Response.json([raw(102)])
    throw Error('Unexpected source route')
  } })
  const result = await adapter.detail(repository, 1, { nativeChildren: true })
  expect(result.issue.subIssues).toMatchObject({ totalCount: 101, hasNextPage: false })
  expect(result.issue.subIssues!.items).toHaveLength(101)
  expect(requests).toHaveLength(4)
  expect(JSON.stringify(result)).not.toContain('host-only-credential')
})

it('refuses invented external child evidence on a pure local Task', async () => {
  const h = await setup(parent => { parent.subIssues = { items: [], totalCount: 0, hasNextPage: false } })
  const task = ok(await h.app.execute({ type: 'task.create', commandId: 'local-evidence', projectId: h.project.id, title: 'local', goal: 'local', specification: 'local', acceptance: ['verified'] }, operator)).task!
  const execution = await h.start(task)
  expect(await h.app.sessionReport(execution.session, 'unrelated-external', { ...report, closeExternal: false, externalChildren: [{ nodeId: 'I_invented', updatedAt: h.child.updatedAt, basis: 'unrelated', evidence: [h.child.url] }] })).toMatchObject({ status: 'failed', error: { code: 'native-child-evidence-out-of-scope' } })
  expect(ok(await h.app.query({ type: 'task.detail', ref: execution.ref }, operator)).task!.completion).toBeUndefined()
})
it('accepts completion when only an unreachable job remains and returns its bounded reminder', async () => {
  const reminder = '作业 bash-641（bash：cd /data && pnpm test）的注册表实例已不可达，终态结果无法再收取；按「不可达只提醒」约定不阻断完成，如需取证请查看该作业所属会话历史。'
  const h = await setup(parent => { parent.subIssues = { items: [], totalCount: 0, hasNextPage: false } }, async () => ({ settlement: 'settled', sessions: [], blockers: [], reminders: [reminder], limitations: [] }))
  const accepted = ok(await h.app.sessionReport(h.execution.session, 'lost-job-only', report))
  expect(accepted.reminders).toEqual([reminder])
  expect((await h.detail()).task!.completion).toBeDefined()
})
it('accepts completion when an older host observation omits the public reminders field', async () => {
  // reminders is a public optional capability: a third-party or older adapter may
  // omit it, and a missing field must not throw inside the completion gate.
  const h = await setup(parent => { parent.subIssues = { items: [], totalCount: 0, hasNextPage: false } },
    async () => ({ settlement: 'settled', sessions: [], blockers: [], limitations: [] } as unknown as ExecutionObservation))
  const accepted = ok(await h.app.sessionReport(h.execution.session, 'legacy-observation', report))
  expect(accepted.reminders).toBeUndefined()
  expect((await h.detail()).task!.completion).toBeDefined()
})
it('still refuses completion while a reachable job result remains uncollected', async () => {
  const h = await setup(parent => { parent.subIssues = { items: [], totalCount: 0, hasNextPage: false } }, async () => ({ settlement: 'pending', sessions: [],
    blockers: [{ code: 'job-unsettled', session: { runtimeId: 'runtime', sessionId: 'current' }, jobId: 'bash-1' }], reminders: [], limitations: [] }))
  expect(await h.app.sessionReport(h.execution.session, 'live-job-pending', report)).toMatchObject({ status: 'failed', error: { code: 'completion-results-unsettled' } })
  expect((await h.detail()).task!.completion).toBeUndefined()
})
it('requires current externally observed material after the necessary child changes', async () => {
  const h = await setup()
  ok(await h.app.sessionReadRelatedIssue(h.execution.session, h.child.nodeId))
  const externalChildren = [{ nodeId: h.child.nodeId, updatedAt: h.child.updatedAt, basis: 'reviewed original child requirements', evidence: [h.child.url] }]
  h.child.updatedAt = '2026-10-22T00:00:00Z'
  ok(await h.app.sessionReadRelatedIssue(h.execution.session, h.child.nodeId))
  expect(await h.app.sessionReport(h.execution.session, 'stale-external-result', { ...report, externalChildren })).toMatchObject({ status: 'failed', error: { code: 'native-child-evidence-unobserved' } })
  expect((await h.detail()).task!.completion).toBeUndefined()
})
