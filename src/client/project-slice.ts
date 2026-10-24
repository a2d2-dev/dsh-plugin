/**
 * Project view slices.
 *
 * GitHub's slice is a view UI state: a field plus the selected values. The view
 * record here does not name the field, so the panel resolves it from the slice
 * value in the entry URL and the items it already holds, then aggregates the
 * values into the same selectable buttons GitHub renders on the left.
 *
 * @module @a2d2/dsh-a2d2/src/client/project-slice
 */
import type { GitHubProjectItem } from '../work-sources/types.ts'

export interface SliceField { id: string; name: string; dataType: string }

/** Field types that carry a per-item value a slice could select. */
const sliceable = new Set(['MILESTONE', 'SINGLE_SELECT', 'ITERATION', 'TEXT', 'NUMBER', 'DATE', 'USER'])

/** The value a row has for one field; an absent value is the empty slice. */
export function sliceValueOf(item: GitHubProjectItem, fieldId: string): string {
  return item.fields.find(field => field.id === fieldId)?.value ?? ''
}

/**
 * Fields whose items contain one of the slice values. `visible` (the view's
 * own field order) is tried first so an ambiguous value prefers a field the
 * view actually shows.
 */
export function sliceCandidates(fields: SliceField[], items: GitHubProjectItem[], values: readonly string[], visible: readonly string[] = []): SliceField[] {
  const wanted = values.filter(Boolean)
  if (!wanted.length) return []
  const ordered = [...fields].sort((a, b) => {
    const left = visible.indexOf(a.id), right = visible.indexOf(b.id)
    return (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right)
  })
  return ordered.filter(field => sliceable.has(field.dataType) && wanted.some(value => items.some(item => sliceValueOf(item, field.id) === value)))
}

/** Counts per value over the view's matched items, in first-seen order. */
export function sliceAggregate(fieldId: string, items: GitHubProjectItem[]): { values: { value: string; count: number }[]; emptyCount: number } {
  const counts = new Map<string, number>()
  let emptyCount = 0
  for (const item of items) {
    const value = sliceValueOf(item, fieldId)
    if (!value) emptyCount++
    else counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return { values: [...counts].map(([value, count]) => ({ value, count })), emptyCount }
}

/**
 * Apply a slice selection. Selected values keep only their rows; with nothing
 * selected the slice still hides empty values unless `showEmpty` asks for them.
 */
export function applySlice(items: GitHubProjectItem[], fieldId: string, selected: ReadonlySet<string>, showEmpty: boolean): GitHubProjectItem[] {
  if (selected.size) return items.filter(item => selected.has(sliceValueOf(item, fieldId)))
  if (showEmpty) return items
  return items.filter(item => sliceValueOf(item, fieldId) !== '')
}
