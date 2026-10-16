import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TaskId } from '../brand.ts'
import type { RootSessionProfile } from '../root-session.ts'

export interface TaskAddress { projectRoot: string; task: TaskId }
export type RunState = 'running' | 'waiting-human' | 'waiting-event' | 'paused' | 'blocked' | 'done'
export interface Delivery { id: string; message: UserMessage; target?: SessionId; delivered?: boolean }
export interface Rotation {
  id: string
  source: SessionId
  successor: SessionId
  step: 'prepare' | 'write' | 'create' | 'take' | 'deliver'
  focus?: string
  instruction?: Delivery
  continuation?: Delivery
  createdAt: string
  profile?: RootSessionProfile
  /** Explicit repair reuses the last model-written handoff plus a history pointer. */
  recoveryBody?: string
  replaces?: SessionId
}
export interface RunRecord extends TaskAddress {
  version: 1
  cwd: string
  workspace: string
  current: SessionId
  sessions: SessionId[]
  generation: number
  state: RunState
  owner?: string
  operation?: Rotation
  drive?: Delivery
  decision?: { kind: 'continue' | 'wait-human' | 'wait-event'; progress: string }
  lastProgress?: string
  autoTurns: number
  noProgress: number
  failures: number
  error?: string
  recoveredFailure?: string
  recoveryRequired?: { session: SessionId; agentPreset: string }
  inbox: Delivery[]
  updatedAt: string
}
