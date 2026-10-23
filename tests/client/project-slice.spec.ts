import { expect, it } from 'vitest'
import { applySlice, sliceAggregate, sliceCandidates, sliceValueOf } from '../../src/client/project-slice.ts'
import type { GitHubProjectItem } from '../../src/work-sources/types.ts'

const item = (id: string, value: string | undefined): GitHubProjectItem => ({
  id: `PVTI_${id}`, kind: 'issue', archived: false, issueNodeId: id, title: id,
  fields: value === undefined ? [] : [{ id: 'F_ms', name: 'Milestone', type: 'text', value }], fieldsPartial: false,
})
const fields = [
  { id: 'F_title', name: 'Title', dataType: 'TITLE' },
  { id: 'F_ms', name: 'Milestone', dataType: 'MILESTONE' },
  { id: 'F_status', name: 'Status', dataType: 'SINGLE_SELECT' },
]

it('resolves the slice field from the URL value and aggregates its counts', () => {
  const items = [item('A', '3.0'), item('B', '3.0'), item('C', '3.1'), item('D', undefined)]
  expect(sliceCandidates(fields, items, ['3.0']).map(field => field.name)).toEqual(['Milestone'])
  expect(sliceCandidates(fields, items, [''])).toEqual([])
  expect(sliceAggregate('F_ms', items)).toEqual({ values: [{ value: '3.0', count: 2 }, { value: '3.1', count: 1 }], emptyCount: 1 })
  expect(sliceValueOf(items[0]!, 'F_ms')).toBe('3.0')
  expect(sliceValueOf(items[3]!, 'F_ms')).toBe('')
})

it('filters by selected values, hides empty values when nothing is selected, and keeps them on request', () => {
  const items = [item('A', '3.0'), item('B', '3.0'), item('C', '3.1'), item('D', undefined)]
  expect(applySlice(items, 'F_ms', new Set(['3.0']), false).map(row => row.id)).toEqual(['PVTI_A', 'PVTI_B'])
  expect(applySlice(items, 'F_ms', new Set(['3.0', '3.1']), false).map(row => row.id)).toEqual(['PVTI_A', 'PVTI_B', 'PVTI_C'])
  expect(applySlice(items, 'F_ms', new Set(), false).map(row => row.id)).toEqual(['PVTI_A', 'PVTI_B', 'PVTI_C'])
  expect(applySlice(items, 'F_ms', new Set(), true).map(row => row.id)).toEqual(['PVTI_A', 'PVTI_B', 'PVTI_C', 'PVTI_D'])
})
