import { expect, it } from 'vitest'
import { planningBasis, planningBasisFingerprint, planningBasisCharacterLimit, planningSchema } from '../src/work-planning.ts'
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
  const state = { sources: [source], tasks, externalBindings: tasks.map((task, index) => ({ nodeId: task.id, ref: { projectId: task.projectId, taskId: task.id }, accepted: observations[index]!.issue, lastObserved: observations[index]!.issue })), executions: [] } as unknown as WorkSnapshot
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
  expect(json.length).toBeLessThanOrEqual(planningBasisCharacterLimit(46))
  expect(Buffer.byteLength(JSON.stringify(state.sources[0]!.observations))).toBeGreaterThan(300 * 1024)
  expect(basis.candidates.map(candidate => candidate.issue.nodeId)).toEqual(state.sources[0]!.observations.map(({ issue }) => issue.nodeId))
  for (const candidate of basis.candidates) {
    expect(candidate.issue.title.length).toBeLessThanOrEqual(300)
    expect(candidate.issue).not.toHaveProperty('body')
    expect(candidate.issue).toHaveProperty('url', `https://github.com/acme/repo/issues/${candidate.issue.number}`)
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

it('preserves goal fingerprints across JSON persistence and detects truncated Unicode changes', () => {
  const { state, rule } = fixture(1)
  state.tasks[0]!.goal = '前'.repeat(2000) + '😀'
  const basis = planningBasis(state, rule)
  const fingerprint = planningBasisFingerprint(basis)
  expect(basis.candidates[0]!.task).toMatchObject({ goal: '前'.repeat(2000), goalTruncated: true })
  expect(planningBasisFingerprint(JSON.parse(JSON.stringify(basis)))).toBe(fingerprint)
  state.sources[0]!.observations[0]!.issue.body = 'Changed body'
  state.tasks[0]!.progress!.summary = 'Changed progress'
  expect(planningBasisFingerprint(planningBasis(state, rule))).toBe(fingerprint)
  state.tasks[0]!.goal = '前'.repeat(2000) + '😃'
  expect(planningBasis(state, rule).candidates[0]!.task).toMatchObject({ goal: '前'.repeat(2000) })
  expect(planningBasisFingerprint(planningBasis(state, rule))).not.toBe(fingerprint)
})

it('bounds explanatory text deterministically without dropping candidate identities', () => {
  const { state, rule } = fixture()
  // Escaping makes these <=2000-character goals much larger in serialized JSON.
  for (const task of state.tasks) task.goal = '\u0001'.repeat(5000)
  const basis = planningBasis(state, rule)
  expect(JSON.stringify(basis).length).toBeLessThanOrEqual(256 * 1024)
  expect(basis.candidates[0]!.task).toMatchObject({ goal: '', goalTruncated: true })
  expect(basis.candidates.every(candidate => candidate.issue.title.length === 300)).toBe(true)
  expect(basis.candidates.map(candidate => candidate.issue.nodeId)).toEqual(state.sources[0]!.observations.map(({ issue }) => issue.nodeId))
  expect(JSON.stringify(planningBasis(state, rule))).toBe(JSON.stringify(basis))
  const before = planningBasisFingerprint(basis)
  state.sources[0]!.observations[0]!.issue.title = 'Short title'
  expect(planningBasisFingerprint(planningBasis(state, rule))).toBe(before)
  state.tasks[0]!.goal += 'Changed beyond the summary'
  expect(planningBasisFingerprint(planningBasis(state, rule))).not.toBe(before)
})

it('summarizes Project item catalogs without losing membership or relationship safety facts', () => {
  const { state, rule } = fixture()
  const source = state.sources[0]!
  delete source.repository
  delete source.repositorySnapshot
  source.githubProject = { owner: 'acme', type: 'org', number: 1 }
  source.projectSnapshot = { identity: source.identity!, project: { nodeId: 'PROJECT', title: 'Project'.repeat(1000), url: 'https://github.com/orgs/acme/projects/1', closed: false }, observedAt: now,
    items: source.observations.map(({ issue }) => ({ id: `ITEM_${issue.nodeId}`, kind: 'issue', archived: false, issueNodeId: issue.nodeId, title: 'PROJECT_ITEM_TEXT'.repeat(1000), fields: [], fieldsPartial: false })),
  }
  const child = source.observations[1]!.issue
  source.observations[0]!.issue.subIssues = { items: [child], totalCount: 2, hasNextPage: true }
  child.parent = source.observations[0]!.issue
  const basis = planningBasis(state, rule)
  expect(basis.source.projectSnapshot).not.toHaveProperty('items')
  expect(basis.source.projectSnapshot?.project).toMatchObject({ title: 'Project'.repeat(1000).slice(0, 300) })
  expect(JSON.stringify(basis)).not.toContain('PROJECT_ITEM_TEXT')
  expect(JSON.stringify(basis).length).toBeLessThanOrEqual(planningBasisCharacterLimit(46))
  expect(basis.candidates.map(candidate => candidate.issue.nodeId)).toEqual(source.observations.map(({ issue }) => issue.nodeId))
  expect(basis.candidates[0]!.issue.subIssues).toEqual({ items: [{ nodeId: 'ISSUE_2', state: 'open', canonicalAccepted: false }], totalCount: 2, hasNextPage: true })
  expect(basis.candidates[1]!.issue.parent).toEqual({ nodeId: 'ISSUE_1', state: 'open', canonicalAccepted: false })
})

it('retains execution authority and tool control while excluding diagnostic and control prose', () => {
  const { state, rule } = fixture(1)
  const task = state.tasks[0]!
  const authority = { id: 'execution', ref: { projectId: task.projectId, taskId: task.id }, agentId: task.agentId, owner: 'owner', epoch: 3,
    resource: rule.resource, model: rule.model, agentPreset: rule.agentPreset, permissionPreset: rule.permissionPreset, session: { runtimeId: 'host', sessionId: 'session' }, state: 'paused' }
  state.executions.push({ ...authority, control: { action: 'pause', status: 'accepted', commandId: 'command', reason: 'CONTROL_BODY'.repeat(10000) }, error: { code: 'failure', message: 'ERROR_BODY'.repeat(10000) } } as WorkSnapshot['executions'][number])
  const basis = planningBasis(state, rule)
  expect(basis.candidates[0]!.execution).toEqual({ ...authority, control: { action: 'pause', status: 'accepted' } })
  expect(JSON.stringify(basis)).not.toContain('CONTROL_BODY')
  expect(JSON.stringify(basis)).not.toContain('ERROR_BODY')
})

it('derives Issue URLs from repository identity rather than copying observation links', () => {
  const { state, rule } = fixture(1)
  state.sources[0]!.observations[0]!.issue.url = 'https://untrusted.example/arbitrary?token=private'
  const basis = planningBasis(state, rule)
  expect(basis.candidates[0]!.issue.url).toBe('https://github.com/acme/repo/issues/1')
  expect(JSON.stringify(basis)).not.toContain('untrusted.example')
})

it('uses title truncation when the remaining explanatory goals are empty', () => {
  const { state, rule } = fixture(1)
  state.tasks[0]!.goal = ''
  state.sources[0]!.observations[0]!.issue.title = '\u0001'.repeat(300)
  rule.planning!.instruction = 'x'.repeat(67000)
  const basis = planningBasis(state, rule)
  expect(basis.candidates).toHaveLength(1)
  expect(basis.candidates[0]!.issue).toMatchObject({ nodeId: 'ISSUE_1', title: '' })
  expect(JSON.stringify(basis).length).toBeLessThanOrEqual(planningBasisCharacterLimit(1))
})

it('fails explicitly when mandatory scope cannot fit without dropping candidates', () => {
  const { state, rule } = fixture()
  rule.planning!.supplements = Array.from({ length: 4 }, () => 'Authorized instruction '.repeat(4000))
  expect(() => planningBasis(state, rule)).toThrowError(/Planning identities and instructions exceed request limit: requestCharacters=\d+, candidates=46, limit=253952/)
  expect(() => planningBasis(state, rule)).toThrowError(expect.objectContaining({ code: 'planning-payload-too-large' }))
  expect(state.sources[0]!.observations).toHaveLength(46)
  expect(state.sources[0]!.observations.map(({ issue }) => issue.nodeId)).toEqual(Array.from({ length: 46 }, (_, index) => `ISSUE_${index + 1}`))
})

it('reads existing saved plans without rewriting their basis or persistent fields', () => {
  const { state, rule } = fixture(1)
  const compact = planningBasis(state, rule)
  const legacy = { ...compact, source: state.sources[0], candidates: [{ issue: state.sources[0]!.observations[0]!.issue }] }
  const planning = { ...rule.planning, draftVersion: 1, plans: [{ version: 1, draftVersion: 1, basis: legacy, steps: [], createdAt: now }] }
  expect(planningSchema.parse(planning)).toEqual(planning)
})
