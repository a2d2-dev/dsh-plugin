import type { WorkExecution } from '../work-types.ts'

/** Browser-safe execution state rule, shared by structural and runtime guards. */
export function continuationInFlight(execution: WorkExecution): boolean {
  const operation = execution.continuation
  return !!operation && operation.phase !== 'received'
    && !(operation.phase === 'delivered' && operation.protocolVersion === undefined)
}
