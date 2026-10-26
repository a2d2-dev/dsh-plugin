import type { WorkExecution } from '../work-types.ts'

export interface MaintenanceAdmission { operationId: string; step: 'material' | 'collect' | 'receive' | 'settle'; jobIds?: string[]; messageIds?: string[] }
export type WorkAdmission = boolean | MaintenanceAdmission

/** Trusted host boundary. check must be read-only and reject missing capabilities before reservation. */
export interface WorkExecutionHost {
  connect(authorize: (sessionId: string, messages?: readonly import('../work-types.ts').NativeWorkMessage[]) => Promise<WorkAdmission>, conversation?: (sessionId: string) => Promise<string | undefined>, pendingHumanInput?: (sessionId: string) => Promise<readonly import('../work-types.ts').NativeWorkMessage[]>): void
  connectObservation?(scope: import('./observation.ts').ObservationScope): void
  observation?(execution: WorkExecution, associations?: readonly import('../work-types.ts').SessionAssociation[], reporter?: import('@deepseek-ai/dsh-tools').ToolExecutionToken): Promise<import('./observation.ts').ExecutionObservation>
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
  /** Holds source and related live executors in maintenance, flushes their logs
   * (including job journals), then rechecks settlement before body. Body must
   * not call settle/whenIdle/runMaintenance on these already-held executors. */
  maintain?<T>(execution: WorkExecution, body: () => Promise<T>): Promise<T>
  sealInput?(execution: WorkExecution, operationId: string): Promise<{ seq: number; messages: readonly import('../work-types.ts').NativeWorkMessage[] }>
  disarmSource?(execution: WorkExecution): Promise<NonNullable<NonNullable<WorkExecution['continuation']>['goalActivation']>>
  flushSession?(session: import('../work-types.ts').SessionRef): Promise<void>
  received?(execution: WorkExecution): Promise<boolean>
  pending?(execution: WorkExecution): readonly import('../work-types.ts').NativeWorkMessage[]
  history?(execution: WorkExecution, session: import('../work-types.ts').SessionRef, cursor?: number, limit?: number): Promise<{ events: unknown[]; nextCursor?: number }>
}
export class WorkExecutionError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
