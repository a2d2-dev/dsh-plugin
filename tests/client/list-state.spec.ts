import { describe, expect, it } from 'vitest'
import {
  EMPTY_VALUE, emptyListState, groupList, listOptions, listValues, moveColumn, orderedColumns, queryList, reconcileListState, valueLabel,
  type ListColumn, type ListState,
} from '../../src/client/list-state.ts'

interface Row {
  id: string
  title: string
  status: string
  tags: readonly string[]
  amount: number
}

const row = (id: string, title: string, status: string, tags: readonly string[], amount = 0): Row => ({ id, title, status, tags, amount })
const columns: ListColumn<Row>[] = [
  { id: 'title', label: 'Title', values: item => [item.title] },
  { id: 'status', label: 'Status', values: item => [item.status] },
  { id: 'tags', label: 'Tags', values: item => item.tags },
  // Deliberately unrelated display text verifies that raw numbers control the order.
  { id: 'amount', label: 'Amount', values: item => [item.title], sortValue: item => item.amount },
]
const titleColumn = columns[0]!
const tagsColumn = columns[2]!
const stateWith = (patch: Partial<ListState>): ListState => ({ ...emptyListState(), ...patch })
const ids = (rows: readonly Row[]) => rows.map(item => item.id)
const query = (rows: readonly Row[], state: ListState) => queryList(rows, columns, state, item => item.title)

const rows: Row[] = [
  row('a', 'Deploy API', 'open', ['red']),
  row('b', 'deploy worker', 'review', ['blue']),
  row('c', 'Deploy docs', 'closed', ['red']),
  row('d', 'Ship API', 'open', ['red']),
  row('e', 'Deploy other', 'open', ['green']),
  row('f', 'Deploy database', 'open', ['red', 'blue', 'red']),
]

it('prunes removed optional column state without mutating or reviving it later',()=>{
  const original=stateWith({search:'deploy',filters:{removed:['old'],status:['open']},slice:{id:'removed',value:'old'},sort:{id:'removed',direction:'asc'},group:'removed',selected:'removed',hidden:['removed','tags'],order:['removed','title']})
  const next=reconcileListState(original,columns)
  expect(next).toMatchObject({search:'deploy',filters:{status:['open']},slice:null,sort:null,group:null,selected:null,hidden:['tags'],order:['title']})
  expect(reconcileListState(next,[...columns,{id:'removed',label:'Back',values:()=>[]}])).toEqual(next)
  expect(original.slice).toEqual({id:'removed',value:'old'})
})

describe('queryList', () => {
  it('ANDs trimmed case-insensitive search with column filters, and ORs selections within each column', () => {
    const state = stateWith({ search: '  DEPLOY  ', filters: { status: ['open', 'review'], tags: ['red', 'blue'] } })

    expect(ids(query(rows, state))).toEqual(['a', 'b', 'f'])
  })

  it('treats an empty selection and a removed column as inactive filters', () => {
    const state = stateWith({ filters: { status: [], removed: ['obsolete'], tags: ['blue'] } })

    expect(ids(query(rows, state))).toEqual(['b', 'f'])
  })

  it('intersects a multi-valued slice with search and filters, including a filter on the sliced column', () => {
    const state = stateWith({
      search: 'deploy', filters: { status: ['open'], tags: ['red'] }, slice: { id: 'tags', value: 'blue' },
    })

    expect(ids(query(rows, state))).toEqual(['f'])
    expect(query(rows, { ...state, slice: { id: 'tags', value: 'green' } })).toEqual([])
    expect(ids(query(rows, { ...state, slice: null }))).toEqual(['a', 'f'])
  })

  it('filters and slices missing or blank values using the empty-value sentinel', () => {
    const items = [row('missing', 'Missing', 'open', []), row('blank', 'Blank', 'closed', ['', '  ']), row('set', 'Set', 'open', ['red'])]

    expect(ids(query(items, stateWith({ filters: { tags: [EMPTY_VALUE] } })))).toEqual(['missing', 'blank'])
    expect(ids(query(items, stateWith({ filters: { status: ['open'] }, slice: { id: 'tags', value: EMPTY_VALUE } })))).toEqual(['missing'])
  })

  it.each([
    ['asc', ['one', 'two', 'ten', 'twenty']],
    ['desc', ['twenty', 'ten', 'two', 'one']],
  ] as const)('sorts numeric text naturally %s across the entire result before page slicing', (direction, expected) => {
    const items = [row('ten', 'Task 10', '', []), row('two', 'Task 2', '', []), row('twenty', 'Task 20', '', []), row('one', 'Task 1', '', [])]
    const result = query(items, stateWith({ sort: { id: 'title', direction } }))

    expect(ids(result)).toEqual(expected)
    expect(ids(result.slice(0, 2))).toEqual(expected.slice(0, 2))
    expect(ids(result.slice(2, 4))).toEqual(expected.slice(2, 4))
  })

  it.each([
    ['asc', ['negative-ten', 'negative-two', 'zero', 'fraction', 'ten']],
    ['desc', ['ten', 'fraction', 'zero', 'negative-two', 'negative-ten']],
  ] as const)('sorts raw numbers %s before page slicing, including negatives, fractions and zero', (direction, expected) => {
    const items = [
      row('fraction', 'A', '', [], 0.5), row('negative-two', 'B', '', [], -2), row('ten', 'C', '', [], 10),
      row('zero', 'D', '', [], 0), row('negative-ten', 'E', '', [], -10),
    ]
    const result = query(items, stateWith({ sort: { id: 'amount', direction } }))

    expect(ids(result)).toEqual(expected)
    expect(ids(result.slice(0, 2))).toEqual(expected.slice(0, 2))
    expect(ids(result.slice(2, 4))).toEqual(expected.slice(2, 4))
    expect(ids(result.slice(4, 6))).toEqual(expected.slice(4, 6))
  })
})

describe('values, options and groups', () => {
  it('deduplicates multi-values, drops blanks and supplies a labeled empty option only for empty rows', () => {
    const items = [
      row('missing', '', '', []), row('blank', '', '', ['', ' \t']),
      row('multi', '', '', ['red', 'red', '', 'blue']), row('shared', '', '', ['blue', 'red']),
      row('ten', '', '', ['tag10']), row('two', '', '', ['tag2']),
    ]
    const options = listOptions(tagsColumn, items)

    expect(listValues(tagsColumn, items[0]!)).toEqual([EMPTY_VALUE])
    expect(listValues(tagsColumn, items[1]!)).toEqual([EMPTY_VALUE])
    expect(listValues(tagsColumn, items[2]!)).toEqual(['red', 'blue'])
    expect(new Map(options.map(option => [option.value, option.count]))).toEqual(new Map([
      [EMPTY_VALUE, 2], ['red', 2], ['blue', 2], ['tag10', 1], ['tag2', 1],
    ]))
    expect(options.filter(option => option.value.startsWith('tag')).map(option => option.value)).toEqual(['tag2', 'tag10'])
    expect(valueLabel(EMPTY_VALUE)).toBe('（空值）')
    expect(valueLabel('red')).toBe('red')
    expect(listOptions(tagsColumn, [])).toEqual([])
  })

  it('places each row in all its groups once and keeps empty rows in an explicit group', () => {
    const items = [row('multi', '', '', ['tag10', 'tag2', 'tag2']), row('shared', '', '', ['tag2']), row('empty', '', '', [])]
    const groups = groupList(items, tagsColumn)

    expect(groups.filter(group => group.value !== EMPTY_VALUE).map(group => [group.value, ids(group.rows)])).toEqual([
      ['tag2', ['multi', 'shared']], ['tag10', ['multi']],
    ])
    expect(ids(groups.find(group => group.value === EMPTY_VALUE)!.rows)).toEqual(['empty'])
    expect(groups.find(group => group.value === 'tag2')!.rows[0]).toBe(items[0])
    expect(groups.find(group => group.value === 'tag10')!.rows[0]).toBe(items[0])
    expect(groupList([], tagsColumn)).toEqual([])
  })

  it('groups only rows that remain after filtering and slicing', () => {
    const visible = query(rows, stateWith({ filters: { status: ['open'] }, slice: { id: 'tags', value: 'blue' } }))

    expect(groupList(visible, tagsColumn).map(group => [group.value, ids(group.rows)])).toEqual([
      ['blue', ['f']], ['red', ['f']],
    ])
  })

  it('returns a fresh row container when grouping is disabled', () => {
    const groups = groupList(rows)

    expect(groups).toEqual([{ value: '', rows }])
    expect(groups[0]!.rows).not.toBe(rows)
    expect(groupList([])).toEqual([{ value: '', rows: [] }])
  })
})

describe('column order and visibility', () => {
  it.each([
    ['b', 'left', ['b', 'a', 'c']],
    ['b', 'right', ['a', 'c', 'b']],
    ['c', 'first', ['c', 'a', 'b']],
    ['a', 'last', ['b', 'c', 'a']],
    ['a', 'left', ['a', 'b', 'c']],
    ['c', 'right', ['a', 'b', 'c']],
    ['missing', 'first', ['a', 'b', 'c']],
  ] as const)('moves %s %s while preserving all other columns', (id, target, expected) => {
    const order = Object.freeze(['a', 'b', 'c'])
    const result = moveColumn(order, id, target)

    expect(result).toEqual(expected)
    expect(result).not.toBe(order)
  })

  it('handles an empty order and a single column at either boundary', () => {
    expect(moveColumn([], 'missing', 'last')).toEqual([])
    for (const target of ['left', 'right', 'first', 'last'] as const) expect(moveColumn(['only'], 'only', target)).toEqual(['only'])
  })

  it('ignores obsolete column ids, appends new columns and restores hidden columns in their saved positions', () => {
    const state = stateWith({ order: ['removed', 'tags', 'title'], hidden: ['tags', 'amount', 'removed'] })

    expect(orderedColumns(columns, state).map(column => column.id)).toEqual(['title', 'status'])
    expect(orderedColumns(columns, { ...state, hidden: [] }).map(column => column.id)).toEqual(['tags', 'title', 'status', 'amount'])
    expect(orderedColumns(columns, emptyListState())).toEqual(columns)
    expect(orderedColumns([], state)).toEqual([])
  })
})

it('keeps source observations, nested values, columns and state immutable through the display pipeline', () => {
  const items = [row('ten', 'Task 10', 'open', ['red', 'blue', 'red'], 10), row('two', 'Task 2', 'open', ['blue'], 2)]
  const sourceColumns = [...columns]
  const state = stateWith({
    filters: { status: ['open'], tags: ['blue'] }, sort: { id: 'amount', direction: 'asc' },
    group: 'tags', slice: { id: 'tags', value: 'blue' }, order: ['tags', 'title'], hidden: ['status'],
  })
  const snapshot = structuredClone({ items, state })
  for (const item of items) { Object.freeze(item.tags); Object.freeze(item) }
  Object.freeze(items)
  for (const column of sourceColumns) Object.freeze(column)
  Object.freeze(sourceColumns)
  for (const values of Object.values(state.filters)) Object.freeze(values)
  Object.freeze(state.filters)
  Object.freeze(state.sort)
  Object.freeze(state.slice)
  Object.freeze(state.order)
  Object.freeze(state.hidden)
  Object.freeze(state)

  const result = queryList(items, sourceColumns, state, item => item.title)
  expect(ids(result)).toEqual(['two', 'ten'])
  expect(result[0]).toBe(items[1])
  expect(listOptions(tagsColumn, items)).toEqual([{ value: 'blue', count: 2 }, { value: 'red', count: 1 }])
  const groups = groupList(result, tagsColumn)
  const visibleColumns = orderedColumns(sourceColumns, state)
  expect(moveColumn(state.order, 'title', 'first')).toEqual(['title', 'tags'])
  // Display containers are independent; editing them must not edit source containers.
  result.pop()
  groups[0]!.rows.pop()
  visibleColumns.pop()

  expect(items).toEqual(snapshot.items)
  expect(state).toEqual(snapshot.state)
  expect(sourceColumns).toEqual(columns)
  expect(listValues(tagsColumn, items[0]!)).toEqual(['red', 'blue'])
})

it('creates independent empty states so selections do not leak between lists', () => {
  const first = emptyListState()
  const second = emptyListState()
  first.filters.status = ['open']
  first.order.push(titleColumn.id)
  first.hidden.push(tagsColumn.id)

  expect(second).toEqual({ search: '', filters: {}, sort: null, group: null, slice: null, selected: null, hidden: [], order: [] })
})
