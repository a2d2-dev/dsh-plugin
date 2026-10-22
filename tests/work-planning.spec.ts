import { expect, it } from 'vitest'
import { planningBasisFingerprint, type PlanningBasis } from '../src/work-planning.ts'

function basis(): PlanningBasis {
  const identity = { login: 'alice', nodeId: 'ALICE', name: null }
  const issue = { nodeId: 'ISSUE_1', number: 1, title: 'Work', url: 'https://github.com/acme/repo/issues/1', repository: { owner: 'acme', repository: 'repo' }, state: 'open' as const, body: 'Work', labels: [], assignees: ['alice'], observedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  return {
    instruction: 'Complete work', supplements: [], blocks: [], scopeVersion: 1,
    scope: { assignee: '*', labels: [] },
    executionStrategy: { resource: { runtimeId: 'host', workspaceId: 'workspace' }, model: { provider: 'fake', model: 'exact' }, agentPreset: 'agent', permissionPreset: 'safe' },
    relationshipAvailability: { nativeParentChildren: 'observed-when-present', nativeDependencies: 'unavailable-in-source-port' },
    source: { id: 'source', projectId: 'project', provider: 'github', repository: issue.repository, enabled: true, version: 1, sequence: 1, requests: {}, observations: [{ issue, sequence: 1 }], pages: [], identity,
      repositorySnapshot: { sourceVersion: 1, identity, nodeIds: ['ISSUE_1'], observedAt: issue.observedAt },
      discovery: { state: 'idle', nextAttemptAt: issue.observedAt, failures: 0 } },
    candidates: [{ issue, task: { ref: { projectId: 'project', taskId: 'task' }, agentId: 'agent', goal: 'Goal', specification: { version: 1 }, progress: { summary: 'Working' } },
      execution: { id: 'execution', ref: { projectId: 'project', taskId: 'task' }, owner: 'owner', epoch: 1, session: { runtimeId: 'host', sessionId: 'session' }, state: 'ready' } }],
  }
}
const record = (value: unknown) => value as Record<string, any>

it.each([
  ['source sequence', (b: PlanningBasis) => { b.source.sequence++ }],
  ['discovery schedule', (b: PlanningBasis) => { b.source.discovery!.nextAttemptAt = '2026-01-02T00:00:00.000Z' }],
  ['discovery lease and checkpoint', (b: PlanningBasis) => { record(b.source.discovery).inFlight = { id: 'lease', expiresAt: '2026-01-02T00:00:00.000Z' }; record(b.source.discovery).checkpoint = { cursor: 'next' } }],
  ['source error', (b: PlanningBasis) => { b.source.lastError = { code: 'retry', message: 'Retry later' } }],
  ['observation times', (b: PlanningBasis) => { b.source.observations[0]!.issue.observedAt = b.candidates[0]!.issue.updatedAt = '2026-01-02T00:00:00.000Z'; b.source.repositorySnapshot!.observedAt = '2026-01-02T00:00:00.000Z' }],
  ['progress', (b: PlanningBasis) => { record(b.candidates[0]!.task).progress = { summary: 'New progress' } }],
  ['execution state, control and error', (b: PlanningBasis) => { Object.assign(record(b.candidates[0]!.execution), { state: 'waiting', control: { action: 'wait' }, error: { message: 'Transient' } }) }],
] as const)('keeps the planning fingerprint stable across %s', (_name, change) => {
  const before = basis(), after = structuredClone(before)
  change(after)
  expect(planningBasisFingerprint(after)).toBe(planningBasisFingerprint(before))
})

it.each([
  ['instruction', (b: PlanningBasis) => { b.instruction = 'Changed instruction' }],
  ['supplement', (b: PlanningBasis) => { b.supplements.push('More scope') }],
  ['blocks', (b: PlanningBasis) => { b.blocks.push('ISSUE_1') }],
  ['scope version', (b: PlanningBasis) => { b.scopeVersion++ }],
  ['scope', (b: PlanningBasis) => { b.scope.labels.push('ready') }],
  ['execution strategy', (b: PlanningBasis) => { b.executionStrategy.model.model = 'other' }],
  ['candidate membership', (b: PlanningBasis) => { b.candidates = [] }],
  ['TaskRef', (b: PlanningBasis) => { record(b.candidates[0]!.task).ref.taskId = 'other' }],
  ['goal', (b: PlanningBasis) => { record(b.candidates[0]!.task).goal = 'New goal' }],
  ['specification version', (b: PlanningBasis) => { record(b.candidates[0]!.task).specification.version++ }],
  ['ExecutionId', (b: PlanningBasis) => { record(b.candidates[0]!.execution).id = 'other' }],
  ['owner', (b: PlanningBasis) => { record(b.candidates[0]!.execution).owner = 'other' }],
  ['epoch', (b: PlanningBasis) => { record(b.candidates[0]!.execution).epoch++ }],
  ['session', (b: PlanningBasis) => { record(b.candidates[0]!.execution).session.sessionId = 'other' }],
  ['other rule ownership', (b: PlanningBasis) => { b.candidates[0]!.ownerRuleId = 'other' }],
  ['repository source version', (b: PlanningBasis) => { b.source.repositorySnapshot!.sourceVersion++ }],
  ['source identity', (b: PlanningBasis) => { b.source.identity!.nodeId = 'BOB' }],
] as const)('invalidates the planning fingerprint when %s changes', (_name, change) => {
  const before = basis(), after = structuredClone(before)
  change(after)
  expect(planningBasisFingerprint(after)).not.toBe(planningBasisFingerprint(before))
})

it('uses a candidate set independent of observation order and object key order', () => {
  const before = basis()
  before.candidates.push({ issue: { ...before.candidates[0]!.issue, nodeId: 'ISSUE_2' } })
  const after = structuredClone(before)
  after.candidates.reverse()
  record(after.candidates[1]!.task).ref = { taskId: 'task', projectId: 'project' }
  expect(planningBasisFingerprint(after)).toBe(planningBasisFingerprint(before))
})

it('uses stable Project identity without its observation clock', () => {
  const before = basis()
  delete before.source.repository
  delete before.source.repositorySnapshot
  before.source.githubProject = { owner: 'acme', type: 'org', number: 1 }
  before.source.projectSnapshot = { identity: before.source.identity!, project: { nodeId: 'PROJECT', title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/1', closed: false }, items: [], observedAt: '2026-01-01T00:00:00.000Z' }
  const after = structuredClone(before)
  after.source.projectSnapshot!.observedAt = '2026-01-02T00:00:00.000Z'
  expect(planningBasisFingerprint(after)).toBe(planningBasisFingerprint(before))
  after.source.projectSnapshot!.project.nodeId = 'OTHER'
  expect(planningBasisFingerprint(after)).not.toBe(planningBasisFingerprint(before))
})
