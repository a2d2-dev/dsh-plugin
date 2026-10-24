/** Local display state only: never sends commands or changes source observations. */
export interface ListColumn<T> {
  id: string
  label: string
  values: (row: T) => readonly string[]
  sortValue?: (row: T) => string | number
  protected?: boolean
  groupable?: boolean
  unsupported?: string
}
export interface ListState {
  search: string
  filters: Record<string, string[]>
  sort: { id: string; direction: 'asc' | 'desc' } | null
  group: string | null
  slice: { id: string; value: string } | null
  selected: string | null
  hidden: string[]
  order: string[]
}
export const EMPTY_VALUE = '\u0000empty'
export const emptyListState = (): ListState => ({ search: '', filters: {}, sort: null, group: null, slice: null, selected: null, hidden: [], order: [] })
export function reconcileListState(state: ListState, columns: readonly { id: string }[]): ListState {
  const ids = new Set(columns.map(column => column.id))
  return { ...state, filters: Object.fromEntries(Object.entries(state.filters).filter(([id]) => ids.has(id))),
    sort: state.sort && ids.has(state.sort.id) ? state.sort : null,
    group: state.group && ids.has(state.group) ? state.group : null,
    slice: state.slice && ids.has(state.slice.id) ? state.slice : null,
    selected: state.selected && ids.has(state.selected) ? state.selected : null,
    hidden: state.hidden.filter(id => ids.has(id)), order: state.order.filter(id => ids.has(id)) }
}
export function listValues<T>(column: ListColumn<T>, row: T): readonly string[] {
  const values = column.values(row).filter(value => value.trim() !== '')
  return values.length ? [...new Set(values)] : [EMPTY_VALUE]
}
export const valueLabel = (value: string): string => value === EMPTY_VALUE ? '（空值）' : value
export function listOptions<T>(column: ListColumn<T>, rows: readonly T[]): { value: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const row of rows) for (const value of listValues(column, row)) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => compare(a.value, b.value))
}
const compare = (a: string | number, b: string | number): number => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
export function queryList<T>(rows: readonly T[], columns: readonly ListColumn<T>[], state: ListState, searchText: (row: T) => string): T[] {
  const byId = new Map(columns.map(column => [column.id, column]))
  const search = state.search.trim().toLocaleLowerCase()
  const filtered = rows.filter(row => (!search || searchText(row).toLocaleLowerCase().includes(search))
    && Object.entries(state.filters).every(([id, values]) => !values.length || !byId.has(id) || listValues(byId.get(id)!, row).some(value => values.includes(value)))
    && (!state.slice || !byId.has(state.slice.id) || listValues(byId.get(state.slice.id)!, row).includes(state.slice.value)))
  const column = state.sort && byId.get(state.sort.id)
  if (column && !column.unsupported) filtered.sort((a, b) => compare(column.sortValue?.(a) ?? listValues(column, a).join(', '), column.sortValue?.(b) ?? listValues(column, b).join(', ')) * (state.sort?.direction === 'desc' ? -1 : 1))
  return filtered
}
/** Multi-valued groups may include the same row in several groups, explicitly. */
export function groupList<T>(rows: readonly T[], column?: ListColumn<T>): { value: string; rows: T[] }[] {
  if (!column) return [{ value: '', rows: [...rows] }]
  const groups = new Map<string, T[]>()
  for (const row of rows) for (const value of listValues(column, row)) groups.set(value, [...(groups.get(value) ?? []), row])
  return [...groups].sort(([a], [b]) => compare(a, b)).map(([value, rows]) => ({ value, rows }))
}
export function orderedColumns<T>(columns: readonly ListColumn<T>[], state: ListState): ListColumn<T>[] {
  const ids = [...state.order.filter(id => columns.some(column => column.id === id)), ...columns.filter(column => !state.order.includes(column.id)).map(column => column.id)]
  return ids.filter(id => !state.hidden.includes(id)).map(id => columns.find(column => column.id === id)!)
}
export function moveColumn(order: readonly string[], id: string, target: 'left' | 'right' | 'first' | 'last'): string[] {
  const next = [...order], index = next.indexOf(id)
  if (index < 0) return next
  const to = target === 'first' ? 0 : target === 'last' ? next.length - 1 : index + (target === 'left' ? -1 : 1)
  if (to < 0 || to >= next.length) return next
  next.splice(index, 1); next.splice(to, 0, id)
  return next
}
