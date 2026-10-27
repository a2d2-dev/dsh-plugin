import type { ContinuousWorkRule } from './work-types.ts'

/** Queue exclusions include legacy saved plans without manufacturing a new plan. */
export function continuousBlocks(rule: ContinuousWorkRule): string[] {
  return [...new Set([...(rule.blocks ?? []), ...(rule.planning?.blocks ?? [])])]
}
