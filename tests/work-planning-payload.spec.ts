import { expect, it } from 'vitest'
import { planningBasis, planningBasisFingerprint } from '../src/work-planning.ts'
import type { WorkSnapshot } from '../src/work-schema.ts'
import type { ContinuousWorkRule } from '../src/work-types.ts'

const now = '2026-01-01T00:00:00.000Z'
const repository = { owner: 'acme', repository: 'repo' }
function fixture(count = 46) {
  const identity = { login: 'alice', nodeId: 'ALICE', name: null }
  const observations = Array.from({ length: count }, (_, index) => ({ sequence: index + 1, issue: {
    nodeId: `ISSUE_${index + 1}`, number: index + 1, title: 'Work '.repeat(100), repository, state: 'open',
    labels: ['ready'], assignees: ['alice'], url: `https://github.com/acme/repo/issues/${index + 1}`,
    body: `ISSUE_BODY_${index}:` + 'B'.repeat(8192), observedAt: now, updatedAt: now,
  } }))
  const source = { id: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222', provider: 'github', repository, version: 1, enabled: true,
    sequence: 46, requests: {}, pages: [], observations, identity,
    repositorySnapshot: { sourceVersion: 1, identity, nodeIds: observations.map(item => item.issue.nodeId), observedAt: now },
    discovery: { state: 'idle', nextAttemptAt: now, failures: 0 },
  }
  const tasks = observations.map(({ issue }) => ({ id: issue.nodeId, projectId: 'project', agentId: 'agent', goal: 'Goal '.repeat(1000),
    specification: { version: 1, text: 'SPEC_BODY_' + 'S'.repeat(8192), acceptance: ['A'.repeat(8192)] },
    children: [], breakdown: [], progress: { stage: 'in-progress', specificationVersion: 1, summary: 'PROGRESS_BODY_' + 'P'.repeat(8192) },
  }))
  const state = { sources: [source], tasks, externalBindings: tasks.map(task => ({ nodeId: task.id, ref: { projectId: task.projectId, taskId: task.id } })), executions: [] } as unknown as WorkSnapshot
  const rule = { id: 'rule', sourceId: source.id, projectId: source.projectId, scope: { assignee: '*', labels: [] },
    resource: { runtimeId: 'host', workspaceId: 'workspace' }, model: { provider: 'fake', model: 'exact' }, agentPreset: 'agent', permissionPreset: 'safe',
    planning: { instruction: 'Complete the work', supplements: [], blocks: [], scopeVersion: 1 }, items: [],
  } as unknown as ContinuousWorkRule
  return { state, rule }
}

it('bounds a 46-candidate request with 8KB Issue bodies and canonical specifications', () => {
  const { state, rule } = fixture()
  const basis = planningBasis(state, rule)
  const json = JSON.stringify(basis)
  console.info(JSON.stringify({ observationsBytes: Buffer.byteLength(JSON.stringify(state.sources[0]!.observations)), basisCharacters: json.length, basisBytes: Buffer.byteLength(json), candidates: basis.candidates.length }))
  expect(json.length).toBeLessThanOrEqual(256 * 1024)
  expect(Buffer.byteLength(JSON.stringify(state.sources[0]!.observations))).toBeGreaterThan(300 * 1024)
  expect(basis.candidates.map(candidate => candidate.issue.nodeId)).toEqual(state.sources[0]!.observations.map(({ issue }) => issue.nodeId))
  for (const candidate of basis.candidates) {
    expect(candidate.issue.title.length).toBeLessThanOrEqual(300)
    expect(candidate.issue).not.toHaveProperty('body')
    expect((candidate.task as { goal: string }).goal.length).toBeLessThanOrEqual(2000)
    expect(candidate.task).toMatchObject({ specification: { version: 1 } })
  }
  for (const forbidden of ['ISSUE_BODY_', 'SPEC_BODY_', 'PROGRESS_BODY_', 'observations', 'pages', 'discovery', 'sequence', 'lastError', 'catalog']) expect(json).not.toContain(forbidden)
  expect(basis.source).toMatchObject({ provider: 'github', repository, sourceVersion: 1, candidateCount: 46 })
})

it('keeps the fingerprint stable for body and observation changes but fences canonical identities', () => {
  const { state, rule } = fixture()
  const before = planningBasisFingerprint(planningBasis(state, rule))
  state.sources[0]!.observations.reverse()
  for (const item of state.sources[0]!.observations) { item.issue.body = 'new body'.repeat(10000); item.sequence++; item.issue.title = 'Changed live title' }
  state.tasks[0]!.specification.text = 'Changed specification body without a new version'
  expect(planningBasisFingerprint(planningBasis(state, rule))).toBe(before)
  state.tasks[0]!.agentId = 'other-agent'
  expect(planningBasisFingerprint(planningBasis(state, rule))).not.toBe(before)
})

it('bounds explanatory text deterministically without dropping candidate identities', () => {
  const { state, rule } = fixture()
  // Escaping makes these <=2000-character goals much larger in serialized JSON.
  for (const task of state.tasks) task.goal = '\u0001'.repeat(5000)
  const basis = planningBasis(state, rule)
  expect(JSON.stringify(basis).length).toBeLessThanOrEqual(256 * 1024)
  expect(basis.candidates.map(candidate => candidate.issue.nodeId)).toEqual(state.sources[0]!.observations.map(({ issue }) => issue.nodeId))
  expect(JSON.stringify(planningBasis(state, rule))).toBe(JSON.stringify(basis))
  const before = planningBasisFingerprint(basis)
  state.sources[0]!.observations[0]!.issue.title = 'Short title'
  expect(planningBasisFingerprint(planningBasis(state, rule))).toBe(before)
  state.tasks[0]!.goal += 'Changed beyond the summary'
  expect(planningBasisFingerprint(planningBasis(state, rule))).not.toBe(before)
})
