import { expect, it } from 'vitest'
import { isEmptyColumn, orderProjectRows, projectColumns } from '../../src/client/project-rows.ts'
import type { GitHubIssue, GitHubProjectItem } from '../../src/work-sources/types.ts'

const reference = (nodeId: string, number: number, title: string) => ({ nodeId, number, title, state: 'open' as const, repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' }, url: `https://github.com/a2d2-dev/dsh-plugin/issues/${number}` })
const issue = (nodeId: string, number: number, parent?: string): GitHubIssue => ({
  nodeId, url: `https://github.com/a2d2-dev/dsh-plugin/issues/${number}`, number, title: `Issue ${number}`, body: null,
  repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' }, state: 'open', labels: [], assignees: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z', observedAt: '2026-10-22T00:00:00Z',
  ...(parent ? { parent: reference(parent, 1, 'Parent') } : {}),
})
const item = (nodeId: string): GitHubProjectItem => ({ id: `PVTI_${nodeId}`, kind: 'issue', archived: false, issueNodeId: nodeId, title: nodeId, url: `https://github.com/a2d2-dev/dsh-plugin/issues/${nodeId}`, fields: [], fieldsPartial: false })

it('nests native children under their parent and keeps collapsed parents as single rows', () => {
  const issues = [issue('I_1', 1), issue('I_2', 2, 'I_1'), issue('I_3', 3, 'I_1'), issue('I_4', 4)]
  const items = ['I_1', 'I_2', 'I_3', 'I_4'].map(item)
  const ordered = orderProjectRows(items, issues, new Set())
  expect(ordered.map(row => [row.issue?.number, row.depth])).toEqual([[1, 0], [2, 1], [3, 1], [4, 0]])
  const collapsed = orderProjectRows(items, issues, new Set(['I_1']))
  expect(collapsed.map(row => [row.issue?.number, row.depth])).toEqual([[1, 0], [4, 0]])
  // A parent outside the visible slice must not invent nesting.
  expect(orderProjectRows([items[1]!], issues, new Set()).map(row => row.depth)).toEqual([0])
})

it('hides only fully empty columns and keeps unread field types visible', () => {
  const rows = orderProjectRows([item('I_1')], [issue('I_1', 1)], new Set())
  const fields = [
    { id: 'F_status', name: 'Status', dataType: 'SINGLE_SELECT' },
    { id: 'F_milestone', name: 'Milestone', dataType: 'MILESTONE' },
    { id: 'F_reviewers', name: 'Reviewers', dataType: 'REVIEWERS' },
    { id: 'F_user', name: 'Owner', dataType: 'USER' },
  ]
  expect(projectColumns(fields, rows).map(field => field.name)).toEqual(['Owner'])
  expect(isEmptyColumn(fields[1]!, rows)).toBe(true)
  expect(isEmptyColumn(fields[3]!, rows)).toBe(false)
  const wide = [{ id: 'F_repository', name: 'Repository', dataType: 'REPOSITORY' }, { id: 'F_created', name: 'Created', dataType: 'CREATED' }]
  expect(projectColumns(wide, rows).map(field => field.name)).toEqual([])
  expect(projectColumns(wide, rows, true).map(field => field.name)).toEqual(['Repository', 'Created'])
})
