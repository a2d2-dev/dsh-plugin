import { expect, it } from 'vitest'
import { projectFieldCell } from '../../src/client/project-fields.ts'
import type { GitHubIssue, GitHubProjectItem } from '../../src/work-sources/types.ts'

const field = (dataType: string, id = `F_${dataType.toLowerCase()}`, name = dataType) => ({ id, name, dataType })
const reference = (nodeId: string, number: number, title = `Item ${number}`, kind: 'issues' | 'pull' = 'issues', state: 'open' | 'closed' = 'open') => ({
  nodeId, number, title, state, repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' },
  url: `https://github.com/a2d2-dev/dsh-plugin/${kind}/${number}`,
})
const issue: GitHubIssue = {
  nodeId: 'I_160', url: 'https://github.com/a2d2-dev/dsh-plugin/issues/160', number: 160, title: 'A',
  body: 'Fixture A', repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' }, state: 'open', labels: ['qa'], assignees: ['imneov'],
  updatedAt: '2026-10-22T08:32:38Z', observedAt: '2026-10-22T08:19:20Z',
  createdAt: '2026-10-22T02:10:41Z', closedAt: null,
  parent: reference('I_150', 150, 'Parent work'),
  subIssuesSummary: { total: 11, completed: 10 },
  linkedPullRequests: [{ number: 143, title: 'feat: deliver', url: 'https://github.com/a2d2-dev/dsh-plugin/pull/143', state: 'merged', draft: false }],
}
const item: GitHubProjectItem = {
  id: 'PVTI_1', kind: 'issue', archived: false, issueNodeId: issue.nodeId, title: issue.title, url: issue.url,
  fields: [{ id: 'F_status', name: 'Status', type: 'single-select', value: 'In Progress' }], fieldsPartial: false,
}

it('projects GitHub built-in Project fields from real issue observations', () => {
  expect(projectFieldCell(field('SINGLE_SELECT', 'F_status', 'Status'), issue, item).text).toBe('In Progress')
  expect(projectFieldCell(field('ASSIGNEES'), issue, item).text).toBe('imneov')
  expect(projectFieldCell(field('LABELS'), issue, item).text).toBe('qa')
  expect(projectFieldCell(field('REPOSITORY'), issue, item).text).toBe('a2d2-dev/dsh-plugin')
  expect(projectFieldCell(field('SUB_ISSUES_PROGRESS'), issue, item).text).toBe('10/11 · 90%')
  expect(projectFieldCell(field('PARENT_ISSUE'), issue, item)).toEqual({ text: '#150 Parent work', parts: [{ label: '#150', url: 'https://github.com/a2d2-dev/dsh-plugin/issues/150' }, { label: ' Parent work' }] })
  expect(projectFieldCell(field('LINKED_PULL_REQUESTS'), issue, item).text).toBe('#143')
  expect(projectFieldCell(field('CREATED'), issue, item).text).toBe('10-22')
  expect(projectFieldCell(field('UPDATED'), issue, item).text).toBe('10-22')
  expect(projectFieldCell(field('CLOSED'), issue, item).text).toBe('—')
})

it('falls back to native children and item facts, and never invents values it did not read', () => {
  const partial: GitHubIssue = { ...issue, subIssuesSummary: undefined, linkedPullRequests: [], closedAt: '2026-10-22T09:00:00Z', subIssues: { items: [reference('I_1', 1), reference('I_2', 2, 'Item 2', 'issues', 'closed')], totalCount: 2, hasNextPage: true } }
  expect(projectFieldCell(field('SUB_ISSUES_PROGRESS'), partial, item).text).toBe('1/2 · 50% · 部分观察')
  expect(projectFieldCell(field('LINKED_PULL_REQUESTS'), partial, item).text).toBe('—')
  expect(projectFieldCell(field('CLOSED'), partial, item).text).toBe('10-22')
  const pull: GitHubProjectItem = { id: 'PVTI_2', kind: 'pull-request', archived: false, title: 'PR', url: 'https://github.com/a2d2-dev/dsh-plugin/pull/2',
    facts: { assignees: [], labels: [], state: 'open', repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' }, reviewers: ['imneov'], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }, fields: [], fieldsPartial: false }
  expect(projectFieldCell(field('REVIEWERS'), undefined, pull).text).toBe('imneov')
  expect(projectFieldCell(field('CREATED'), undefined, pull).text).toBe('10-01')
  expect(projectFieldCell(field('UPDATED'), undefined, pull).text).toBe('10-02')
  expect(projectFieldCell(field('USER'), undefined, pull).text).toBe('未读取此类字段值')
})
