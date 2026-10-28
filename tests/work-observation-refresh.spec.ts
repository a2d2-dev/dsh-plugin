import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkApplication, type WorkHost } from '../src/work.ts'
import { applyObservedIssue } from '../src/work-sources/observations.ts'
import type { GitHubIssue, GitHubSourcePort } from '../src/work-sources/types.ts'
import type { WorkResult, WorkTask } from '../src/work-types.ts'

const roots: string[] = []
const operator = { operator: true }
const noHost = { resources: async () => [], sessions: async () => [] }
const identity = { login: 'imneov', nodeId: 'U_1', name: 'LiuFeng' }
const repository = { owner: 'a2d2-dev', repository: 'dsh-plugin' }
const base: GitHubIssue = {
  nodeId: 'I_160', url: 'https://github.com/a2d2-dev/dsh-plugin/issues/160', number: 160,
  title: 'A', body: 'Fixture A', repository, state: 'open', labels: [], assignees: ['imneov'],
  updatedAt: '2026-10-22T02:10:41Z', observedAt: '2026-10-22T08:19:20.516Z',
  subIssues: { items: [], totalCount: 0, hasNextPage: false },
}
function completed(result: WorkResult) {
  expect(result.status).toBe('completed')
  if (result.status !== 'completed') throw new Error(JSON.stringify(result))
  return result
}
afterEach(async () => { for (const root of roots.splice(0)) { if (!root.startsWith(join(tmpdir(), 'a2d2-observe-'))) throw new Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }) } })

it('keeps the richer observation when an equal-version list scan arrives without native children', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-observe-')); roots.push(directory)
  let listing: GitHubIssue = base
  const port: GitHubSourcePort = {
    list: async () => ({ identity, items: [listing], observedAt: listing.observedAt }),
    detail: async () => ({ identity, issue: base }),
  }
  const app = new WorkApplication(directory, noHost, port)
  const project = completed(await app.execute({ type: 'project.create', commandId: 'project', name: 'observe' }, operator)).project!
  const source = completed(await app.execute({ type: 'source.configure', commandId: 'source', projectId: project.id, repository }, operator)).source!
  const page = { type: 'source.issues' as const, projectId: project.id, sourceId: source.id, refresh: true, page: 1, perPage: 20, assignee: '*', state: 'open' as const }
  completed(await app.query(page, operator))
  const task = completed(await app.execute({ type: 'source.import', commandId: 'import', projectId: project.id, sourceId: source.id, nodeId: base.nodeId }, operator)).task! as WorkTask
  const observed = async () => completed(await app.query({ type: 'task.detail', ref: { projectId: task.projectId, taskId: task.id } }, operator)).bindings![0]!.lastObserved
  expect(await observed()).toMatchObject({ observedAt: base.observedAt, updatedAt: base.updatedAt, subIssues: base.subIssues })

  // A continuous candidate/catalog scan of the same version carries no native children.
  listing = { ...base, observedAt: '2026-10-22T08:25:20.404Z', subIssues: undefined }
  completed(await app.query(page, operator))
  expect(await observed()).toMatchObject({ observedAt: base.observedAt, updatedAt: base.updatedAt, subIssues: base.subIssues })

  // A genuinely newer version replaces the observation but never drops the known child list.
  listing = { ...base, updatedAt: '2026-10-22T09:00:00Z', observedAt: '2026-10-22T09:00:01Z', subIssues: undefined }
  completed(await app.query(page, operator))
  expect(await observed()).toMatchObject({ observedAt: '2026-10-22T09:00:01Z', updatedAt: '2026-10-22T09:00:00Z', subIssues: base.subIssues })
})

it('never replaces a newer observation with an older or equal list scan', () => {
  expect(applyObservedIssue(base, { ...base, updatedAt: base.updatedAt, observedAt: 'later' })).toBeUndefined()
  expect(applyObservedIssue(base, { ...base, updatedAt: '2026-10-22T01:00:00Z' })).toBeUndefined()
  expect(applyObservedIssue(undefined, { ...base })).toEqual(base)
  expect(applyObservedIssue(base, { ...base, updatedAt: '2026-10-22T09:00:00Z', subIssues: undefined })).toMatchObject({ updatedAt: '2026-10-22T09:00:00Z', subIssues: base.subIssues })
  expect(applyObservedIssue({ ...base, subIssues: undefined }, { ...base, updatedAt: '2026-10-22T09:00:00Z', subIssues: undefined })).toMatchObject({ subIssues: undefined })
})

const scanEntries = ['repository-candidates', 'project-discovery', 'source-list'] as const
async function managedObservation(entry: typeof scanEntries[number]) {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-observe-')); roots.push(directory)
  const resource = { runtimeId: 'runtime', workspaceId: 'workspace' }
  const model = { provider: 'contract', model: 'default' }
  const choices = { models: [model], agentPresets: ['contract'], permissionPresets: ['read-only'], defaults: { model, agentPreset: 'contract', permissionPreset: 'read-only' } }
  const host: WorkHost = { resources: async () => [{ ref: resource, title: 'local' }], sessions: async () => [], execution: {
    connect() {}, status: () => 'idle', check: async () => choices, choices: async () => choices,
    ensure: async () => ({ runtimeId: 'runtime', cwd: directory, ...model, agentPreset: 'contract', permissionPreset: 'read-only', sandbox: 'read-only', approval: 'never' }),
    settle: async () => {}, maintain: async (_, body) => body(), wake: async () => {}, deliver: async () => 'consumed', observe: async () => 'consumed',
    observation: async () => ({ settlement: 'settled', sessions: [], blockers: [], reminders: [], limitations: [] }),
  } }
  const full: GitHubIssue = { ...base, parent: null, dependencies: { availability: 'available', blockedBy: { items: [], totalCount: 0, hasNextPage: false } } }
  let listing: GitHubIssue = { ...full, observedAt: '2026-10-22T08:10:00Z', subIssues: undefined }
  const port: GitHubSourcePort = {
    list: async () => ({ identity, items: [structuredClone(listing)], observedAt: listing.observedAt }),
    // An adapter may omit relationships in candidate scans. Only the explicit
    // related-Issue read guarantees the complete native child observation here.
    detail: async (_, number, options) => {
      expect(number).toBe(base.number)
      return { identity, issue: structuredClone(options?.nativeChildren ? full : listing) }
    },
    project: async () => ({ identity, project: { nodeId: 'PVT_1', title: 'Observation', url: 'https://github.com/orgs/a2d2-dev/projects/1', closed: false },
      items: [{ id: 'PVTI_160', kind: 'issue', archived: false, issueNodeId: base.nodeId, fields: [], fieldsPartial: false }], issues: [structuredClone(listing)], observedAt: listing.observedAt }),
  }
  const app = new WorkApplication(directory, host, port, { generate: async () => ({ steps: [{ nodeId: base.nodeId, why: 'Continue accepted work', nextAction: 'Read and accept the complete native scope', mode: 'existing' }] }) })
  const project = completed(await app.execute({ type: 'project.create', commandId: 'project', name: 'managed observation', resource }, operator)).project!
  const source = completed(await app.execute(entry === 'project-discovery'
    ? { type: 'source.configure-project', commandId: 'source', projectId: project.id, githubProject: { owner: repository.owner, type: 'org', number: 1 } }
    : { type: 'source.configure', commandId: 'source', projectId: project.id, repository }, operator)).source!
  const scope = { projectId: project.id, sourceId: source.id }
  const page = { type: 'source.issues' as const, ...scope, refresh: true, page: 1, perPage: 20, assignee: '*' as const, state: 'open' as const }
  completed(await app.query(page, operator))
  const imported = completed(await app.execute({ type: 'source.import', commandId: 'import', ...scope, nodeId: base.nodeId }, operator))
  const ref = imported.ref!
  const task = completed(await app.execute({ type: 'task.update-spec', commandId: 'specification', ref, expectedVersion: imported.task!.version,
    goal: 'Preserve the complete observation through scans', specification: 'Accept the native scope read through the trusted source route and verify completion', acceptance: ['The accepted source observation survives equal-version scans'] }, operator)).task!
  const execution = completed(await app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: task.version, agentId: task.agentId, resource, model, agentPreset: 'contract', permissionPreset: 'read-only' }, operator)).execution!
  const detail = async () => completed(await app.query({ type: 'task.detail', ref }, operator))
  const status = async () => completed(await app.query({ type: 'continuous.status', ...scope }, operator)).continuousRule!

  // Plan against complete candidate relationships, while the originally accepted
  // source still has an unknown native scope. Discovery must not accept it for us.
  listing = { ...full, observedAt: '2026-10-22T08:15:00Z' }
  completed(await app.query(page, operator))
  completed(await app.execute({ type: 'continuous.configure', commandId: 'configure', ...scope, expectedVersion: 0, assignee: '*', labels: [], resource, model, agentPreset: 'contract', permissionPreset: 'read-only', enabled: false }, operator))
  completed(await app.execute({ type: 'continuous.instruct', commandId: 'instruct', ...scope, expectedVersion: 1, text: 'Continue this Task and preserve its accepted requirements' }, operator))
  completed(await app.execute({ type: 'continuous.preview', commandId: 'preview', ...scope, expectedVersion: 2 }, operator))
  completed(await app.execute({ type: 'continuous.set-enabled', commandId: 'enable', ...scope, expectedVersion: 3, enabled: true }, operator))
  expect(await status()).toMatchObject({ enabled: true, active: ref, planning: { enabledPlanVersion: 1 }, items: [{ nodeId: base.nodeId, ref, executionId: execution.id, state: 'active' }] })
  expect((await detail()).bindings![0]!.accepted.subIssues).toBeUndefined()
  const report = { specificationVersion: task.specification.version, stage: 'done' as const, summary: 'Native scope reviewed and regression verified', next: '', blockers: [], criteria: [{ index: 0, passed: true, evidence: ['Verified observation refresh and explicit native scope adoption'] }], closeExternal: false }
  expect(await app.sessionReport(execution.session, 'before-adoption', report)).toMatchObject({ status: 'failed', error: { code: 'native-child-scope-incomplete' } })
  const read = completed(await app.sessionReadRelatedIssue(execution.session))
  expect(read.issue).toMatchObject({ observedAt: base.observedAt, updatedAt: base.updatedAt, subIssues: base.subIssues })

  const scan = async (updatedAt = base.updatedAt) => {
    expect(await status()).toMatchObject({ enabled: true, planning: { enabledPlanVersion: 1 } })
    listing = { ...full, updatedAt, observedAt: '2026-10-22T09:00:01Z', subIssues: undefined }
    if (entry === 'repository-candidates') await app.reconcileSources()
    else completed(await app.query(page, operator)) // Project sources enter real discovery; repositories enter the ordinary list refresh.
    const refreshed = completed(await app.query({ type: 'source.list', projectId: project.id }, operator)).sources![0]!
    expect(refreshed.lastError).toBeUndefined()
    const issue = completed(await app.query({ type: 'source.issue', ...scope, number: base.number, nodeId: base.nodeId, refresh: false }, operator)).issue!
    expect(issue).toMatchObject({ observedAt: listing.observedAt, updatedAt })
    expect(issue.subIssues).toBeUndefined()
    if (entry === 'repository-candidates') expect(refreshed.repositorySnapshot?.observedAt).toBe(listing.observedAt)
    if (entry === 'project-discovery') expect(refreshed.projectSnapshot?.observedAt).toBe(listing.observedAt)
    expect(await status()).toMatchObject({ enabled: true, active: ref, planning: { enabledPlanVersion: 1 } })
  }
  return { app, execution, ref, detail, status, report, scan, observedAt: read.issue!.observedAt }
}

it.each(scanEntries)('adopts the original complete observation and completes while %s scanning remains enabled', async entry => {
  const h = await managedObservation(entry)
  await h.scan()
  const before = await h.detail()
  const adopted = await h.app.sessionOrganize(h.execution.session, 'adopt-original-observation', { kind: 'source-children', expectedVersion: before.task!.version, observedAt: h.observedAt })
  expect(adopted, JSON.stringify(adopted)).toMatchObject({ status: 'completed' })
  expect((await h.detail()).bindings![0]!.acceptedChildren).toEqual({ ...base.subIssues, observedAt: base.observedAt })
  const done = completed(await h.app.sessionReport(h.execution.session, 'done-after-adoption', h.report))
  expect(done.task).toMatchObject({ progress: { stage: 'done', specificationVersion: h.report.specificationVersion }, completion: { specificationVersion: h.report.specificationVersion, executionId: h.execution.id, owner: h.execution.owner, epoch: h.execution.epoch } })
  expect((await h.detail()).task!.completion).toEqual(done.task!.completion)
  expect(await h.status()).toMatchObject({ enabled: true, planning: { enabledPlanVersion: 1 } })
})

it.each(scanEntries)('rejects adoption of the old observation after a newer Issue version arrives through %s', async entry => {
  const h = await managedObservation(entry)
  await h.scan('2026-10-22T09:00:00Z')
  const before = await h.detail()
  expect(before.bindings![0]!.lastObserved).toMatchObject({ observedAt: '2026-10-22T09:00:01Z', updatedAt: '2026-10-22T09:00:00Z', subIssues: base.subIssues })
  expect(await h.app.sessionOrganize(h.execution.session, 'reject-old-observation', { kind: 'source-children', expectedVersion: before.task!.version, observedAt: h.observedAt })).toMatchObject({ status: 'failed', error: { code: 'source-observation-superseded' } })
  const after = await h.detail()
  expect(after.task).toEqual(before.task)
  expect(after.bindings![0]!.acceptedChildren).toBeUndefined()
  expect(after.task!.completion).toBeUndefined()
  expect(await h.status()).toMatchObject({ enabled: true, planning: { enabledPlanVersion: 1 } })
})
