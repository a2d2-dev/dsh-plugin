import { expect, it } from 'vitest'
import { screeningBasis, screeningKey, validateScreening } from '../src/work-screening.ts'
import { issueSchema } from '../src/work-sources/schema.ts'
import type { GitHubIssue, WorkSource } from '../src/work-sources/types.ts'
import type { ContinuousWorkRule } from '../src/work-types.ts'

const basis = { instruction: '只处理缺陷', candidates: [{ nodeId: 'I1', number: 1, title: 'Bug', body: 'Reproducible failure', repository: { owner: 'acme', repository: 'repo' }, labels: [], assignees: [] }] }
it.each([
  { decisions: [] },
  { decisions: [{ nodeId: 'foreign', matches: true, reason: '范围外' }] },
  { decisions: [{ nodeId: 'I1', matches: true, reason: '匹配' }, { nodeId: 'I1', matches: false, reason: '重复' }] },
  { decisions: [{ nodeId: 'I1', matches: 'true', reason: '类型错误' }] },
  { decisions: [{ nodeId: 'I1', matches: true, reason: '' }] },
])('rejects incomplete, foreign, duplicate or malformed screening decisions: %j', output => {
  expect(() => validateScreening(output, basis)).toThrow()
})
it('accepts an explicit rejection with its reason', () => {
  expect(validateScreening({ decisions: [{ nodeId: 'I1', matches: false, reason: '缺少可复现步骤' }] }, basis).decisions[0]!.matches).toBe(false)
})

const identity = { login: 'alice', nodeId: 'U1', name: null }
const issue: GitHubIssue = { ...basis.candidates[0]!, state: 'open', url: 'https://github.com/acme/repo/issues/1', milestone: { number: 3, title: '3.0' }, updatedAt: '2026-10-26T00:00:00Z', observedAt: '2026-10-26T00:00:00Z' }
const rule: ContinuousWorkRule = { id: 'rule', projectId: 'project', sourceId: 'source', version: 1, enabled: false, items: [], resource: { runtimeId: 'host', workspaceId: 'workspace' }, agentPreset: 'agent', permissionPreset: 'safe', queue: { concurrency: 1, refreshMinutes: 1, order: 'oldest', filterPrompt: '需要milestone:3.0，状态为待处理或进行中' }, scope: { assignee: '*', labels: [] }, model: { provider: 'test', model: 'test' } }
function source(project: boolean): WorkSource {
  return { id: 'source', projectId: 'project', provider: 'github', enabled: true, version: 1, sequence: 1, requests: {}, pages: [], observations: [{ issue: structuredClone(issue), sequence: 1 }],
    ...(project ? { githubProject: { owner: 'acme', type: 'org', number: 1 }, projectSnapshot: { identity, observedAt: issue.observedAt, project: { nodeId: 'P1', title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/1', closed: false }, items: [
      { id: 'unrelated', kind: 'issue', archived: false, issueNodeId: 'I2', fields: [{ id: 'status', name: 'Status', type: 'single-select', value: 'Done' }], fieldsPartial: false },
      { id: 'archived', kind: 'issue', archived: true, issueNodeId: 'I1', fields: [{ id: 'status', name: 'Status', type: 'single-select', value: 'Done' }], fieldsPartial: false },
      { id: 'matching', kind: 'issue', archived: false, issueNodeId: 'I1', fields: [{ id: 'status', name: 'Status', type: 'single-select', value: 'In Progress' }, { id: 'milestone', name: 'Milestone', type: 'text', value: '3.0' }], fieldsPartial: true },
    ] } } : { repository: issue.repository, repositorySnapshot: { sourceVersion: 1, identity, nodeIds: ['I1'], observedAt: issue.observedAt } }) }
}
it('joins fields by stable Issue identity, preserving partialness and excluding archived items', () => {
  const project = source(true)
  expect(screeningBasis(rule, project).candidates).toEqual([expect.objectContaining({ nodeId: 'I1', milestone: { number: 3, title: '3.0' }, projectItem: { fields: project.projectSnapshot!.items[2]!.fields, fieldsPartial: true } })])
  project.projectSnapshot!.items[2]!.archived = true
  expect(screeningBasis(rule, project).candidates).toEqual([])
})
it('passes repository milestones without fabricating Project workflow status, and preserves legacy unknown versus null', () => {
  const repository = source(false)
  expect(screeningBasis(rule, repository).candidates[0]).toMatchObject({ milestone: issue.milestone })
  expect(screeningBasis(rule, repository).candidates[0]).not.toHaveProperty('projectItem')
  const observed = repository.observations[0]!.issue
  observed.milestone = null
  expect(issueSchema.parse(observed).milestone).toBeNull()
  expect(screeningBasis(rule, repository).candidates[0]!.milestone).toBeNull()
  delete observed.milestone
  expect(issueSchema.parse(observed).milestone).toBeUndefined()
  expect(JSON.stringify(screeningBasis(rule, repository))).not.toContain('milestone"')
})
it('invalidates the screening key on milestone, Project field and partialness changes, without relying on Issue updatedAt', () => {
  const repository = source(false), initial = screeningKey(rule, repository)
  repository.observations[0]!.issue.milestone = { number: 4, title: '4.0' }
  expect(screeningKey(rule, repository)).not.toBe(initial)
  const project = source(true), before = screeningKey(rule, project)
  project.projectSnapshot!.items[2]!.fields[0]!.value = 'Todo'
  const changed = screeningKey(rule, project)
  expect(changed).not.toBe(before)
  project.projectSnapshot!.items[2]!.fieldsPartial = false
  expect(screeningKey(rule, project)).not.toBe(changed)
  expect(project.observations[0]!.issue.updatedAt).toBe(issue.updatedAt)
})
