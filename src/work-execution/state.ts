import type { WorkExecution } from '../work-types.ts'

/** Browser-safe execution state rule, shared by structural and runtime guards. */
export function continuationInFlight(execution: WorkExecution): boolean {
  return !!execution.continuation && execution.continuation.phase !== 'delivered'
}
