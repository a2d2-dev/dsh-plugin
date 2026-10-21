import type { WorkExecution } from '../work-types.ts'

/** Trusted host boundary. check must be read-only and reject missing capabilities before reservation. */
export interface WorkExecutionHost {
  connect(authorize: (sessionId: string, messages?: readonly import('../work-types.ts').NativeWorkMessage[]) => Promise<boolean>): void
  connectObservation?(scope: import('./observation.ts').ObservationScope): void
  observation?(execution: WorkExecution, associations?: readonly import('../work-types.ts').SessionAssociation[]): Promise<import('./observation.ts').ExecutionObservation>
  wake(execution: WorkExecution): Promise<void>
  status(execution: WorkExecution): 'running' | 'idle' | 'inactive'
  choices(): Promise<import('../work-types.ts').HostExecutionChoices>
  check(request: Pick<WorkExecution, 'resource' | 'session' | 'sessionMode' | 'agentPreset' | 'model' | 'permissionPreset'>): Promise<import('../work-types.ts').HostExecutionChoices>
  ensure(execution: WorkExecution, allowed: () => Promise<boolean>): Promise<NonNullable<WorkExecution['actual']>>
  deliver(execution: WorkExecution, event: import('../work-types.ts').WorkEvent, inMaintenance?: boolean): Promise<'delivered' | 'consumed'>
  observe(execution: WorkExecution, event: import('../work-types.ts').WorkEvent): Promise<'accepted' | 'delivered' | 'consumed'>
  settle(execution: WorkExecution): Promise<void>
  failure?(execution: WorkExecution): Promise<{ id: string; message: string; userCancelled: boolean } | undefined>
  profile?(execution: WorkExecution): Promise<NonNullable<WorkExecution['actual']>>
  measure?(execution: WorkExecution): Promise<import('../work-types.ts').ContinuationObservation>
  maintain?<T>(execution: WorkExecution, body: () => Promise<T>): Promise<T>
  sealInput?(execution: WorkExecution, operationId: string): Promise<{ seq: number; messages: readonly import('../work-types.ts').NativeWorkMessage[] }>
  pending?(execution: WorkExecution): readonly import('../work-types.ts').NativeWorkMessage[]
  history?(execution: WorkExecution, session: import('../work-types.ts').SessionRef, cursor?: number, limit?: number): Promise<{ events: unknown[]; nextCursor?: number }>
}
export class WorkExecutionError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
