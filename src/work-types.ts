/** Browser-safe contract for the local work application. No host/runtime imports. */
export interface TaskRef { projectId: string; taskId: string }
export interface ResourceRef { runtimeId: string; workspaceId: string }
export interface SessionRef { runtimeId: string; sessionId: string }
export interface HostResource { ref: ResourceRef; title: string }
export interface SessionCandidate { ref: SessionRef; resource: ResourceRef; title: string }
export interface AgentPolicy { version: number; modelCandidates: string[]; instructions: string; capabilities: string[] }
export interface ProjectAgent { id: string; projectId: string; role: 'coordinator'; policy: AgentPolicy }
export interface Project { id: string; name: string; version: number; defaultAgentId: string; resources: ResourceRef[] }
export interface WorkSpecification { version: number; text: string; acceptance: string[] }
export interface BreakdownBlock { id: string; title: string; description: string }
export interface SessionAssociation { session: SessionRef; purpose: 'related' | 'review' }
export interface WorkActivity { commandId: string; type: string; version: number }
export interface WorkTask {
  id: string; projectId: string; title: string; goal: string; version: number; agentId: string
  specification: WorkSpecification
  specificationHistory: WorkSpecification[]
  breakdown: BreakdownBlock[]
  parent?: TaskRef
  children: TaskRef[]
  sessions: SessionAssociation[]
  activity: WorkActivity[]
}
export interface LegacyAddress { runtimeId: string; projectRoot: string; taskId: string }
export interface WorkExecution {
  id: string; ref: TaskRef; agentId: string; owner: string; epoch: number
  resource: ResourceRef; session: SessionRef; agentPreset: string
  model: { provider: string; model: string }; permissionPreset: string; policy: AgentPolicy
  state: 'accepted' | 'creating' | 'ready' | 'running' | 'waiting' | 'paused' | 'failed'
  history: { state: WorkExecution['state']; commandId: string }[]
  actual?: { runtimeId: string; cwd: string; agentPreset: string; provider: string; model: string; permissionPreset: string; sandbox: string; approval: string }
  error?: { code: string; message: string }
}
interface Command { commandId: string }
interface TaskContent { title: string; goal: string; specification: string; acceptance: string[] }
interface TaskChange extends Command { ref: TaskRef; expectedVersion: number }
export type WorkCommand =
  | (Command & { type: 'project.create'; name: string; resource?: ResourceRef })
  | (Command & { type: 'project.attach-resource'; projectId: string; expectedVersion: number; resource: ResourceRef })
  | (Command & TaskContent & { type: 'task.create'; projectId: string })
  | (TaskChange & TaskContent & { type: 'task.create-child' })
  | (TaskChange & { type: 'task.update-spec'; goal: string; specification: string; acceptance: string[] })
  | (TaskChange & { type: 'task.replace-breakdown'; blocks: BreakdownBlock[] })
  | (TaskChange & { type: 'task.link-child'; child: TaskRef; childExpectedVersion: number })
  | (TaskChange & { type: 'task.associate-session'; session: SessionRef; purpose: 'related' | 'review' })
  | (TaskChange & { type: 'legacy.map'; address: LegacyAddress })
  | (TaskChange & { type: 'task.start'; agentId: string; resource: ResourceRef; session?: SessionRef; agentPreset: string; model: { provider: string; model: string }; permissionPreset: string })
export type WorkQuery =
  | { type: 'projects.list' }
  | { type: 'resources.list' }
  | { type: 'project.detail'; projectId: string }
  | { type: 'task.execution'; ref: TaskRef }
  | { type: 'task.detail'; ref: TaskRef }
  | { type: 'session.candidates'; projectId: string }
  | { type: 'session.work'; session: SessionRef }
  | { type: 'legacy.resolve'; address: LegacyAddress }
export interface AssociatedWork { ref: TaskRef; title: string; projectName: string; purpose: 'related' | 'review' }
/** Completed fields correspond to command/query; task.detail includes related children and parent. */
export interface WorkCompleted {
  status: 'completed'
  execution?: WorkExecution
  project?: Project
  task?: WorkTask
  projects?: Project[]
  tasks?: WorkTask[]
  agents?: ProjectAgent[]
  parent?: WorkTask
  children?: WorkTask[]
  resources?: HostResource[]
  candidates?: SessionCandidate[]
  work?: AssociatedWork[]
  ref?: TaskRef
}
export interface WorkFailure { status: 'failed' | 'conflict'; error: { code: string; message: string; currentVersion?: number } }
export type WorkResult = WorkCompleted | WorkFailure
export type WorkRequest = { kind: 'command'; value: WorkCommand } | { kind: 'query'; value: WorkQuery }
export const WORK_ROUTE_PATH = '/a2d2/api/work'
