import type { SessionAssociation, SessionRef, TaskRef, WorkExecution, WorkTask } from '../work-types.ts'

/** Facts, never inferred from a title, a display order, or a UI acknowledgement. */
export type ResultState = 'pending' | 'consumed' | 'unknown'
export interface ExecutionJob {
  id: string
  owner: SessionRef
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'failed' | 'killed'
  detail?: string
  /** Absent on older hosts; never combine a bare id with a previous registry. */
  registryEpoch?: string
  instanceId?: string
  result: ResultState
  delivery: 'pending' | 'delivered' | 'unknown'
  acceptance: 'unassessed'
  persistence: 'process-local' | 'session-journal'
  availability?: 'live' | 'lost' | 'history'
}
export interface NativeExecution {
  session: SessionRef
  mode: 'one-shot' | 'continuable' | 'unknown'
  status: 'running' | 'idle' | 'inactive' | 'unknown'
  result: ResultState
  returned?: boolean
  attempt?: { turn: number; reason?: string }
}
export interface ObservedSession {
  session: SessionRef
  role: 'current' | 'retired' | 'related' | 'review' | 'native-child'
  parent?: SessionRef
  status: NativeExecution['status']
  children: NativeExecution[]
  jobs: ExecutionJob[]
  jobObservation?: 'available' | 'unavailable' | 'disabled'
  waitingHuman?: boolean
  attempt?: NativeExecution['attempt']
  failure?: string
}
export interface ExecutionBlocker { code: string; session: SessionRef; jobId?: string }
export interface ExecutionObservation {
  settlement: 'settled' | 'pending' | 'unknown'
  sessions: ObservedSession[]
  blockers: ExecutionBlocker[]
  limitations: string[]
}
export interface ChildTaskExecution {
  task: WorkTask
  execution?: WorkExecution
  observation?: ExecutionObservation
  issue?: { number: number; url: string; assignees: string[] }
}
export interface ExecutionGraph {
  settlement: ExecutionObservation['settlement']
  ref: TaskRef
  executionId?: string
  owner?: { id: string; epoch: number; agentId: string }
  currentSession?: SessionRef
  childTasks: { ref: TaskRef; title: string; agentId: string; executionId?: string; owner?: string; epoch?: number; currentSession?: SessionRef; issue?: ChildTaskExecution['issue']; observation?: ExecutionObservation }[]
  nativeIssues?: { issue: import('../work-sources/types.ts').GitHubIssueReference; ref?: TaskRef; executionId?: string; owner?: string; epoch?: number; currentSession?: SessionRef; assignees?: string[]; status: 'started' | 'not-started' | 'unread' }[]
  sessions: ObservedSession[]
  events: WorkExecution['events']
  history: WorkExecution['history']
  blockers: ExecutionBlocker[]
  limitations: string[]
}
export const sessionKey = (session: SessionRef): string => JSON.stringify([session.runtimeId, session.sessionId])
const sameTask = (left: TaskRef, right: TaskRef) => left.projectId === right.projectId && left.taskId === right.taskId

/** Authority-owned bindings supplied by WorkApplication, including associations. */
export type ObservationScope = (execution: WorkExecution) => Promise<readonly SessionAssociation[]>

/** Pure projection. Independent child Tasks are entries, never native Session children or handoff blockers. */
export function buildExecutionGraph(input: { task: WorkTask; execution?: WorkExecution; observation?: ExecutionObservation; children?: ChildTaskExecution[] }): ExecutionGraph {
  const { task, execution, observation } = input
  const ref = { projectId: task.projectId, taskId: task.id }
  if (execution && !sameTask(execution.ref, ref)) throw new Error('Execution does not belong to this Task')
  const bound = new Map<string, ObservedSession>()
  for (const association of task.sessions) bound.set(sessionKey(association.session), { session: association.session, role: association.purpose, status: 'unknown', children: [], jobs: [] })
  for (const old of execution?.retired ?? []) bound.set(sessionKey(old.session), { session: old.session, role: 'retired', status: 'unknown', children: [], jobs: [] })
  if (execution) bound.set(sessionKey(execution.session), { session: execution.session, role: 'current', status: 'unknown', children: [], jobs: [] })
  // Only an observation of an explicitly bound root or its native descendants belongs here.
  const admitted = new Set(bound.keys())
  let pending = [...(observation?.sessions ?? [])]
  while (pending.length) {
    const next = pending.filter(row => admitted.has(sessionKey(row.session)) || (row.parent && admitted.has(sessionKey(row.parent))))
    if (!next.length) break
    for (const row of next) {
      const key = sessionKey(row.session)
      const role = bound.get(key)?.role ?? 'native-child'
      bound.set(key, { ...row, role }); admitted.add(key)
    }
    pending = pending.filter(row => !next.includes(row))
  }
  return {
    settlement: observation?.settlement ?? 'unknown',
    ref, ...(execution ? { executionId: execution.id, owner: { id: execution.owner, epoch: execution.epoch, agentId: execution.agentId }, currentSession: execution.session } : {}),
    childTasks: (input.children ?? []).filter(child => task.children.some(ref => sameTask(ref, { projectId: child.task.projectId, taskId: child.task.id }))).map(child => {
      const ref = { projectId: child.task.projectId, taskId: child.task.id }
      const run = child.execution && sameTask(child.execution.ref, ref) ? child.execution : undefined
      return { ref, title: child.task.title, agentId: child.task.agentId, ...(run ? { executionId: run.id, owner: run.owner, epoch: run.epoch, currentSession: run.session } : {}), ...(child.issue ? { issue: child.issue } : {}), ...(child.observation ? { observation: child.observation } : {}) }
    }),
    sessions: [...bound.values()], events: execution?.events ?? [], history: execution?.history ?? [],
    blockers: observation?.blockers.filter(row => admitted.has(sessionKey(row.session))) ?? [],
    limitations: observation?.limitations ?? ['宿主执行观察尚未取得；运行和结果消费状态未知。'],
  }
}
