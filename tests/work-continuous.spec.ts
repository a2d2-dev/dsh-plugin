import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkApplication } from '../src/work.ts'
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
  authorize!: (session: string, messages?: readonly NativeWorkMessage[]) => Promise<boolean>
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
    observation: async execution => ({ settlement: this.settlements.get(execution.id) ?? 'unknown', sessions: [], blockers: [], limitations: [] }),
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
  return { nodeId: `ISSUE_${number}`, number, title: `Issue ${number}`, url: `https://github.com/acme/repo/issues/${number}`, body: 'Implement the agreed work.', repository: { owner: 'acme', repository: 'repo' }, assignees, labels, state: 'open', updatedAt: '2026-01-01T00:00:00.000Z', observedAt: '2026-01-01T00:00:00.000Z' }
}
async function setup(enable = true) {
  const directory = await mkdtemp(join(tmpdir(), 'continuous-work-')); roots.push(directory)
  const host = new Host()
  const remote = { identity: { login: 'alice', nodeId: 'ALICE', name: null }, issues: [issue(1), issue(2), issue(3, ['bob']), issue(4, ['alice'], ['other'])] }
  const source: GitHubSourcePort = {
    list: async () => { throw new Error('Project only') }, detail: async () => { throw new Error('Project only') },
    project: async () => ({ identity: remote.identity, project: { nodeId: 'PROJECT', title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/1', closed: false },
      items: remote.issues.map(issue => ({ id: `ITEM_${issue.nodeId}`, kind: 'issue', archived: false, issueNodeId: issue.nodeId, fields: [], fieldsPartial: false })), issues: remote.issues, observedAt: '2026-01-01T00:00:00.000Z' }),
  }
  const app = new WorkApplication(directory, host, source)
  const connection = completed(await app.execute({ type: 'source.connect', commandId: 'connect', githubProject: { owner: 'acme', type: 'org', number: 1 } }, operator))
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
  const updated = completed(await app.execute({ type: 'task.update-spec', commandId: `spec:${execution.id}`, ref: execution.ref, expectedVersion: detail.task!.version, goal: 'Accepted goal', specification: 'Accepted scope', acceptance: ['Pass check'] }, operator))
  completed(await app.execute({ type: 'task.report', commandId: `done:${execution.id}`, ...fence(execution), report: { specificationVersion: updated.task!.specification.version, stage: 'done', summary: 'Accepted completion', next: '', blockers: [], criteria: [{ index: 0, passed: true, evidence: ['check passed'] }] } }, operator))
}

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
  await reportDone(h.app, first)
  await h.app.reconcileControls()
  expect((await h.status()).active).toEqual(first.ref)
  expect(await h.host.authorize(first.session.sessionId)).toBe(false)
  h.host.idle(first); await h.app.reconcileControls()
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

it('recovers an unknown create outcome using the same persisted execution and Session after restart', async () => {
  const h = await setup(); h.host.failAfterCreation = 1
  completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  expect(first.state).toBe('failed'); expect(h.host.sessionsCreated.size).toBe(1)
  const restored = new WorkApplication(h.directory, h.host, h.source)
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 120_000)
  await restored.reconcileControls()
  expect(await h.execution(first.ref, restored)).toMatchObject({ id: first.id, session: first.session, owner: first.owner, state: 'ready' })
  expect(h.host.sessionsCreated.size).toBe(1); expect(h.host.sends).toEqual([`kickoff:${first.id}`])
  await restored.reconcileControls(); expect(h.host.sends).toHaveLength(1)
})

it('bounds host failures with visible blocked state and proceeds to another candidate without empty model turns', async () => {
  const h = await setup(); h.host.failEnsure = 100
  completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now)
  for (let tick = 0; tick < 3; tick++) { now += 120_000; await h.app.reconcileControls() }
  const rule = await h.status()
  expect(rule.items[0]).toMatchObject({ state: 'blocked', attempts: 3, reason: expect.stringContaining('unknown') })
  expect(h.host.ensures.filter(id => id === first.session.sessionId)).toHaveLength(3)
  expect(h.host.sends).toHaveLength(0)
  expect(rule.items[1]!.state).toBe('active')
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
  await reportDone(h.app, first); h.host.idle(first)
  const original = h.host.execution.settle
  vi.spyOn(h.host.execution, 'settle').mockImplementation(async () => { throw new Error('Host maintenance unavailable') })
  await h.app.reconcileControls()
  expect((await h.status()).active).toEqual(first.ref)
  expect(h.host.sessionsCreated.size).toBe(1)
  expect(await h.host.authorize(first.session.sessionId)).toBe(false)
  h.host.execution.settle = original
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
  expect(h.host.sends).toHaveLength(1); expect(h.host.sessionsCreated.size).toBe(1)
})

it('freezes completed managed acceptance against later specification or report mutations', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  await reportDone(h.app, first)
  const task = completed(await h.app.query({ type: 'task.detail', ref: first.ref }, operator)).task!
  expect(await h.app.execute({ type: 'task.update-spec', commandId: 'after-done-spec', ref: first.ref, expectedVersion: task.version, goal: 'Changed goal', specification: 'Changed spec', acceptance: ['More work'] }, operator)).toMatchObject({ status: 'failed', error: { code: 'continuous-completed' } })
  expect(await h.app.execute({ type: 'task.report', commandId: 'after-done-report', ...fence(first), report: { specificationVersion: task.specification.version, stage: 'in-progress', summary: 'Restart', next: 'More work', blockers: [], criteria: [] } }, operator)).toMatchObject({ status: 'failed', error: { code: 'continuous-completed' } })
})

it('bounds failed safe settlement, keeps the slot fenced, and allows explicit recovery without model restart', async () => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  await reportDone(h.app, first); h.host.idle(first)
  const settle = h.host.execution.settle
  const spy = vi.spyOn(h.host.execution, 'settle').mockRejectedValue(new Error('Maintenance unavailable'))
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now)
  for (let tick = 0; tick < 6; tick++) { now += 120_000; await h.app.reconcileControls() }
  expect((await h.status()).items[0]).toMatchObject({ state: 'completed', recoveryBlocked: true, attempts: 3 })
  expect((await h.status()).active).toEqual(first.ref)
  expect(h.host.sessionsCreated.size).toBe(1)
  const calls = spy.mock.calls.length
  await h.app.reconcileControls(); expect(spy.mock.calls.length).toBe(calls)
  h.host.execution.settle = settle
  completed(await h.app.execute({ type: 'task.reconcile', commandId: 'explicit-maintenance-retry', ...fence(first) }, operator))
  await h.app.reconcileControls()
  expect((await h.status()).items[0]!.state).toBe('completed')
  expect(h.host.sessionsCreated.size).toBe(2)
})

it.each(['missing', 'unknown'] as const)('retains an accepted slot when formal settlement is %s even at runtime idle', async mode => {
  const h = await setup(); completed(await h.app.execute(h.configure, operator)); const first = await h.execution()
  await reportDone(h.app, first); h.host.idle(first)
  if (mode === 'missing') delete h.host.execution.observation
  else h.host.settlements.set(first.id, 'unknown')
  await h.app.reconcileControls()
  expect((await h.status()).active).toEqual(first.ref)
  expect(h.host.sessionsCreated.size).toBe(1)
  expect(completed(await h.app.query({ type: 'task.detail', ref: first.ref }, operator)).task!.completion!.closeout).toMatchObject({ status: 'pending', error: expect.stringContaining(mode === 'missing' ? 'capability-unavailable' : 'unknown') })
})
