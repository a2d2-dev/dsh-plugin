import { z } from 'zod'
import { checkpointSchema } from '../work-sources/schema.ts'
import type { ProjectCheckpoint } from '../work-sources/types.ts'

/** One immutable pagination delta; no previous means exact base arrays. */
export const checkpointChunkSchema = z.object({
  previous: z.string().regex(/^[0-9a-f-]{36}\.json$/).optional(),
  itemCount: z.number().int().nonnegative(), issueCount: z.number().int().nonnegative(),
  metadata: checkpointSchema.omit({ items: true, issues: true }),
  items: checkpointSchema.shape.items, issues: checkpointSchema.shape.issues,
}).strict()
export type CheckpointChunk = z.infer<typeof checkpointChunkSchema>

/** Append/update only when that operation can reproduce the exact array order. */
function changes<T>(before: T[], after: T[], key: (value: T) => string): T[] | undefined {
  const previous = new Map(before.map(value => [key(value), value]))
  if (previous.size !== before.length || new Set(after.map(key)).size !== after.length || after.length < before.length
    || before.some((value, index) => key(value) !== key(after[index]!))) return undefined
  return after.filter(value => !previous.has(key(value)) || JSON.stringify(value) !== JSON.stringify(previous.get(key(value))))
}
export function checkpointChunk(value: ProjectCheckpoint, previous?: { ref: string; value: ProjectCheckpoint }): CheckpointChunk {
  const { items, issues, ...metadata } = value
  const counts = { itemCount: items.length, issueCount: issues.length }
  const itemChanges = previous && changes(previous.value.items, items, item => item.id)
  const issueChanges = previous && changes(previous.value.issues, issues, issue => issue.nodeId)
  return previous && itemChanges && issueChanges
    ? { previous: previous.ref, ...counts, metadata, items: itemChanges, issues: issueChanges }
    : { ...counts, metadata, items, issues }
}
export function applyCheckpointChunk(chunk: CheckpointChunk, previous?: ProjectCheckpoint): ProjectCheckpoint {
  if (!chunk.previous) {
    if (chunk.items.length !== chunk.itemCount || chunk.issues.length !== chunk.issueCount) throw new Error('Incomplete work checkpoint archive')
    return { ...chunk.metadata, items: chunk.items, issues: chunk.issues }
  }
  if (!previous) throw new Error('Incomplete work checkpoint archive')
  const items = new Map(previous.items.map(item => [item.id, item])), issues = new Map(previous.issues.map(issue => [issue.nodeId, issue]))
  for (const item of chunk.items) items.set(item.id, item)
  for (const issue of chunk.issues) issues.set(issue.nodeId, issue)
  if (items.size !== chunk.itemCount || issues.size !== chunk.issueCount) throw new Error('Incomplete work checkpoint archive')
  return { ...chunk.metadata, items: [...items.values()], issues: [...issues.values()] }
}
