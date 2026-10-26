import { SourceError } from '../src/work-sources/errors.ts'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkApplication, WorkDao } from '../src/work.ts'
import type { WorkHost } from '../src/work.ts'
import type { ContinuousWorkRule, NativeWorkMessage, WorkCompleted, WorkExecution, WorkResult } from '../src/work-types.ts'
import type { GitHubIssue, GitHubSourcePort } from '../src/work-sources/types.ts'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) {
  const target = resolve(root)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('continuous-work-')) throw new Error('Unexpected temporary test root')
  await rm(target, { recursive: true, force: true })
} })
const operator = { operator: true }
const resource = { runtimeId: 'host', workspaceId: 'workspace' }
const model = { provider: 'fake', model: 'exact', reasoningEffort: 'high' }
const choices = { agentPresets: ['agent'], permissionPresets: ['safe'], models: [model], defaults: { agentPreset: 'agent', permissionPreset: 'safe', model } }
function completed(result: WorkResult): WorkCompleted { expect(result, JSON.stringify(result)).toHaveProperty('status', 'completed'); return result as WorkCompleted }
class Host implements WorkHost {
  authorize!: (session: string, messages?: readonly NativeWorkMessage[]) => Promise<import('../src/work-execution/host.ts').WorkAdmission>
  allowed = new Map<string, () => Promise<boolean>>()
  sessionsCreated = new Set<string>()
  statuses = new Map<string, 'running' | 'idle'>()
  settlements = new Map<string, 'settled' | 'pending' | 'unknown'>()
  deliveries = new Map<string, 'delivered' | 'consumed'>()
  ensures: string[] = []
  sends: string[] = []
  wakes: string[] = []
  failEnsure = 0
  failAfterCreation = 0
  failAfterDelivery = 0
  failAdmission = false
  resources = async () => [{ ref: resource, title: 'Workspace' }]
  sessions = async () => []
  execution: NonNullable<WorkHost['execution']> = {
    // An explicit deterministic host receipt, independent of runtime idle.
    observation: async execution => ({ settlement: this.settlements.get(execution.id) ?? 'unknown', sessions: [], blockers: [], reminders: [], limitations: [] }),
    maintain: async (execution, body) => { if (this.settlements.get(execution.id) !== 'settled') throw new Error('Related work is not settled'); return body() },
    connect: authorize => { this.authorize = authorize },
    choices: async () => choices,
    check: async () => { if (this.failAdmission) throw new Error('Catalog unavailable'); return choices },
    status: execution => this.statuses.get(execution.session.sessionId) ?? 'inactive',
    ensure: async (execution, allowed) => {
      this.ensures.push(execution.session.sessionId)
      if (this.failEnsure-- > 0) throw new Error('Unavailable host')
      this.sessionsCreated.add(execution.session.sessionId)
      this.allowed.set(execution.session.sessionId, allowed)
      this.statuses.set(execution.session.sessionId, 'idle')
      if (!this.settlements.has(execution.id)) this.settlements.set(execution.id, 'pending')
      if (this.failAfterCreation-- > 0) throw new Error('Created but receipt lost')
      return { runtimeId: 'host', cwd: '/workspace', agentPreset: 'agent', ...model, permissionPreset: 'safe', sandbox: 'workspace-write', approval: 'never' }
    },
    settle: async execution => { if (this.execution.status(execution) === 'running') throw new Error('Not yet idle') },
    wake: async execution => { this.wakes.push(execution.session.sessionId); if (await this.authorize(execution.session.sessionId) && await this.allowed.get(execution.session.sessionId)?.()) this.statuses.set(execution.session.sessionId, 'running') },
    observe: async (_execution, event) => this.deliveries.get(event.id) ?? 'accepted',
    deliver: async (execution, event) => {
      if (!this.deliveries.has(event.id)) { this.deliveries.set(event.id, 'delivered'); this.sends.push(event.id); this.statuses.set(execution.session.sessionId, 'running') }
      if (this.failAfterDelivery-- > 0) throw new Error('Delivered but receipt lost')
      return this.deliveries.get(event.id)!
    },
  }
  idle(execution: WorkExecution) { this.settlements.set(execution.id, 'settled'); this.statuses.set(execution.session.sessionId, 'idle'); for (const event of execution.events) if (this.deliveries.has(event.id)) this.deliveries.set(event.id, 'consumed') }
}
function issue(number: number, assignees = ['alice'], labels = ['ready']): GitHubIssue {
  return { subIssues: { items: [], totalCount: 0, hasNextPage: false }, nodeId: `ISSUE_${number}`, number, title: `Issue ${number}`, url: `https://github.com/acme/repo/issues/${number}`, body: 'Implement the agreed work.', repository: { owner: 'acme', repository: 'repo' }, assignees, labels, state: 'open', updatedAt: '2026-01-01T00:00:00.000Z', observedAt: '2026-01-01T00:00:00.000Z' }
}
async function setup(enable = true, planner?: import('../src/work-planning.ts').WorkPlanner, repository = false) {
  const directory = await mkdtemp(join(tmpdir(), 'continuous-work-')); roots.push(directory)
  const host = new Host()
  const remote = { identity: { login: 'alice', nodeId: 'ALICE', name: null }, issues: [issue(1), issue(2), issue(3, ['bob']), issue(4, ['alice'], ['other'])] }
  const source: GitHubSourcePort = {
    identify: async url => ({ kind: 'repository', nodeId: 'REPO', title: 'acme/repo', url, entryUrl: url, identity: remote.identity, repository: { owner: 'acme', repository: 'repo' } }),
    list: async (_repository, request) => {
      if (!repository) throw new Error('Project only')
      const issues = remote.issues.filter(issue => (request.state === 'all' || issue.state === request.state) && (request.assignee === '*' || issue.assignees.includes(remote.identity.login)))
      const start = (request.page - 1) * 2
      return { identity: remote.identity, items: issues.slice(start, start + 2), ...(start + 2 < issues.length ? { nextPage: request.page + 1 } : {}), observedAt: '2026-01-01T00:00:00.000Z' }
    }, detail: async () => { throw new Error('Project only') },
    project: async () => ({ identity: remote.identity, project: { nodeId: 'PROJECT', title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/1', closed: false },
      items: remote.issues.map(issue => ({ id: `ITEM_${issue.nodeId}`, kind: 'issue', archived: false, issueNodeId: issue.nodeId, fields: [], fieldsPartial: false })), issues: remote.issues, observedAt: '2026-01-01T00:00:00.000Z' }),
  }
  const app = new WorkApplication(directory, host, source, planner)
  const connection = completed(await app.execute(repository ? { type: 'source.connect', commandId: 'connect', url: 'https://github.com/acme/repo' } : { type: 'source.connect', commandId: 'connect', githubProject: { owner: 'acme', type: 'org', number: 1 } }, operator))
  const scope = { projectId: connection.project!.id, sourceId: connection.source!.id }
  const refresh = () => app.query({ type: 'source.issues', ...scope, page: 1, perPage: 100, assignee: '@me', state: 'open', refresh: true }, operator)
  completed(await refresh())
  const configure = { type: 'continuous.configure' as const, commandId: 'configure', ...scope, expectedVersion: 0, assignee: '@me' as const, labels: ['ready'], resource, model, agentPreset: 'agent', permissionPreset: 'safe', enabled: enable }
  const status = async (current = app): Promise<ContinuousWorkRule> => completed(await current.query({ type: 'continuous.status', ...scope }, operator)).continuousRule!
  const execution = async (ref?: WorkExecution['ref'], current = app): Promise<WorkExecution> => completed(await current.query({ type: 'task.execution', ref: ref ?? (await status()).active! }, operator)).execution!
  return { directory, host, remote, source, app, connection, scope, refresh, configure, status, execution }
}
const fence = (execution: WorkExecution) => ({ ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch })
async function reportDone(app: WorkApplication, execution: WorkExecution) {
  const detail = completed(await app.query({ type: 'task.detail', ref: execution.ref }, operator))
  const updated = detail.task!.specification.acceptance.length ? detail : completed(await app.execute({ type: 'task.update-spec', commandId: `spec:${execution.id}`, ref: execution.ref, expectedVersion: detail.task!.version, goal: 'Accepted goal', specification: 'Accepted scope', acceptance: ['Pass check'] }, operator))
  return app.execute({ type: 'task.report', commandId: `done:${execution.id}`, ...fence(execution), report: { specificationVersion: updated.task!.specification.version, stage: 'done', summary: 'Accepted completion', next: '', blockers: [], criteria: [{ index: 0, passed: true, evidence: ['check passed'] }] } }, operator)
}

it('returns the authoritative execution graph through detail and execution without advancing work', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator))
  const execution = await h.execution()
  const calls = { ensures: h.host.ensures.length, sends: h.host.sends.length, wakes: h.host.wakes.length }
  for (const type of ['task.detail', 'task.execution'] as const) {
    expect(completed(await h.app.query({ type, ref: execution.ref }, operator))).toMatchObject({
      executionGraph: { ref: execution.ref, executionId: execution.id, owner: { id: execution.owner, epoch: execution.epoch, agentId: execution.agentId }, currentSession: execution.session, settlement: 'pending', childTasks: [] },
    })
  }
  expect({ ensures: h.host.ensures.length, sends: h.host.sends.length, wakes: h.host.wakes.length }).toEqual(calls)
})

it('keeps native Issue children separate and resolves each canonical child execution authority', async () => {
  const h = await setup(false)
  completed(await h.app.execute(h.configure, operator))
  h.remote.issues[0]!.subIssues = { items: [issue(2), issue(99)].map(({nodeId,url,number,title,repository,state}) => ({nodeId,url,number,title,repository,state})), totalCount: 2, hasNextPage: false }
  await h.refresh()
  const parent = completed(await h.app.execute({ type: 'source.import', commandId: 'native-parent', ...h.scope, nodeId: 'ISSUE_1' }, operator))
  const child = completed(await h.app.execute({ type: 'source.import', commandId: 'native-child', ...h.scope, nodeId: 'ISSUE_2' }, operator))
  const execution = completed(await h.app.execute({ type: 'task.start', commandId: 'native-child-start', ref: child.ref!, expectedVersion: child.task!.version, agentId: child.task!.agentId, resource, model, agentPreset: 'agent', permissionPreset: 'safe' }, operator)).execution!
  const detail = completed(await h.app.query({ type: 'task.detail', ref: parent.ref! }, operator))
  expect(detail.executionGraph).toMatchObject({
    childTasks: [expect.objectContaining({ ref: child.ref, owner: execution.owner, epoch: execution.epoch, currentSession: execution.session })],
    nativeIssues: [expect.objectContaining({ ref: child.ref, owner: execution.owner, currentSession: execution.session, status: 'started' }), expect.objectContaining({ issue: { nodeId: 'ISSUE_99', number: 99, title: 'Issue 99', url: 'https://github.com/acme/repo/issues/99', repository: { owner: 'acme', repository: 'repo' }, state: 'open' }, status: 'unread' })],
  })
  expect(detail.executionGraph!.sessions).toEqual([])
  expect(completed(await h.app.query({ type: 'project.detail', projectId: h.scope.projectId }, operator)).tasks).toHaveLength(2)
  delete h.remote.issues[0]!.subIssues
  await h.refresh()
  const partial = completed(await h.app.query({ type: 'task.detail', ref: parent.ref! }, operator)).executionGraph!
  expect(partial.nativeIssues?.map(item => item.issue.nodeId)).toEqual(['ISSUE_2', 'ISSUE_99'])
  expect(partial.limitations).toContainEqual(expect.stringContaining('最后已知'))
  const retained = h.remote.issues[0]!
  retained.updatedAt = '2026-01-02T00:00:00.000Z'
  retained.observedAt = '2026-01-02T00:00:00.000Z'
  completed(await h.refresh())
  const newer = completed(await h.app.query({ type: 'task.detail', ref: parent.ref! }, operator)).executionGraph!
  expect(newer.nativeIssues?.map(item => item.issue.nodeId)).toEqual(['ISSUE_2', 'ISSUE_99'])
  expect(newer.limitations).toContainEqual(expect.stringContaining('最后已知'))

  retained.subIssues = { items: [], totalCount: 0, hasNextPage: false }
  retained.updatedAt = '2026-01-03T00:00:00.000Z'
  retained.observedAt = '2026-01-03T00:00:00.000Z'
  completed(await h.refresh())
  const fresh = completed(await h.app.query({ type: 'task.detail', ref: parent.ref! }, operator)).executionGraph!
  expect(fresh.nativeIssues).toEqual([])
  expect(fresh.limitations).not.toContainEqual(expect.stringContaining('最后已知'))
})

it('browses without execution and atomically reuses source connection, exact settings, duplicate discovery and command retries', async () => {
  const h = await setup()
  expect(h.host.sessionsCreated.size).toBe(0)
  const options = completed(await h.app.query({ type: 'source.execution-options', ...h.scope }, operator))
  expect(options.executionOptions).toMatchObject({ resources: [{ ref: resource }], models: [model] })
  const duplicate = completed(await h.app.execute({ type: 'source.connect', commandId: 'again', githubProject: { owner: 'ACME', type: 'org', number: 1 } }, operator))
  expect(duplicate.project!.id).toBe(h.scope.projectId); expect(duplicate.source!.id).toBe(h.scope.sourceId)
  completed(await h.app.execute(h.configure, operator))
  const first = await h.execution()
  expect(first).toMatchObject({ model, resource, agentPreset: 'agent', permissionPreset: 'safe' })
  expect((await h.status()).items.map(item => [item.number, item.state])).toEqual([[1, 'active'], [2, 'queued']])
  await Promise.all([h.app.reconcileContinuous(), h.app.reconcileControls(), h.app.execute(h.configure, operator), h.refresh()])
  expect(h.host.sessionsCreated.size).toBe(1); expect(h.host.sends).toHaveLength(1)
  expect(await h.host.authorize(first.session.sessionId)).toBe(true)
  expect(await h.host.allowed.get(first.session.sessionId)!()).toBe(true)
  expect(await h.app.execute({ ...h.configure, commandId: 'stale' }, operator)).toMatchObject({ status: 'conflict', error: { currentVersion: 1 } })
})

it('pauses only new intake, retains active work, completes only at actual host idle and never restarts completed issues', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator))
  const first = await h.execution()
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'pause-intake', ...h.scope, expectedVersion: 1, enabled: false }, operator))
  expect((await h.status()).active).toEqual(first.ref)
  expect(await reportDone(h.app, first)).toMatchObject({ status: 'failed', error: { code: 'completion-results-unsettled' } })
  await h.app.reconcileControls()
  expect((await h.status()).active).toEqual(first.ref)
  expect(await h.host.authorize(first.session.sessionId)).toBe(true)
  expect(completed(await h.app.query({ type: 'task.detail', ref: first.ref }, operator)).task!.completion).toBeUndefined()
  h.host.idle(first); completed(await reportDone(h.app, first)); await h.app.reconcileControls()
  expect((await h.status()).active).toBeUndefined(); expect((await h.status()).items[0]!.state).toBe('completed')
  expect(h.host.sessionsCreated.size).toBe(1)
  expect(await h.app.execute({ type: 'task.input', commandId: 'late-input', ...fence(first), text: 'Restart', kind: 'input' }, operator)).toMatchObject({ status: 'failed', error: { code: 'continuous-completed' } })
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'enable-intake', ...h.scope, expectedVersion: 2, enabled: true }, operator))
  expect((await h.status()).items.map(item => item.state)).toEqual(['completed', 'active'])
  await h.refresh(); await h.app.reconcileControls()
  expect(h.host.sessionsCreated.size).toBe(2)
})

it('waiting yields after the safe boundary, and public/native input plus resume cannot bypass the occupied slot', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  completed(await h.app.sessionControl(first.session, 'wait-first', 'wait', 'Need a decision'))
  await h.app.reconcileControls(); expect((await h.status()).active).toEqual(first.ref)
  h.host.idle(first); await h.app.reconcileControls(); const second = await h.execution()
  expect(second.id).not.toBe(first.id)
  expect((await h.execution(first.ref)).owner).toBe(first.owner)
  completed(await h.app.execute({ type: 'task.input', commandId: 'answer-first', ...fence(first), text: 'Decision arrived', kind: 'input' }, operator))
  completed(await h.app.execute({ type: 'task.control', commandId: 'resume-first', ...fence(first), action: 'resume', text: 'Use the answer' }, operator))
  expect(await h.host.authorize(first.session.sessionId, [{ id: 'native-answer', role: 'user', content: [{ type: 'text', text: 'Native answer' }], source: { kind: 'user' } }])).toBe(false)
  expect(await h.host.allowed.get(first.session.sessionId)!()).toBe(false)
  await h.app.reconcileControls(); expect(h.host.sends).toHaveLength(2); expect(h.host.wakes).toHaveLength(0)
  completed(await h.app.sessionControl(second.session, 'wait-second', 'wait', 'Need another decision'))
  h.host.idle(second); await h.app.reconcileControls()
  expect((await h.status()).active).toEqual(first.ref)
  expect(h.host.sessionsCreated.size).toBe(2)
  expect(await h.host.authorize(first.session.sessionId)).toBe(true)
  const resumed = await h.execution(first.ref)
  expect(resumed).toMatchObject({ owner: first.owner, epoch: first.epoch, state: 'ready' })
  expect(resumed.events.filter(event => event.id === 'native-answer')).toHaveLength(1)
  expect(h.host.sends).toHaveLength(5)
})

it('requires explicit recovery of an unknown create outcome and retains the execution and Session after restart', async () => {
  const h = await setup(); h.host.failAfterCreation = 1
  completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  expect(first.state).toBe('failed'); expect(h.host.sessionsCreated.size).toBe(1)
  const restored = new WorkApplication(h.directory, h.host, h.source)
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 120_000)
  completed(await restored.execute({ type: 'task.reconcile', commandId: 'explicit-create-recovery', ...fence(first) }, operator))
  await restored.reconcileControls()
  expect(await h.execution(first.ref, restored)).toMatchObject({ id: first.id, session: first.session, owner: first.owner, state: 'ready' })
  expect(h.host.sessionsCreated.size).toBe(1); expect(h.host.sends).toEqual([`kickoff:${first.id}`])
  await restored.reconcileControls(); expect(h.host.sends).toHaveLength(1)
})

it('records host failures for manual recovery without automatically retrying sessions', async () => {
  const h = await setup(); h.host.failEnsure = 100
  completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now)
  for (let tick = 0; tick < 3; tick++) { now += 120_000; await h.app.reconcileControls() }
  const rule = await h.status()
  expect(rule.items[0]).toMatchObject({ state: 'blocked', attempts: 1, reason: expect.stringContaining('unknown') })
  expect(h.host.ensures.filter(id => id === first.session.sessionId)).toHaveLength(1)
  expect(h.host.sends).toHaveLength(0)
  expect(rule.items[1]!.state).toBe('blocked')
})

it('blocks changed credential identity and disabled sources without losing existing queue or task owners', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  h.remote.identity = { login: 'bob', nodeId: 'BOB', name: null }; completed(await h.refresh())
  await h.app.reconcileControls()
  expect((await h.status()).scope.identity).toEqual({ login: 'alice', nodeId: 'ALICE' })
  expect((await h.status()).error?.code).toBe('github-identity-changed')
  completed(await h.app.sessionControl(first.session, 'wait', 'wait', 'Waiting'))
  h.host.idle(first); await h.app.reconcileControls()
  expect((await h.status()).active).toBeUndefined(); expect(h.host.sessionsCreated.size).toBe(1)
  const source = completed(await h.app.query({ type: 'source.list', projectId: h.scope.projectId }, operator)).sources![0]!
  completed(await h.app.execute({ type: 'source.set-enabled', commandId: 'disable-source', ...h.scope, expectedVersion: source.version, enabled: false }, operator))
  await h.app.reconcileControls()
  expect((await h.status()).error?.code).toBe('source-disabled')
  expect((await h.status()).items).toHaveLength(2)
  expect((await h.execution(first.ref)).owner).toBe(first.owner)
})

it('gives one bounded followup to new semantic progress then blocks repeated idle progress without spinning', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  const report = { specificationVersion: 1, stage: 'in-progress', summary: 'Implemented parser', next: 'Add validation tests', blockers: [], criteria: [] }
  completed(await h.app.execute({ type: 'task.report', commandId: 'progress-one', ...fence(first), report }, operator))
  h.host.idle(first); await h.app.reconcileControls()
  expect(h.host.sends).toHaveLength(2)
  expect((await h.status()).items[0]!.followups).toHaveLength(1)
  const advanced = await h.execution(first.ref)
  completed(await h.app.execute({ type: 'task.report', commandId: 'same-progress-new-time', ...fence(first), report }, operator))
  h.host.idle(advanced); await h.app.reconcileControls()
  expect((await h.status()).items[0]).toMatchObject({ state: 'blocked', reason: expect.stringContaining('idle') })
  expect((await h.status()).items[1]!.state).toBe('active')
  const before = h.host.sends.length
  await h.app.reconcileControls(); await h.app.reconcileControls()
  expect(h.host.sends).toHaveLength(before)
})

it('keeps version-three snapshots backward compatible and never starts unconfigured observations', async () => {
  const h = await setup(false)
  const before = JSON.parse(await readFile(join(h.directory, 'work-v3.json'), 'utf8'))
  expect(before).not.toHaveProperty('continuousRules')
  await h.app.reconcileSources(); await h.app.reconcileControls()
  expect(h.host.sessionsCreated.size).toBe(0)
  const projects = completed(await h.app.query({ type: 'projects.list' }, operator)).projects!
  expect(projects[0]!.name).toBe('Roadmap')
  completed(await h.app.execute(h.configure, operator))
  expect((await h.status()).items).toHaveLength(2)
  expect(h.host.sessionsCreated.size).toBe(0)
})


it('retains an explicit pause despite native and public replies until a serialized explicit resume', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  completed(await h.app.sessionControl(first.session, 'pause-first', 'pause', 'Explicit pause'))
  // Input arriving before the stop is applied cannot cancel the accepted pause.
  completed(await h.app.execute({ type: 'task.input', commandId: 'during-pause', ...fence(first), text: 'Queued during pause', kind: 'result' }, operator))
  h.host.idle(first); await h.app.reconcileControls(); const second = await h.execution()
  expect((await h.status()).items[0]!.state).toBe('paused')
  completed(await h.app.execute({ type: 'task.input', commandId: 'paused-answer', ...fence(first), text: 'Queued reply', kind: 'input' }, operator))
  expect(await h.host.authorize(first.session.sessionId, [{ id: 'paused-native', role: 'user', content: [{ type: 'text', text: 'Native reply' }], source: { kind: 'user' } }])).toBe(false)
  expect((await h.status()).items[0]!.resumeRequested).not.toBe(true)
  completed(await h.app.sessionControl(second.session, 'wait-second', 'wait', 'Waiting'))
  h.host.idle(second); await h.app.reconcileControls()
  expect((await h.status()).active).toBeUndefined(); expect(h.host.sends).toHaveLength(2)
  completed(await h.app.execute({ type: 'task.control', commandId: 'explicit-resume', ...fence(first), action: 'resume', text: 'Process queued replies' }, operator))
  expect(h.host.sends).toHaveLength(2)
  await h.app.reconcileControls()
  expect((await h.status()).active).toEqual(first.ref)
  expect(h.host.sends).toHaveLength(6)
})

it('rechecks Project membership and labels atomically after asynchronous host admission', async () => {
  const h = await setup(false); completed(await h.app.execute(h.configure, operator))
  const original = h.host.execution.check
  vi.spyOn(h.host.execution, 'check').mockImplementationOnce(async request => {
    h.remote.issues = [issue(1, ['alice'], ['other']), issue(2, ['alice'], ['other'])]
    completed(await h.refresh())
    return original(request)
  })
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'enable-after-scope-change', ...h.scope, expectedVersion: 1, enabled: true }, operator))
  expect(h.host.sessionsCreated.size).toBe(0)
  expect((await h.status()).items.map(item => item.state)).toEqual(['skipped', 'skipped'])
})

it('holds a completed slot while host settling fails and never admits the next issue early', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  h.host.idle(first); completed(await reportDone(h.app, first))
  const original = h.host.execution.maintain
  vi.spyOn(h.host.execution, 'maintain').mockImplementation(async () => { throw new Error('Host maintenance unavailable') })
  await h.app.reconcileControls()
  expect((await h.status()).active).toEqual(first.ref)
  expect(h.host.sessionsCreated.size).toBe(1)
  expect(await h.host.authorize(first.session.sessionId)).toBe(false)
  h.host.execution.maintain = original
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000)
  await h.app.reconcileControls()
  expect((await h.status()).items[0]!.state).toBe('completed')
  expect(h.host.sessionsCreated.size).toBe(2)
})


it('replays committed configuration without repeating host admission when catalogs become unavailable', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator))
  const before = await h.status(); h.host.failAdmission = true
  completed(await h.app.execute(h.configure, operator))
  expect((await h.status()).id).toBe(before.id)
  expect((await h.status()).version).toBe(before.version)
  expect(h.host.sessionsCreated.size).toBe(1)
})

it('recovers a lost delivery receipt without sending a second kickoff or creating a second Session', async () => {
  const h = await setup(); h.host.failAfterDelivery = 1
  completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  expect(first.state).toBe('failed'); expect(h.host.sends).toHaveLength(1)
  h.host.idle(first)
  const restored = new WorkApplication(h.directory, h.host, h.source)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000)
  await restored.reconcileControls()
  expect(await h.execution(first.ref, restored)).toMatchObject({ id: first.id, session: first.session, events: [{ id: `kickoff:${first.id}`, delivery: 'consumed' }] })
  expect(h.host.sends).toHaveLength(2); expect(h.host.sessionsCreated.size).toBe(2)
  expect(h.host.ensures.filter(id => id === first.session.sessionId)).toHaveLength(1)
  expect((await h.status(restored)).items[0]!.state).toBe('blocked')
})

it('freezes completed managed acceptance against later specification or report mutations', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  h.host.idle(first); completed(await reportDone(h.app, first))
  const task = completed(await h.app.query({ type: 'task.detail', ref: first.ref }, operator)).task!
  expect(await h.app.execute({ type: 'task.update-spec', commandId: 'after-done-spec', ref: first.ref, expectedVersion: task.version, goal: 'Changed goal', specification: 'Changed spec', acceptance: ['More work'] }, operator)).toMatchObject({ status: 'failed', error: { code: 'continuous-completed' } })
  expect(await h.app.execute({ type: 'task.report', commandId: 'after-done-report', ...fence(first), report: { specificationVersion: task.specification.version, stage: 'in-progress', summary: 'Restart', next: 'More work', blockers: [], criteria: [] } }, operator)).toMatchObject({ status: 'failed', error: { code: 'continuous-completed' } })
})

it('persists a natural language model plan without dispatching on preview or restart', async () => {
  const generate = vi.fn(async (_basis: import('../src/work-planning.ts').PlanningBasis) => ({ steps: [{ nodeId: 'ISSUE_2', why: '先做第二项', nextAction: '核对完整要求', mode: 'new' }, { nodeId: 'ISSUE_1', why: '随后处理', nextAction: '实施并验收', mode: 'new' }] }))
  const h = await setup(false, { generate }); completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'instruction', ...h.scope, expectedVersion: 1, text: '先推进第二项，再处理第一项。' }, operator))
  const preview = { type: 'continuous.preview', commandId: 'preview', ...h.scope, expectedVersion: 2 }
  completed(await h.app.execute(preview, operator))
  const rule = await h.status()
  expect(rule.planning).toMatchObject({ instruction: '先推进第二项，再处理第一项。', plans: [{ version: 1, steps: [{ nodeId: 'ISSUE_2' }, { nodeId: 'ISSUE_1' }] }] })
  expect(generate).toHaveBeenCalledTimes(1)
  expect(generate.mock.calls[0]![0].candidates[0]!.issue).not.toHaveProperty('body')
  expect(generate.mock.calls[0]![0].candidates[0]!.issue).toMatchObject({ nodeId: 'ISSUE_1', title: 'Issue 1' })
  expect(h.host.sends).toHaveLength(0)
  await h.app.execute(preview, operator)
  const restored = new WorkApplication(h.directory, h.host, h.source, { generate })
  await restored.reconcileControls()
  expect((await h.status(restored)).planning).toEqual(rule.planning)
  expect(generate).toHaveBeenCalledTimes(1); expect(h.host.sessionsCreated.size).toBe(0)
})

it('rejects blocked, foreign, malformed and assignee-violating model plans with named errors', async () => {
  let output: unknown = { steps: [] }
  const h = await setup(false, { generate: async () => output }); completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'instruction', ...h.scope, expectedVersion: 1, text: '处理我的工作' }, operator))
  completed(await h.app.execute({ type: 'continuous.block', commandId: 'block', ...h.scope, expectedVersion: 2, nodeId: 'ISSUE_1', blocked: true }, operator))
  for (const [nodeId, code] of [['ISSUE_1', 'planning-blocked-issue'], ['FOREIGN', 'planning-outside-source'], ['ISSUE_3', 'planning-outside-scope']]) {
    output = { steps: [{ nodeId, why: 'reason', nextAction: 'work', mode: 'new' }] }
    expect(await h.app.execute({ type: 'continuous.preview', commandId: `preview:${nodeId}`, ...h.scope, expectedVersion: 3 }, operator)).toMatchObject({ status: 'failed', error: { code } })
  }
  output = { steps: [{ number: 1 }] }
  expect(await h.app.execute({ type: 'continuous.preview', commandId: 'malformed', ...h.scope, expectedVersion: 3 }, operator)).toMatchObject({ status: 'failed', error: { code: 'planning-malformed' } })
  const restored = new WorkApplication(h.directory, h.host, h.source)
  expect((await h.status(restored)).planning?.blocks).toEqual(['ISSUE_1'])
  expect(h.host.sends).toHaveLength(0)
})

it('enables only a reviewed plan and dispatches its order while Block fences future intake', async () => {
  const h = await setup(false, { generate: async () => ({ steps: [2, 1].map(number => ({ nodeId: `ISSUE_${number}`, why: '按委托优先级', nextAction: '实施', mode: 'new' })) }) })
  completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'instruct', ...h.scope, expectedVersion: 1, text: '先第二项' }, operator))
  expect(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'too-early', ...h.scope, expectedVersion: 2, enabled: true }, operator)).toMatchObject({ status: 'failed', error: { code: 'planning-preview-required' } })
  completed(await h.app.execute({ type: 'continuous.preview', commandId: 'preview', ...h.scope, expectedVersion: 2 }, operator))
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'enable-plan', ...h.scope, expectedVersion: 3, enabled: true }, operator))
  const first = await h.execution()
  expect((await h.status()).items.find(item => item.state === 'active')?.nodeId).toBe('ISSUE_2')
  completed(await h.app.execute({ type: 'continuous.block', commandId: 'block-next', ...h.scope, expectedVersion: 4, nodeId: 'ISSUE_1', blocked: true }, operator))
  h.host.idle(first); completed(await reportDone(h.app, first)); await h.app.reconcileControls()
  expect(h.host.sessionsCreated.size).toBe(1)
  expect((await h.status()).items.find(item => item.nodeId === 'ISSUE_1')?.reason).toContain('Block')
})

it('retains canonical resource conflicts across refresh and admits later eligible work without retry loops', async () => {
  const h = await setup(false)
  h.host.resources = async () => [{ ref: resource, title: 'Workspace' }, { ref: { ...resource, workspaceId: 'other-workspace' }, title: 'Other workspace' }]
  const project = completed(await h.app.query({ type: 'project.detail', projectId: h.scope.projectId }, operator)).project!
  completed(await h.app.execute({ type: 'project.attach-resource', commandId: 'conflict-resource', projectId: project.id, expectedVersion: project.version, resource: { ...resource, workspaceId: 'other-workspace' } }, operator))
  h.remote.issues[2]!.assignees = ['alice']; completed(await h.refresh())
  for (const number of [1, 2]) {
    const imported = completed(await h.app.execute({ type: 'source.import', commandId: `conflict-import-${number}`, ...h.scope, nodeId: `ISSUE_${number}` }, operator))
    completed(await h.app.execute({ type: 'task.start', commandId: `conflict-start-${number}`, ref: imported.ref!, expectedVersion: imported.task!.version, agentId: imported.task!.agentId, resource: { ...resource, workspaceId: 'other-workspace' }, model, agentPreset: 'agent', permissionPreset: 'safe' }, operator))
  }
  completed(await h.app.execute({ ...h.configure, enabled: true, queue: { concurrency: 2, refreshMinutes: 10, order: 'oldest' } }, operator))
  await h.app.reconcileContinuous(); await h.app.reconcileContinuous()
  const rule = await h.status()
  expect(rule.items.filter(item => ['ISSUE_1','ISSUE_2'].includes(item.nodeId))).toEqual(expect.arrayContaining([
    expect.objectContaining({nodeId:'ISSUE_1',state:'waiting',reason:expect.stringContaining('another authorized resource')}),
    expect.objectContaining({nodeId:'ISSUE_2',state:'waiting',reason:expect.stringContaining('another authorized resource')}),
  ]))
  expect(rule.items.find(item => item.nodeId === 'ISSUE_3')?.state).toBe('active')
  completed(await h.app.execute({ type: 'continuous.refresh', commandId: 'preserve-resource-conflicts', ...h.scope, expectedVersion: rule.version }, operator))
  expect((await h.status()).items.filter(item => ['ISSUE_1','ISSUE_2'].includes(item.nodeId)).map(item => item.state)).toEqual(['waiting','waiting'])
  expect(h.host.sessionsCreated.size).toBe(3)
})

it('adopts canonical existing execution without changing owner epoch resource or Session', async () => {
  const h = await setup(false, { generate: async () => ({ steps: [{ nodeId: 'ISSUE_1', why: '继续现有工作', nextAction: '沿已有会话推进', mode: 'existing' }] }) })
  completed(await h.app.execute(h.configure, operator))
  const imported = completed(await h.app.execute({ type: 'source.import', commandId: 'manual-import', ...h.scope, nodeId: 'ISSUE_1' }, operator))
  const started = completed(await h.app.execute({ type: 'task.start', commandId: 'manual-start', ref: imported.ref, expectedVersion: imported.task!.version, agentId: imported.task!.agentId, resource, model, agentPreset: 'agent', permissionPreset: 'safe' }, operator)).execution!
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'instruct', ...h.scope, expectedVersion: 1, text: '继续已有工作' }, operator))
  const hostCalls = { ensures: h.host.ensures.length, sends: h.host.sends.length, wakes: h.host.wakes.length }
  completed(await h.app.execute({ type: 'continuous.preview', commandId: 'preview', ...h.scope, expectedVersion: 2 }, operator))
  expect((await h.status()).items.every(item => !item.ref)).toBe(true)
  expect(await h.host.authorize(started.session.sessionId)).toBe(true)
  expect({ ensures: h.host.ensures.length, sends: h.host.sends.length, wakes: h.host.wakes.length }).toEqual(hostCalls)
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'enable', ...h.scope, expectedVersion: 3, enabled: true }, operator))
  expect((await h.status()).active).toEqual(started.ref)
  expect(await h.execution()).toMatchObject({ id: started.id, owner: started.owner, epoch: started.epoch, session: started.session, resource: started.resource })
  expect(h.host.sessionsCreated.size).toBe(1); expect(h.host.sends).toHaveLength(1)
})

it('completes preview across a discovery tick while the model is generating', async () => {
  let h!: Awaited<ReturnType<typeof setup>>
  const generate = vi.fn(async (basis: import('../src/work-planning.ts').PlanningBasis) => {
    const before = completed(await h.app.query({ type: 'source.list', projectId: h.scope.projectId }, operator)).sources![0]!
    expect(basis.source).not.toHaveProperty('sequence')
    expect(basis.source).not.toHaveProperty('discovery')
    // Reach the scheduled scan without coupling preview coverage to the polling interval.
    vi.spyOn(Date, 'now').mockReturnValue(Math.max(Date.now(), Date.parse(before.discovery!.nextAttemptAt)) + 1)
    await h.app.reconcileSources()
    const fresh = completed(await h.app.query({ type: 'source.list', projectId: h.scope.projectId }, operator)).sources![0]!
    expect(fresh.sequence).toBeGreaterThan(before.sequence)
    expect(fresh.discovery!.nextAttemptAt).not.toBe(before.discovery!.nextAttemptAt)
    expect(fresh.observations.map(observation => observation.issue)).toEqual(before.observations.map(observation => observation.issue))
    expect(fresh.projectSnapshot).toEqual(before.projectSnapshot)
    return { steps: [{ nodeId: 'ISSUE_1', why: 'Within scope', nextAction: 'Work', mode: 'new' }] }
  })
  h = await setup(false, { generate })
  completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'tick-instruct', ...h.scope, expectedVersion: 1, text: '处理我的工作' }, operator))
  completed(await h.app.execute({ type: 'continuous.preview', commandId: 'tick-preview', ...h.scope, expectedVersion: 2 }, operator))
  expect((await h.status()).planning?.plans).toHaveLength(1)
  expect(generate).toHaveBeenCalledTimes(1)
  expect(h.host.sessionsCreated.size).toBe(0)
})

it('discards preview when a candidate gains a canonical Task identity during generation', async () => {
  let h!: Awaited<ReturnType<typeof setup>>
  h = await setup(false, { generate: async () => {
    completed(await h.app.execute({ type: 'source.import', commandId: 'import-during-preview', ...h.scope, nodeId: 'ISSUE_1' }, operator))
    return { steps: [{ nodeId: 'ISSUE_1', why: 'Observe', nextAction: 'Wait', mode: 'wait' }] }
  } })
  completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'identity-instruct', ...h.scope, expectedVersion: 1, text: '处理我的工作' }, operator))
  expect(await h.app.execute({ type: 'continuous.preview', commandId: 'identity-preview', ...h.scope, expectedVersion: 2 }, operator)).toMatchObject({ status: 'failed', error: { code: 'planning-basis-changed' } })
  expect((await h.status()).planning?.plans).toHaveLength(0)
})

it('validates the latest Issue scope after model generation despite stable identities', async () => {
  let h!: Awaited<ReturnType<typeof setup>>
  h = await setup(false, { generate: async () => {
    h.remote.issues[0]!.labels = ['other']
    completed(await h.refresh())
    return { steps: [{ nodeId: 'ISSUE_1', why: 'Was in scope', nextAction: 'Work', mode: 'new' }] }
  } })
  completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'scope-instruct', ...h.scope, expectedVersion: 1, text: '处理我的工作' }, operator))
  expect(await h.app.execute({ type: 'continuous.preview', commandId: 'scope-preview', ...h.scope, expectedVersion: 2 }, operator)).toMatchObject({ status: 'failed', error: { code: 'planning-outside-scope' } })
  expect((await h.status()).planning?.plans).toHaveLength(0)
})

it.each(['error', 'string', 'sensitive'] as const)('reports a distinct model failure with a safe summary (%s)', async kind => {
  let h!: Awaited<ReturnType<typeof setup>>
  let requestCharacters = 0, candidateCount = 0
  h = await setup(false, { generate: async basis => {
    requestCharacters = JSON.stringify(basis).length
    candidateCount = basis.candidates.length
    // A concurrent canonical change must not hide the actual model failure.
    completed(await h.app.execute({ type: 'source.import', commandId: 'failure-import', ...h.scope, nodeId: 'ISSUE_1' }, operator))
    if (kind === 'string') throw 'upstream rate limit (429)'
    if (kind === 'sensitive') throw new Error('upstream rate limit (429) api_key=private-value Bearer private-bearer sk-12345678901234567890 at /private/config.json and C:\\private\\config.json https://user:password@model.example/api?token=private-query\nstack /private/stack.ts')
    throw new Error('upstream rate limit (429)')
  } })
  completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'failure-instruct', ...h.scope, expectedVersion: 1, text: '处理我的工作' }, operator))
  const result = await h.app.execute({ type: 'continuous.preview', commandId: 'failure-preview', ...h.scope, expectedVersion: 2 }, operator)
  expect(result).toMatchObject({ status: 'failed', error: { code: 'planning-model-failed', message: expect.stringContaining('upstream rate limit (429)') } })
  if (result.status !== 'failed') throw new Error('Expected failure')
  expect(result.error.message).toContain(`requestCharacters=${requestCharacters}`)
  expect(result.error.message).toContain(`candidates=${candidateCount}`)
  for (const secret of ['private-value', 'private-bearer', 'sk-12345678901234567890', '/private/', 'C:\\private', 'password@', 'private-query']) expect(result.error.message).not.toContain(secret)
  expect(result.error.message.length).toBeLessThanOrEqual(550)
  const restored = new WorkApplication(h.directory, h.host, h.source)
  expect((await h.status(restored)).planning?.error).toEqual(result.error)
  expect((await h.status()).planning?.plans).toHaveLength(0)
})

it('fences a model response when Block changes while generation is in flight', async () => {
  let release!: (output: unknown) => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const h = await setup(false, { generate: async () => { entered(); return new Promise(resolve => { release = resolve }) } })
  completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'instruct', ...h.scope, expectedVersion: 1, text: '处理我的工作' }, operator))
  const preview = h.app.execute({ type: 'continuous.preview', commandId: 'slow-preview', ...h.scope, expectedVersion: 2 }, operator)
  await started
  completed(await h.app.execute({ type: 'continuous.block', commandId: 'block-during-preview', ...h.scope, expectedVersion: 2, nodeId: 'ISSUE_1', blocked: true }, operator))
  release({ steps: [{ nodeId: 'ISSUE_1', why: 'reason', nextAction: 'work', mode: 'new' }] })
  expect(await preview).toMatchObject({ status: 'conflict', error: { code: 'version-conflict' } })
  expect((await h.status()).planning?.plans).toHaveLength(0)
  expect(h.host.sessionsCreated.size).toBe(0)
})

it('returns one Project queue across sources and requires an explicit scope switch', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const original = await h.execution()
  const second = completed(await h.app.execute({ type: 'source.configure-project', commandId: 'second-source', projectId: h.scope.projectId, githubProject: { owner: 'acme', type: 'org', number: 2 } }, operator)).source!
  const scope = { projectId: h.scope.projectId, sourceId: second.id }
  const before = await h.status()
  expect(completed(await h.app.query({ type: 'continuous.status', ...scope }, operator)).continuousRule).toEqual(before)
  expect(await h.app.execute({ ...h.configure, ...scope, commandId: 'configure-second', expectedVersion: 1, enabled: false }, operator)).toMatchObject({ status: 'failed', error: { code: 'continuous-source-mismatch' } })
  completed(await h.app.query({ type: 'source.issues', ...scope, page: 1, perPage: 100, assignee: '@me', state: 'open', refresh: true }, operator))
  completed(await h.app.execute({ ...h.configure, ...scope, commandId: 'switch-scope', expectedVersion: 1, queue: { concurrency: 1, refreshMinutes: 5, order: 'oldest' } }, operator))
  expect((await h.status()).id).toBe(before.id)
  expect((await h.status()).sourceId).toBe(second.id)
  expect(await h.execution()).toMatchObject({ id: original.id, owner: original.owner, epoch: original.epoch, session: original.session })
  expect(h.host.sessionsCreated.size).toBe(1)
})

it('adopts cross-project source work using the explicitly previewed original execution context', async () => {
  const h = await setup(false, { generate: async () => ({ steps: [{ nodeId: 'ISSUE_1', why: '跨来源同一工作', nextAction: '继续原会话', mode: 'existing' }] }) })
  const resource2 = { runtimeId: 'host', workspaceId: 'second-workspace' }
  h.host.resources = async () => [{ ref: resource, title: 'Original' }, { ref: resource2, title: 'Second' }]
  completed(await h.app.execute(h.configure, operator))
  const imported = completed(await h.app.execute({ type: 'source.import', commandId: 'original-import', ...h.scope, nodeId: 'ISSUE_1' }, operator))
  const original = completed(await h.app.execute({ type: 'task.start', commandId: 'original-start', ref: imported.ref, expectedVersion: imported.task!.version, agentId: imported.task!.agentId, resource, model, agentPreset: 'agent', permissionPreset: 'safe' }, operator)).execution!
  const connected = completed(await h.app.execute({ type: 'source.connect', commandId: 'connect-second-project', githubProject: { owner: 'acme', type: 'org', number: 2 } }, operator))
  const scope = { projectId: connected.project!.id, sourceId: connected.source!.id }
  completed(await h.app.query({ type: 'source.issues', ...scope, page: 1, perPage: 100, assignee: '@me', state: 'open', refresh: true }, operator))
  completed(await h.app.execute({ ...h.configure, ...scope, commandId: 'configure-second-project', resource: resource2 }, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'cross-instruct', ...scope, expectedVersion: 1, text: '复用已有工作及其原执行资源' }, operator))
  completed(await h.app.execute({ type: 'continuous.preview', commandId: 'cross-preview', ...scope, expectedVersion: 2 }, operator))
  const admission = vi.spyOn(h.host.execution, 'check')
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'cross-enable', ...scope, expectedVersion: 3, enabled: true }, operator))
  const rule = completed(await h.app.query({ type: 'continuous.status', ...scope }, operator)).continuousRule!
  expect(rule.active).toEqual(original.ref)
  expect(rule.resource).toEqual(resource2)
  expect(admission).toHaveBeenCalledWith(expect.objectContaining({ resource: original.resource, session: original.session, sessionMode: 'reuse' }))
  expect(await h.execution(original.ref)).toMatchObject({ id: original.id, owner: original.owner, epoch: original.epoch, resource: original.resource, session: original.session })
  expect(h.host.sessionsCreated.size).toBe(1); expect(h.host.sends).toHaveLength(1)
})

it('bounds failed safe settlement, keeps the slot fenced, and allows explicit recovery without model restart', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  h.host.idle(first); completed(await reportDone(h.app, first))
  const maintain = h.host.execution.maintain
  const spy = vi.spyOn(h.host.execution, 'maintain').mockRejectedValue(new Error('Maintenance unavailable'))
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now)
  for (let tick = 0; tick < 6; tick++) { now += 120_000; await h.app.reconcileControls() }
  expect((await h.status()).items[0]).toMatchObject({ state: 'completed', recoveryBlocked: true, attempts: 3 })
  expect((await h.status()).active).toEqual(first.ref)
  expect(h.host.sessionsCreated.size).toBe(1)
  const calls = spy.mock.calls.length
  await h.app.reconcileControls(); expect(spy.mock.calls.length).toBe(calls)
  h.host.execution.maintain = maintain
  completed(await h.app.execute({ type: 'task.reconcile', commandId: 'explicit-maintenance-retry', ...fence(first) }, operator))
  await h.app.reconcileControls()
  expect((await h.status()).items[0]!.state).toBe('completed')
  expect(h.host.sessionsCreated.size).toBe(2)
})

it.each(['missing', 'unknown'] as const)('retains an accepted slot when formal settlement is %s even at runtime idle', async mode => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  h.host.idle(first); completed(await reportDone(h.app, first))
  if (mode === 'missing') delete h.host.execution.observation
  else h.host.settlements.set(first.id, 'unknown')
  await h.app.reconcileControls()
  expect((await h.status()).active).toEqual(first.ref)
  expect(h.host.sessionsCreated.size).toBe(1)
  expect(completed(await h.app.query({ type: 'task.detail', ref: first.ref }, operator)).task!.completion!.closeout).toMatchObject({ status: 'pending', error: expect.stringContaining(mode === 'missing' ? 'capability-unavailable' : 'unknown') })
})

it('previews complete Repo candidates without execution and dispatches only after explicit plan enable', async () => {
  const generate = vi.fn(async () => ({ steps: [{ nodeId: 'ISSUE_2', why: '先处理第二项', nextAction: '核验要求后实施', mode: 'new' }] }))
  const h = await setup(false, { generate }, true)
  const pages = vi.spyOn(h.source, 'list')
  completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'repo-instruct', ...h.scope, expectedVersion: 1, text: '优先第二项，并保留其他候选' }, operator))
  completed(await h.app.execute({ type: 'continuous.preview', commandId: 'repo-preview', ...h.scope, expectedVersion: 2 }, operator))
  expect(generate).toHaveBeenCalledTimes(1)
  const basis = (generate.mock.calls[0] as unknown as [import('../src/work-planning.ts').PlanningBasis])[0]
  expect(basis.candidates.map(item => item.issue.nodeId)).toEqual(['ISSUE_1', 'ISSUE_2', 'ISSUE_3', 'ISSUE_4'])
  expect(basis.relationshipAvailability.nativeDependencies).toBe('unavailable-in-source-port')
  expect(pages.mock.calls.map(([, request]) => [request.page, request.assignee, request.state])).toEqual([[1, '*', 'open'], [2, '*', 'open']])
  expect(h.host.sessionsCreated.size).toBe(0); expect(h.host.sends).toHaveLength(0)
  expect((await h.status()).items.every(item => !item.ref)).toBe(true)
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'repo-enable', ...h.scope, expectedVersion: 3, enabled: true }, operator))
  expect((await h.status()).items.find(item => item.state === 'active')?.nodeId).toBe('ISSUE_2')
  expect(h.host.sessionsCreated.size).toBe(1)
  h.remote.issues = [issue(1)]
  await h.app.reconcileSources()
  const observed = completed(await h.app.query({ type: 'source.list', projectId: h.scope.projectId }, operator)).sources![0]!
  expect(observed.repositorySnapshot?.nodeIds).toEqual(['ISSUE_1'])
  expect(generate).toHaveBeenCalledTimes(1)
  expect(h.host.sessionsCreated.size).toBe(1)
})

it.each(['pagination', 'identity', 'foreign', 'limit', 'permission'] as const)('rejects incomplete Repo candidate scopes (%s) before model generation or execution', async mode => {
  const generate = vi.fn(async () => ({ steps: [] }))
  const h = await setup(false, { generate }, true)
  completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'reject-instruct', ...h.scope, expectedVersion: 1, text: '先看完整候选' }, operator))
  vi.spyOn(h.source, 'list').mockImplementation(async (_repository, request) => {
    if (mode === 'permission') throw new SourceError('github-forbidden', 'Repository permission denied')
    return { identity: mode === 'identity' && request.page > 1 ? { ...h.remote.identity, nodeId: 'BOB', login: 'bob' } : h.remote.identity,
      items: [{ ...issue(1), ...(mode === 'foreign' ? { repository: { owner: 'other', repository: 'repo' } } : {}) }],
      nextPage: mode === 'pagination' ? request.page : request.page + 1, observedAt: '2026-01-01T00:00:00.000Z' }
  })
  const code = { pagination: 'source-pagination-invalid', identity: 'github-identity-changed', foreign: 'github-invalid-response', limit: 'source-candidate-limit', permission: 'github-forbidden' }[mode]
  expect(await h.app.execute({ type: 'continuous.preview', commandId: 'reject-preview', ...h.scope, expectedVersion: 2 }, operator)).toMatchObject({ status: 'failed', error: { code } })
  const source = completed(await h.app.query({ type: 'source.list', projectId: h.scope.projectId }, operator)).sources![0]!
  expect(source.repositorySnapshot).toBeUndefined()
  expect(generate).not.toHaveBeenCalled(); expect(h.host.sessionsCreated.size).toBe(0)
})

it('discards a Repo scan when its source is disabled during pagination', async () => {
  const generate = vi.fn(async () => ({ steps: [] }))
  const h = await setup(false, { generate }, true)
  completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'race-instruct', ...h.scope, expectedVersion: 1, text: '预览范围' }, operator))
  let release!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  vi.spyOn(h.source, 'list').mockImplementation(async () => { entered(); await new Promise<void>(resolve => { release = resolve }); return { identity: h.remote.identity, items: [issue(1)], observedAt: '2026-01-01T00:00:00.000Z' } })
  const pending = h.app.execute({ type: 'continuous.preview', commandId: 'race-preview', ...h.scope, expectedVersion: 2 }, operator)
  await started
  completed(await h.app.execute({ type: 'source.set-enabled', commandId: 'disable-scanning-source', ...h.scope, expectedVersion: h.connection.source!.version, enabled: false }, operator))
  release()
  expect(await pending).toMatchObject({ status: 'failed', error: { code: 'source-observation-superseded' } })
  expect(generate).not.toHaveBeenCalled(); expect(h.host.sessionsCreated.size).toBe(0)
})


const queue = { concurrency: 2, refreshMinutes: 5, order: 'oldest' as const }
it('fills concurrent slots in order and lowering capacity or pausing preserves running identities', async () => {
  const h = await setup()
  h.remote.issues = [issue(3), issue(1), issue(2), issue(4)]
  completed(await h.app.execute({ ...h.configure, queue }, operator))
  const initial = await h.status()
  expect(initial.items.filter(item => item.state === 'active').map(item => item.number)).toEqual([1, 2])
  expect(initial.slots).toHaveLength(2)
  const executions = await Promise.all(initial.slots!.map(ref => h.execution(ref)))
  completed(await h.app.execute({ ...h.configure, commandId: 'lower-limit', expectedVersion: 1, queue: { ...queue, concurrency: 1, order: 'newest' } }, operator))
  expect((await h.status()).slots).toEqual(initial.slots)
  expect(h.host.sessionsCreated.size).toBe(2)
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'pause-next', ...h.scope, expectedVersion: 2, enabled: false }, operator))
  for (const execution of executions) {
    expect(await h.execution(execution.ref)).toMatchObject({ id: execution.id, owner: execution.owner, epoch: execution.epoch, session: execution.session })
    expect(await h.host.authorize(execution.session.sessionId)).toBe(true)
  }
  h.host.idle(executions[0]!); completed(await reportDone(h.app, executions[0]!)); await h.app.reconcileControls()
  expect((await h.status()).slots).toHaveLength(1)
  expect(h.host.sessionsCreated.size).toBe(2)
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'resume-next', ...h.scope, expectedVersion: 3, enabled: true }, operator))
  expect(h.host.sessionsCreated.size).toBe(2)
  h.host.idle(executions[1]!); completed(await reportDone(h.app, executions[1]!)); await h.app.reconcileControls()
  expect((await h.status()).items.filter(item => item.state === 'active').map(item => item.number)).toEqual([4])
  expect((await h.status()).items.filter(item => item.state === 'completed')).toHaveLength(2)
  expect(h.host.sessionsCreated.size).toBe(3)
})

it('manual refresh recalculates only waiting, preserves problems/history and makes no model or execution calls', async () => {
  const generate = vi.fn(async () => ({ steps: [] }))
  const h = await setup(true, { generate })
  h.remote.issues = [issue(1), issue(2), issue(3)]
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1 } }, operator))
  const first = await h.execution()
  h.host.idle(first); completed(await reportDone(h.app, first)); await h.app.reconcileControls()
  const second = await h.execution()
  h.host.idle(second); await h.app.reconcileControls()
  const third = await h.execution()
  const before = await h.status()
  expect(before.items.map(item => item.state)).toEqual(['completed', 'blocked', 'active'])
  h.remote.issues = [issue(4), issue(5)]
  const calls = [h.host.ensures.length, h.host.sends.length, h.host.wakes.length]
  const command = { type: 'continuous.refresh', commandId: 'refresh-waiting', ...h.scope, expectedVersion: 1 }
  completed(await h.app.execute(command, operator))
  const refreshed = await h.status()
  expect(refreshed.items.slice(0, 3)).toEqual(before.items)
  expect(refreshed.items.filter(item => item.state === 'queued').map(item => item.number)).toEqual([4, 5])
  expect(refreshed.slots).toEqual([third.ref])
  expect([h.host.ensures.length, h.host.sends.length, h.host.wakes.length]).toEqual(calls)
  expect(generate).not.toHaveBeenCalled()
  h.remote.issues = [issue(5), issue(6)]
  completed(await h.app.execute({ ...command, commandId: 'refresh-again' }, operator))
  expect((await h.status()).items.filter(item => item.state === 'queued').map(item => item.number)).toEqual([5, 6])
  expect((await h.status()).items.find(item => item.number === 4)?.state).toBe('skipped')
  expect(completed(await h.app.query({ type: 'project.detail', projectId: h.scope.projectId }, operator)).tasks).toHaveLength(3)
  const restored = new WorkApplication(h.directory, h.host, h.source)
  expect(await h.status(restored)).toEqual(await h.status())
  completed(await restored.execute(command, operator)) // old receipt cannot recreate a list
  expect((await h.status(restored)).items.filter(item => item.state === 'queued').map(item => item.number)).toEqual([5, 6])
})

it('periodic refresh honors the saved interval and updates the existing queue after restart', async () => {
  const h = await setup()
  const scans = vi.spyOn(h.source, 'project')
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1, refreshMinutes: 2 } }, operator))
  const before = await h.status(), calls = scans.mock.calls.length
  h.remote.issues.push(issue(5))
  const restored = new WorkApplication(h.directory, h.host, h.source)
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(before.nextRefreshAt!) - 1)
  await restored.reconcileControls()
  expect(scans).toHaveBeenCalledTimes(calls)
  expect((await h.status(restored)).items.some(item => item.number === 5)).toBe(false)
  vi.mocked(Date.now).mockReturnValue(Date.parse(before.nextRefreshAt!))
  await restored.reconcileControls()
  expect(scans).toHaveBeenCalledTimes(calls + 1)
  expect((await h.status(restored)).items.find(item => item.number === 5)?.state).toBe('queued')
  expect((await h.status(restored)).id).toBe(before.id)
  expect((await h.status(restored)).slots).toEqual(before.slots)
})

it('retains failed settlement capacity until an explicit task recovery and never retries the session', async () => {
  const h = await setup()
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1 } }, operator))
  const first = await h.execution()
  completed(await h.app.sessionControl(first.session, 'wait-before-settle', 'wait', 'Need input'))
  h.host.idle(first)
  const settle = vi.spyOn(h.host.execution, 'settle').mockRejectedValue(new Error('Settlement unknown'))
  await h.app.reconcileControls()
  const calls = h.host.ensures.length
  expect((await h.status()).slots).toEqual([first.ref])
  expect((await h.status()).items[0]).toMatchObject({ state: 'blocked' })
  await h.app.reconcileControls(); await h.app.reconcileControls()
  expect(h.host.ensures).toHaveLength(calls)
  expect(h.host.sessionsCreated.size).toBe(1)
  completed(await h.app.execute({ ...h.configure, commandId: 'save-with-problem', expectedVersion: 1, queue: { ...queue, concurrency: 1 } }, operator))
  completed(await h.app.execute({ type: 'continuous.refresh', commandId: 'refresh-with-problem', ...h.scope, expectedVersion: 2 }, operator))
  expect(h.host.ensures).toHaveLength(calls)
  expect((await h.status()).slots).toEqual([first.ref])
  settle.mockImplementation(async () => {})
  completed(await h.app.execute({ type: 'task.control', commandId: 'human-recovers', ...fence(first), action: 'resume', text: 'Continue after checking session' }, operator))
  await h.app.reconcileControls()
  expect(await h.execution(first.ref)).toMatchObject({ id: first.id, session: first.session, owner: first.owner, epoch: first.epoch, state: 'ready' })
})

it('explicit queue save preserves legacy instruction, plans and blocks without requiring new model planning', async () => {
  const generate = vi.fn(async () => ({ steps: [{ nodeId: 'ISSUE_2', why: 'Selected', nextAction: 'Work', mode: 'new' }] }))
  const h = await setup(false, { generate }, true)
  completed(await h.app.execute(h.configure, operator))
  completed(await h.app.execute({ type: 'continuous.instruct', commandId: 'legacy-instruction', ...h.scope, expectedVersion: 1, text: 'Only the reviewed plan' }, operator))
  completed(await h.app.execute({ type: 'continuous.block', commandId: 'legacy-block', ...h.scope, expectedVersion: 2, nodeId: 'ISSUE_1', blocked: true }, operator))
  completed(await h.app.execute({ type: 'continuous.preview', commandId: 'legacy-preview', ...h.scope, expectedVersion: 3 }, operator))
  const planning = (await h.status()).planning!
  completed(await h.app.execute({ type: 'continuous.refresh', commandId: 'legacy-refresh', ...h.scope, expectedVersion: 4 }, operator))
  expect(h.host.sessionsCreated.size).toBe(0)
  expect((await h.status()).queue).toBeUndefined()
  completed(await h.app.execute({ ...h.configure, commandId: 'save-queue-mode', expectedVersion: 4, enabled: true, queue }, operator))
  expect((await h.status()).planning).toMatchObject({ instruction: planning.instruction, plans: planning.plans, blocks: planning.blocks })
  expect((await h.status()).items.find(item => item.number === 1)?.state).toBe('blocked')
  expect((await h.status()).items.find(item => item.number === 2)?.state).toBe('active')
  expect(generate).toHaveBeenCalledTimes(1)
})

it('migrates multiple legacy scopes into a paused Project queue without dropping executions, problems or restrictions', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  const secondSource = completed(await h.app.execute({ type: 'source.configure-project', commandId: 'migration-source', projectId: h.scope.projectId, githubProject: { owner: 'acme', type: 'org', number: 2 } }, operator)).source!
  const imported = completed(await h.app.execute({ type: 'source.import', commandId: 'migration-import', ...h.scope, nodeId: 'ISSUE_2' }, operator))
  const second = completed(await h.app.execute({ type: 'task.start', commandId: 'migration-start', ref: imported.ref!, expectedVersion: imported.task!.version, agentId: imported.task!.agentId, resource, model, agentPreset: 'agent', permissionPreset: 'safe' }, operator)).execution!
  const snapshot = structuredClone(await WorkDao.forDirectory(h.directory).read())
  delete snapshot.storage; snapshot.commands = []
  const original = snapshot.continuousRules![0]!
  delete original.slots
  original.items = original.items.filter(item => item.number === 1)
  const legacy = structuredClone(original)
  legacy.id = second.id; legacy.sourceId = secondSource.id; legacy.active = second.ref
  legacy.items = [{ nodeId: 'ISSUE_2', title: 'Issue 2', number: 2, url: issue(2).url, ref: second.ref, executionId: second.id, state: 'active', attempts: 0 }, { nodeId: 'ISSUE_4', title: 'Issue 4', number: 4, url: issue(4).url, state: 'blocked', reason: 'Explicit exclusion', attempts: 0 }]
  legacy.planning = { instruction: 'Preserve this restriction', supplements: [], blocks: ['ISSUE_4'], scopeVersion: 1, draftVersion: 1, plans: [] }
  snapshot.continuousRules!.push(legacy)
  const directory = await mkdtemp(join(tmpdir(), 'continuous-work-')); roots.push(directory)
  await writeFile(join(directory, 'work-v3.json'), JSON.stringify(snapshot))
  const restored = new WorkApplication(directory, h.host, h.source)
  const migrated = await h.status(restored)
  expect(migrated).toMatchObject({ id: original.id, enabled: false, migrationConflict: { code: 'continuous-scope-conflict' } })
  expect(migrated.slots).toEqual([first.ref, second.ref])
  expect(migrated.legacyRules).toHaveLength(2)
  expect(migrated.legacyRules![1]!.planning).toEqual(legacy.planning)
  expect(migrated.items.find(item => item.number === 4)).toMatchObject({ state: 'blocked', reason: 'Explicit exclusion' })
  await restored.reconcileControls()
  expect(h.host.sessionsCreated.size).toBe(2)
  for (const execution of [first, second]) expect(await h.execution(execution.ref, restored)).toMatchObject({ id: execution.id, session: execution.session, owner: execution.owner, epoch: execution.epoch })
  expect(await restored.execute({ type: 'continuous.set-enabled', commandId: 'migration-enable', ...h.scope, expectedVersion: migrated.version, enabled: true }, operator)).toMatchObject({ status: 'failed', error: { code: 'continuous-scope-conflict' } })
  completed(await restored.execute({ ...h.configure, commandId: 'migration-save', expectedVersion: migrated.version, queue }, operator))
  expect((await h.status(restored)).migrationConflict).toBeUndefined()
  expect((await h.status(restored)).slots).toEqual([first.ref, second.ref])
  expect((await h.status(restored)).items.find(item => item.number === 4)?.state).toBe('blocked')
  expect((await WorkDao.forDirectory(directory).read()).continuousRules).toHaveLength(1)
})


it('counts completed-but-unsettled slots against concurrency before filling vacancies', async () => {
  const h = await setup()
  h.remote.issues = [issue(1), issue(2), issue(3)]
  completed(await h.app.execute({ ...h.configure, queue }, operator))
  const first = await h.execution((await h.status()).slots![0])
  h.host.idle(first); completed(await reportDone(h.app, first))
  h.host.settlements.set(first.id, 'unknown')
  await h.app.reconcileControls()
  expect((await h.status()).items[0]!.state).toBe('completed')
  expect((await h.status()).slots).toHaveLength(2)
  expect((await h.status()).items.find(item => item.number === 3)?.state).toBe('queued')
  expect(h.host.sessionsCreated.size).toBe(2)
  h.host.settlements.set(first.id, 'settled')
  await h.app.reconcileControls()
  expect((await h.status()).slots).toHaveLength(2)
  expect((await h.status()).items.find(item => item.number === 3)?.state).toBe('active')
  expect(h.host.sessionsCreated.size).toBe(3)
})

it('orders resumed work with new waiting work and keeps pause-next effective for released slots', async () => {
  const h = await setup()
  h.remote.issues = [issue(1), issue(2), issue(3)]
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1 } }, operator))
  const first = await h.execution()
  completed(await h.app.sessionControl(first.session, 'ordered-wait', 'wait', 'Wait for user'))
  h.host.idle(first); await h.app.reconcileControls()
  const second = await h.execution()
  completed(await h.app.execute({ type: 'task.input', commandId: 'ordered-answer', ...fence(first), text: 'Proceed', kind: 'input' }, operator))
  completed(await h.app.execute({ ...h.configure, commandId: 'newest-order', expectedVersion: 1, queue: { ...queue, concurrency: 1, order: 'newest' } }, operator))
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'ordered-pause', ...h.scope, expectedVersion: 2, enabled: false }, operator))
  h.host.idle(second); completed(await reportDone(h.app, second)); await h.app.reconcileControls()
  expect((await h.status()).slots).toEqual([])
  expect(h.host.sessionsCreated.size).toBe(2)
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'ordered-enable', ...h.scope, expectedVersion: 3, enabled: true }, operator))
  expect((await h.status()).items.find(item => item.state === 'active')?.number).toBe(3)
  expect((await h.status()).items.find(item => item.number === 1)?.resumeRequested).toBe(true)
  expect((await h.execution(first.ref)).owner).toBe(first.owner)
})

it.each(['resume', 'reconcile'] as const)('allows explicit Task %s through a paused queue subject to capacity after restart', async action => {
  const h = await setup()
  h.remote.issues = [issue(1), issue(2), issue(3)]
  if (action === 'reconcile') h.host.failAfterCreation = 1
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1 } }, operator))
  const first = await h.execution()
  if (action === 'resume') completed(await h.app.sessionControl(first.session, 'paused-recovery-wait', 'wait', 'Need a decision'))
  h.host.idle(first); await h.app.reconcileControls()
  const second = await h.execution()
  expect(second.id).not.toBe(first.id)
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'paused-recovery-intake', ...h.scope, expectedVersion: 1, enabled: false }, operator))
  const calls = { ensures: h.host.ensures.length, sends: h.host.sends.length, wakes: h.host.wakes.length }
  completed(await h.app.execute(action === 'resume'
    ? { type: 'task.control', commandId: 'paused-recovery-explicit', ...fence(first), action: 'resume', text: 'Recover this existing Task' }
    : { type: 'task.reconcile', commandId: 'paused-recovery-explicit', ...fence(first) }, operator))
  await h.app.reconcileControls()
  expect((await h.status()).slots).toEqual([second.ref])
  expect({ ensures: h.host.ensures.length, sends: h.host.sends.length, wakes: h.host.wakes.length }).toEqual(calls)
  const restored = new WorkApplication(h.directory, h.host, h.source)
  h.host.idle(second); completed(await reportDone(restored, second)); await restored.reconcileControls()
  expect((await h.status(restored))).toMatchObject({ enabled: false, slots: [first.ref] })
  expect((await h.status(restored)).items.find(item => item.number === 3)?.state).toBe('queued')
  expect(await h.execution(first.ref, restored)).toMatchObject({ id: first.id, session: first.session, owner: first.owner, epoch: first.epoch, state: 'ready' })
  expect(h.host.sessionsCreated.size).toBe(2)
  h.host.idle(await h.execution(first.ref, restored)); completed(await reportDone(restored, first)); await restored.reconcileControls()
  expect((await h.status(restored))).toMatchObject({ enabled: false, slots: [] })
  expect((await h.status(restored)).items.find(item => item.number === 3)?.state).toBe('queued')
})

it('automatic result messages cannot retry a failed session; explicit input recovers the reserved identity', async () => {
  const h = await setup()
  h.remote.issues = [issue(1)]
  h.host.failAfterCreation = 1
  completed(await h.app.execute({ ...h.configure, queue }, operator))
  const first = await h.execution()
  await h.app.reconcileControls()
  completed(await h.app.execute({ type: 'task.input', commandId: 'automatic-result', ...fence(first), text: 'Child result arrived', kind: 'result' }, operator))
  await h.app.reconcileControls()
  expect(h.host.ensures).toHaveLength(1)
  expect((await h.status()).items[0]).toMatchObject({ state: 'blocked' })
  completed(await h.app.execute({ type: 'task.input', commandId: 'human-input', ...fence(first), text: 'I checked the session; proceed', kind: 'input' }, operator))
  await h.app.reconcileControls()
  expect(await h.execution(first.ref)).toMatchObject({ id: first.id, session: first.session, owner: first.owner, epoch: first.epoch, state: 'ready' })
  expect(h.host.sessionsCreated.size).toBe(1)
})


it('keeps Task-page recovery on a different resource outside queue execution ownership', async () => {
  const h = await setup(false)
  const otherResource = { ...resource, workspaceId: 'manual-workspace' }
  h.host.resources = async () => [{ ref: resource, title: 'Queue' }, { ref: otherResource, title: 'Manual' }]
  const project = completed(await h.app.query({ type: 'project.detail', projectId: h.scope.projectId }, operator)).project!
  completed(await h.app.execute({ type: 'project.attach-resource', commandId: 'manual-resource', projectId: project.id, expectedVersion: project.version, resource: otherResource }, operator))
  const imported = completed(await h.app.execute({ type: 'source.import', commandId: 'manual-resource-import', ...h.scope, nodeId: 'ISSUE_1' }, operator))
  const start = { type: 'task.start' as const, commandId: 'manual-resource-start', ref: imported.ref!, expectedVersion: imported.task!.version, agentId: imported.task!.agentId, resource: otherResource, model, agentPreset: 'agent', permissionPreset: 'safe' }
  const original = completed(await h.app.execute(start, operator)).execution!
  completed(await h.app.execute({ ...h.configure, enabled: true, queue: { ...queue, concurrency: 1 } }, operator))
  expect((await h.status()).items[0]).toMatchObject({ state: 'waiting', taskRef: original.ref })
  completed(await h.app.execute({ ...start, commandId: 'manual-resource-recover' }, operator))
  const observed = (await h.status()).items[0]!
  expect(observed).toMatchObject({ state: 'waiting', taskRef: original.ref, reason: expect.stringContaining('another authorized resource') })
  expect(observed.ref).toBeUndefined(); expect(observed.executionId).toBeUndefined()
  expect((await h.status()).slots).not.toContainEqual(original.ref)
  expect(await h.execution(original.ref)).toMatchObject({ resource: otherResource, owner: original.owner, epoch: original.epoch, session: original.session })
})

it('projects accepted foreign-resource Tasks as history before admission without claiming their owner', async () => {
  const h = await setup()
  h.remote.issues = [issue(1)]
  const otherResource = { ...resource, workspaceId: 'history-workspace' }
  h.host.resources = async () => [{ ref: resource, title: 'Original' }, { ref: otherResource, title: 'History' }]
  completed(await h.app.execute({ ...h.configure, queue }, operator))
  const original = await h.execution()
  h.host.idle(original); completed(await reportDone(h.app, original))
  const connected = completed(await h.app.execute({ type: 'source.connect', commandId: 'history-project', githubProject: { owner: 'acme', type: 'org', number: 2 } }, operator))
  const scope = { projectId: connected.project!.id, sourceId: connected.source!.id }
  completed(await h.app.query({ type: 'source.issues', ...scope, page: 1, perPage: 100, assignee: '@me', state: 'open', refresh: true }, operator))
  completed(await h.app.execute({ ...h.configure, ...scope, commandId: 'history-configure', resource: otherResource, enabled: false, queue }, operator))
  h.host.failAdmission = true
  const admission = vi.spyOn(h.host.execution, 'check')
  const calls = { ensures: h.host.ensures.length, sends: h.host.sends.length, wakes: h.host.wakes.length }
  const rule = completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'history-enable', ...scope, expectedVersion: 1, enabled: true }, operator)).continuousRule!
  expect(rule.items[0]).toMatchObject({ state: 'completed', taskRef: original.ref, sourceId: scope.sourceId })
  expect(rule.items[0]!.ref).toBeUndefined(); expect(rule.items[0]!.executionId).toBeUndefined()
  expect(rule.slots).toEqual([])
  expect(admission).not.toHaveBeenCalled()
  expect({ ensures: h.host.ensures.length, sends: h.host.sends.length, wakes: h.host.wakes.length }).toEqual(calls)
  expect(await h.execution(original.ref)).toMatchObject({ owner: original.owner, epoch: original.epoch, session: original.session, resource })
})

it('retains the original Issue source for unbound problems across a source switch and restart', async () => {
  const h = await setup(false)
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1 } }, operator))
  h.host.failAdmission = true
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'unbound-enable', ...h.scope, expectedVersion: 1, enabled: true }, operator))
  const problem = (await h.status()).items[0]!
  expect(problem).toMatchObject({ state: 'blocked', sourceId: h.scope.sourceId })
  expect(problem.taskRef).toBeUndefined(); expect(problem.ref).toBeUndefined()
  h.host.failAdmission = false
  h.remote.issues = [issue(9)]
  const second = completed(await h.app.execute({ type: 'source.configure-project', commandId: 'unbound-source', projectId: h.scope.projectId, githubProject: { owner: 'acme', type: 'org', number: 2 } }, operator)).source!
  const scope = { projectId: h.scope.projectId, sourceId: second.id }
  completed(await h.app.query({ type: 'source.issues', ...scope, page: 1, perPage: 100, assignee: '@me', state: 'open', refresh: true }, operator))
  completed(await h.app.execute({ ...h.configure, ...scope, commandId: 'unbound-switch', expectedVersion: 2, queue }, operator))
  const restored = new WorkApplication(h.directory, h.host, h.source)
  const retained = (await h.status(restored)).items.find(item => item.number === 1)!
  expect(retained).toMatchObject(problem)
  const originalIssue = completed(await restored.query({ type: 'source.issue', projectId: h.scope.projectId, sourceId: retained.sourceId!, nodeId: retained.nodeId, number: retained.number }, operator))
  expect(originalIssue.issue?.nodeId).toBe('ISSUE_1')
  expect(h.host.sessionsCreated.size).toBe(0)
})

it('projects canonical completion after pre-admission failure through the original Task across source switches', async () => {
  const h = await setup(false)
  const project = completed(await h.app.query({ type: 'project.detail', projectId: h.scope.projectId }, operator)).project!
  completed(await h.app.execute({ type: 'project.attach-resource', commandId: 'observed-resource', projectId: project.id, expectedVersion: project.version, resource }, operator))
  const imported = completed(await h.app.execute({ type: 'source.import', commandId: 'observed-import', ...h.scope, nodeId: 'ISSUE_1' }, operator))
  const original = completed(await h.app.execute({ type: 'task.start', commandId: 'observed-start', ref: imported.ref!, expectedVersion: imported.task!.version, agentId: imported.task!.agentId, resource, model, agentPreset: 'agent', permissionPreset: 'safe' }, operator)).execution!
  h.host.idle(original)
  completed(await h.app.execute({ type: 'task.control', commandId: 'observed-wait', ...fence(original), action: 'wait', text: 'Need a decision' }, operator))
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1 } }, operator))
  h.host.failAdmission = true
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'observed-enable', ...h.scope, expectedVersion: 1, enabled: true }, operator))
  const blocked = (await h.status()).items[0]!
  expect(blocked).toMatchObject({ state: 'blocked', taskRef: original.ref, sourceId: h.scope.sourceId })
  expect(blocked.ref).toBeUndefined(); expect(blocked.executionId).toBeUndefined()
  h.host.failAdmission = false
  h.remote.issues = [issue(9)]
  const second = completed(await h.app.execute({ type: 'source.configure-project', commandId: 'observed-source', projectId: h.scope.projectId, githubProject: { owner: 'acme', type: 'org', number: 2 } }, operator)).source!
  const scope = { projectId: h.scope.projectId, sourceId: second.id }
  completed(await h.app.query({ type: 'source.issues', ...scope, page: 1, perPage: 100, assignee: '@me', state: 'open', refresh: true }, operator))
  completed(await h.app.execute({ ...h.configure, ...scope, commandId: 'observed-switch', expectedVersion: 2, queue: { ...queue, concurrency: 1 } }, operator))
  const restored = new WorkApplication(h.directory, h.host, h.source)
  expect((await h.status(restored)).items.find(item => item.number === 1)).toMatchObject({ state: 'blocked', taskRef: original.ref, sourceId: h.scope.sourceId, reason: blocked.reason })
  const calls = { ensures: h.host.ensures.length, sends: h.host.sends.length, wakes: h.host.wakes.length }
  await restored.reconcileContinuous()
  expect({ ensures: h.host.ensures.length, sends: h.host.sends.length, wakes: h.host.wakes.length }).toEqual(calls)
  completed(await restored.execute({ type: 'task.control', commandId: 'observed-resume', ...fence(original), action: 'resume', text: 'Decision resolved' }, operator))
  h.host.idle(await h.execution(original.ref, restored))
  completed(await reportDone(restored, original))
  // Read-only status reflects the real Task result even before a scheduler tick.
  expect((await h.status(restored)).items.find(item => item.number === 1)).toMatchObject({ state: 'completed', taskRef: original.ref, sourceId: h.scope.sourceId })
  await restored.reconcileContinuous()
  const history = (await h.status(restored)).items.find(item => item.number === 1)!
  expect(history.state).toBe('completed'); expect(history.ref).toBeUndefined(); expect(history.executionId).toBeUndefined()
  expect((await h.execution(original.ref, restored))).toMatchObject({ id: original.id, owner: original.owner, epoch: original.epoch, resource: original.resource, session: original.session })
  expect(h.host.sessionsCreated.size).toBe(1)
})

it('screens only mandatory-scope Issues using full bodies and starts only matching candidates', async () => {
  const screen = vi.fn(async (basis: import('../src/work-screening.ts').ScreeningBasis) => ({ decisions: basis.candidates.map(issue => ({ nodeId: issue.nodeId, matches: issue.number === 2, reason: issue.number === 2 ? '独立缺陷，可处理' : '纯文档，排除' })) }))
  const h = await setup(true, { generate: async () => ({ steps: [] }), screen })
  h.remote.issues[0]!.body = '仅修改文档'; h.remote.issues[1]!.body = '修复可复现的独立缺陷'
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1, filterPrompt: '只处理独立缺陷，排除文档' } }, operator))
  expect(screen).toHaveBeenCalledOnce()
  expect(screen.mock.calls[0]![0].candidates.map(issue => [issue.number, issue.body])).toEqual([[1, '仅修改文档'], [2, '修复可复现的独立缺陷']])
  expect((await h.status()).items.map(item => [item.number, item.state, item.reason ?? item.screening?.reason])).toEqual([[1, 'skipped', '纯文档，排除'], [2, 'active', '独立缺陷，可处理']])
  expect(h.host.sessionsCreated.size).toBe(1)
  const restored = new WorkApplication(h.directory, h.host, h.source, { generate: async () => ({ steps: [] }), screen })
  const rule = await h.status(restored)
  expect(rule.queue!.filterPrompt).toBe('只处理独立缺陷，排除文档')
  completed(await restored.execute({ type: 'continuous.refresh', commandId: 'cached-screen', ...h.scope, expectedVersion: rule.version }, operator))
  expect(screen).toHaveBeenCalledOnce()
})

it('holds incomplete or failed model screening and retries without starting unclassified work', async () => {
  const screen = vi.fn(async (): Promise<unknown> => ({ decisions: [] }))
  const h = await setup(true, { generate: async () => ({ steps: [] }), screen })
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1, filterPrompt: '只处理独立缺陷' } }, operator))
  expect(h.host.sessionsCreated.size).toBe(0)
  expect((await h.status()).screeningError?.message).toContain('缺少部分候选')
  expect((await h.status()).items.every(item => item.state === 'waiting')).toBe(true)
  screen.mockRejectedValueOnce(new Error('Model temporarily unavailable'))
  completed(await h.app.execute({ type: 'continuous.refresh', commandId: 'screen-error', ...h.scope, expectedVersion: (await h.status()).version }, operator))
  expect((await h.status()).screeningError?.message).toContain('temporarily unavailable')
  expect(h.host.sessionsCreated.size).toBe(0)
  screen.mockImplementation(async () => ({ decisions: [{ nodeId: 'ISSUE_1', matches: true, reason: '符合独立缺陷条件' }, { nodeId: 'ISSUE_2', matches: false, reason: '不符合' }] }))
  completed(await h.app.execute({ type: 'continuous.refresh', commandId: 'screen-retry', ...h.scope, expectedVersion: (await h.status()).version }, operator))
  await h.app.reconcileContinuous()
  expect((await h.status()).screeningError).toBeUndefined()
  expect((await h.status()).items[0]!.state).toBe('active')
  expect(h.host.sessionsCreated.size).toBe(1)
})

it('rescreens changed Issue bodies and prompts while preserving active work, and clears filtering when empty', async () => {
  const screen = vi.fn(async (basis: import('../src/work-screening.ts').ScreeningBasis) => ({ decisions: basis.candidates.map(issue => ({ nodeId: issue.nodeId, matches: issue.number === 1, reason: '语义筛选结果' })) }))
  const h = await setup(true, { generate: async () => ({ steps: [] }), screen })
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1, filterPrompt: '排除文档' } }, operator))
  const active = await h.execution()
  h.remote.issues[1]!.body = '正文已改变，必须重新判定'
  completed(await h.app.execute({ type: 'continuous.refresh', commandId: 'body-change', ...h.scope, expectedVersion: (await h.status()).version }, operator))
  expect(screen.mock.calls[1]![0].candidates.map(issue => issue.number)).toEqual([2])
  completed(await h.app.execute({ ...h.configure, commandId: 'prompt-change', expectedVersion: (await h.status()).version, queue: { ...queue, concurrency: 1, filterPrompt: '只要缺陷' } }, operator))
  expect(screen.mock.calls.at(-1)![0].instruction).toBe('只要缺陷')
  expect(screen.mock.calls.at(-1)![0].candidates.map(issue => issue.number)).toEqual([2])
  expect((await h.execution()).id).toBe(active.id)
  completed(await h.app.execute({ ...h.configure, commandId: 'clear-prompt', expectedVersion: (await h.status()).version, queue: { ...queue, concurrency: 1, filterPrompt: '' } }, operator))
  expect((await h.status()).items.find(item => item.number === 2)).toMatchObject({ state: 'queued' })
  expect((await h.status()).items.find(item => item.number === 2)!.screening).toBeUndefined()
  expect(h.host.sessionsCreated.size).toBe(1)
})

it('rejects screening results when source content changes while the model is generating', async () => {
  let h: Awaited<ReturnType<typeof setup>>
  const screen = vi.fn(async (basis: import('../src/work-screening.ts').ScreeningBasis) => {
    h.remote.issues[0]!.body = '模型调用期间修改的正文'
    h.remote.issues[0]!.updatedAt = '2026-01-02T00:00:00.000Z'
    completed(await h.refresh())
    return { decisions: basis.candidates.map(issue => ({ nodeId: issue.nodeId, matches: true, reason: '旧正文匹配' })) }
  })
  h = await setup(true, { generate: async () => ({ steps: [] }), screen })
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1, filterPrompt: '只处理明确缺陷' } }, operator))
  expect(h.host.sessionsCreated.size).toBe(0)
  expect((await h.status()).screeningError?.message).toContain('候选内容发生变化')
  expect((await h.status()).items.every(item => item.state === 'waiting')).toBe(true)
})

it('maintains owned work and saves a new prompt while an earlier screening call is still pending', async () => {
  let release!: () => void, started!: () => void
  const pending = new Promise<void>(done => { release = done }), entered = new Promise<void>(done => { started = done })
  const screen = vi.fn(async (basis: import('../src/work-screening.ts').ScreeningBasis) => {
    if (basis.instruction === '慢筛选') { started(); await pending }
    return { decisions: basis.candidates.map(issue => ({ nodeId: issue.nodeId, matches: true, reason: basis.instruction })) }
  })
  const h = await setup(true, { generate: async () => ({ steps: [] }), screen })
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1 } }, operator))
  const original = await h.execution(); h.host.idle(original)
  const slow = h.app.execute({ ...h.configure, commandId: 'slow-prompt', expectedVersion: 1, queue: { ...queue, concurrency: 1, filterPrompt: '慢筛选' } }, operator)
  try {
    await entered
    // No screening result exists yet; control maintenance must still settle owned work.
    completed(await h.app.execute({ type: 'task.control', commandId: 'pause-during-screen', ...fence(original), action: 'pause', text: '保持既有暂停' }, operator))
    expect((await h.execution(original.ref)).control?.status).toBe('applied')
    completed(await h.app.execute({ ...h.configure, commandId: 'new-prompt-during-screen', expectedVersion: 2, queue: { ...queue, concurrency: 1, filterPrompt: '新筛选' } }, operator))
    expect((await h.status()).queue!.filterPrompt).toBe('新筛选')
    expect((await h.status()).items.find(item => item.number === 2)!.screening?.reason).toBe('新筛选')
  } finally { release(); await slow }
  expect((await h.execution(original.ref)).control?.action).toBe('pause')
  expect((await h.status()).items.find(item => item.number === 2)!.screening?.reason).toBe('新筛选')
})

it('reflects explicit Task-page recovery of a pre-admission problem without bypassing queue capacity', async () => {
  const h = await setup(false)
  completed(await h.app.execute({ ...h.configure, queue: { ...queue, concurrency: 1 } }, operator))
  h.host.failAdmission = true
  completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'fail-intake', ...h.scope, expectedVersion: 1, enabled: true }, operator))
  expect((await h.status()).items[0]).toMatchObject({ state: 'blocked' })
  expect((await h.status()).items[0]!.ref).toBeUndefined()
  h.host.failAdmission = false
  await h.app.reconcileControls()
  const second = await h.execution()
  const imported = completed(await h.app.execute({ type: 'source.import', commandId: 'manual-fix-import', ...h.scope, nodeId: 'ISSUE_1' }, operator))
  const recovered = completed(await h.app.execute({ type: 'task.start', commandId: 'manual-fix-start', ref: imported.ref!, expectedVersion: imported.task!.version, agentId: imported.task!.agentId, resource, model, agentPreset: 'agent', permissionPreset: 'safe' }, operator)).execution!
  expect((await h.status()).items[0]).toMatchObject({ ref: recovered.ref, executionId: recovered.id, resumeRequested: true })
  expect(h.host.sessionsCreated.size).toBe(1)
  h.host.idle(second); completed(await reportDone(h.app, second)); await h.app.reconcileControls()
  expect((await h.status()).items[0]).toMatchObject({ ref: recovered.ref, executionId: recovered.id, state: 'active' })
  expect(h.host.sessionsCreated.size).toBe(2)
  expect((await h.execution(recovered.ref)).session).toEqual(recovered.session)
})
