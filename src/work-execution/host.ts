import type { WorkExecution } from '../work-types.ts'

/** Trusted host boundary. check must be read-only and reject missing capabilities before reservation. */
export interface WorkExecutionHost {
  connect(authorize: (sessionId: string, messages?: readonly import('../work-types.ts').NativeWorkMessage[]) => Promise<boolean>): void
  wake(execution: WorkExecution): Promise<void>
  status(execution: WorkExecution): 'running' | 'idle' | 'inactive'
  choices(): Promise<import('../work-types.ts').HostExecutionChoices>
  check(request: Pick<WorkExecution, 'resource' | 'session' | 'sessionMode' | 'agentPreset' | 'model' | 'permissionPreset'>): Promise<import('../work-types.ts').HostExecutionChoices>
  ensure(execution: WorkExecution, allowed: () => Promise<boolean>): Promise<NonNullable<WorkExecution['actual']>>
  deliver(execution: WorkExecution, event: import('../work-types.ts').WorkEvent): Promise<'delivered' | 'consumed'>
  observe(execution: WorkExecution, event: import('../work-types.ts').WorkEvent): Promise<'accepted' | 'delivered' | 'consumed'>
  settle(execution: WorkExecution): Promise<void>
}
export class WorkExecutionError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
