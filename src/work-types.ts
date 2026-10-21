import type { TaskProgress, TaskProgressView, TaskReport, WorkStage } from './work-progress.ts'
import type { ExternalBinding, GitHubIssue, GitHubIssueReference, IssuePage, WorkSource } from './work-sources/types.ts'
/** Browser-safe contract for the local work application. No host/runtime imports. */
export interface TaskRef { projectId: string; taskId: string }
export interface ResourceRef { runtimeId: string; workspaceId: string }
export interface SessionRef { runtimeId: string; sessionId: string }
/** Owner is a read-only resources.list projection, never a persisted resource identity. */
export interface HostResource { ref: ResourceRef; title: string; readonly owner?: { readonly projectId: string; readonly projectName: string } }
export interface SessionCandidate { ref: SessionRef; resource: ResourceRef; title: string }
export interface AgentPolicy { version: number; modelCandidates: string[]; instructions: string; capabilities: string[] }
export interface ProjectAgent { id: string; projectId: string; role: 'coordinator'; policy: AgentPolicy }
export interface ContinuationPolicy { version: number; enabled: boolean; targetTokens: number; reserveTokens: number }
export interface ContinuationObservation { totalTokens: number; logRevision: number; baseline: 'usage' | 'estimated' | 'none'; capacity: number; outputReserve: number; routeKey: string; observedAt: string }
export interface ContinuationOperation {
  operationId: string; commandId: string; automatic: boolean
  phase: 'reserved' | 'material-requested' | 'material-saved' | 'successor-created' | 'taken' | 'delivered'
  source: SessionRef; successor: SessionRef; sourceEpoch: number
  materialRequestId: string; kickoffId: string
  profile?: NonNullable<WorkExecution['actual']>
  material?: ContinuationMaterial
  goal: string; specification: WorkSpecification; title: string
  history: { ref: TaskRef; session: SessionRef }
  inputSeal?: number
  requestDelivery?: WorkEvent['delivery']; kickoffDelivery?: WorkEvent['delivery']
  error?: { code: string; message: string }
}
export interface Project { id: string; name: string; version: number; defaultAgentId: string; resources: ResourceRef[]; continuationPolicy?: ContinuationPolicy }
export interface WorkSpecification { version: number; text: string; acceptance: string[]; missing?: ('body' | 'acceptance')[] }
export interface BreakdownBlock { id: string; title: string; description: string; status?: WorkStage; evidence?: string[]; child?: TaskRef }
export interface SessionAssociation { session: SessionRef; purpose: 'related' | 'review' }
export interface WorkActivity { commandId: string; type: string; version: number }
export interface WorkTask {
  id: string; projectId: string; title: string; goal: string; version: number; agentId: string
  progress?: TaskProgress
  completion?: import('./work-completion/index.ts').CompletionOperation
  childCompletions?: import('./work-completion/index.ts').ChildCompletion[]
  specification: WorkSpecification
  specificationHistory: WorkSpecification[]
  breakdown: BreakdownBlock[]
  parent?: TaskRef
  children: TaskRef[]
  sessions: SessionAssociation[]
  activity: WorkActivity[]
}
export interface LegacyAddress { runtimeId: string; projectRoot: string; taskId: string }
export interface HostExecutionChoices {
  agentPresets: string[]; models: { provider: string; model: string }[]; permissionPresets: string[]
  defaults: { agentPreset: string; model: { provider: string; model: string; reasoningEffort?: string }; permissionPreset: string }
}
export interface WorkExecutionOptions extends HostExecutionChoices { agentId: string; resources: HostResource[] }
export interface ExecutionRef { ref: TaskRef; executionId: string }
export interface NativeWorkMessage { id: string; role: 'user'; content: readonly unknown[]; source: unknown }
export interface WorkEvent { id: string; text: string; kind: 'input' | 'result'; delivery: 'accepted' | 'delivered' | 'consumed'; acceptance: 'unassessed'; nativeMessage?: NativeWorkMessage }
/** Source-authored material; full original text is retained before any delivery redaction. */
export interface ContinuationContent { body: string; decisions: string; evidence: string; unfinished: string; next: string }
export interface ContinuationMaterial extends ContinuationContent {
  commandId: string; ref: TaskRef; executionId: string; source: SessionRef; epoch: number
  taskVersion: number; specificationVersion: number
}
export interface WorkExecution {
  id: string; ref: TaskRef; agentId: string; owner: string; epoch: number
  resource: ResourceRef; session: SessionRef; sessionMode: 'create' | 'reuse'; agentPreset: string
  model: { provider: string; model: string; reasoningEffort?: string }; permissionPreset: string; policy: AgentPolicy
  state: 'accepted' | 'creating' | 'ready' | 'running' | 'waiting' | 'paused' | 'failed'
  history: { state: WorkExecution['state']; commandId: string }[]
  actual?: { runtimeId: string; cwd: string; agentPreset: string; provider: string; model: string; reasoningEffort?: string; permissionPreset: string; sandbox: string; approval: string }
  events: WorkEvent[]
  runtimeFailure?: { id: string; message: string; userCancelled: boolean; acknowledged?: boolean }
  continuationPolicy?: ContinuationPolicy
  continuationObservation?: ContinuationObservation
  continuationBlocked?: { code: string; message: string }
  continuation?: ContinuationOperation
  continuationHistory?: ContinuationOperation[]
  retired?: { session: SessionRef; epoch: number; operationId: string }[]
  continuationMaterial?: ContinuationMaterial
  progress?: string
  control?: { commandId: string; action: 'wait' | 'pause' | 'resume'; status: 'accepted' | 'applied'; reason?: string }
  error?: { code: string; message: string }
}
export interface ContinuousWorkItem {
  nodeId: string; title: string; number: number; url: string; ref?: TaskRef; executionId?: string
  state: 'queued' | 'active' | 'waiting' | 'paused' | 'blocked' | 'completed' | 'skipped'
  reason?: string; attempts: number; retryAt?: string; resumeRequested?: boolean; followups?: string[]; recoveryBlocked?: boolean
}
export interface ContinuousWorkRule {
  id: string; projectId: string; sourceId: string; version: number; enabled: boolean
  scope: { assignee: '@me' | '*'; labels: string[]; identity?: { login: string; nodeId: string } }
  resource: ResourceRef; model: { provider: string; model: string; reasoningEffort?: string }
  agentPreset: string; permissionPreset: string
  items: ContinuousWorkItem[]; active?: TaskRef; error?: { code: string; message: string }
}
interface Command { commandId: string }
interface TaskContent { title: string; goal: string; specification: string; acceptance: string[] }
interface TaskChange extends Command { ref: TaskRef; expectedVersion: number }
export type WorkCommand =
  | (Command & { type: 'source.connect'; githubProject: { owner: string; type: 'org' | 'user'; number: number }; resource?: ResourceRef })
  | (Command & { type: 'continuous.configure'; projectId: string; sourceId: string; expectedVersion: number; assignee: '@me' | '*'; labels: string[]; resource: ResourceRef; model: { provider: string; model: string; reasoningEffort?: string }; agentPreset: string; permissionPreset: string; enabled: boolean })
  | (Command & { type: 'continuous.set-enabled'; projectId: string; sourceId: string; expectedVersion: number; enabled: boolean })
  | (Command & { type: 'source.configure-project'; projectId: string; githubProject: { owner: string; type: 'org' | 'user'; number: number } })
  | (Command & { type: 'source.configure'; projectId: string; repository: { owner: string; repository: string } })
  | (Command & { type: 'source.set-enabled'; projectId: string; sourceId: string; expectedVersion: number; enabled: boolean })
  | (Command & { type: 'source.import'; projectId: string; sourceId: string; nodeId?: string; url?: string })
  | (TaskChange & { type: 'source.link'; sourceId: string; nodeId?: string; url?: string })
  | (Command & { type: 'project.configure-continuation'; projectId: string; expectedVersion: number; policy: ContinuationPolicy })
  | (Command & { type: 'project.create'; name: string; resource?: ResourceRef })
  | (Command & { type: 'project.attach-resource'; projectId: string; expectedVersion: number; resource: ResourceRef })
  | (Command & TaskContent & { type: 'task.create'; projectId: string })
  | (TaskChange & TaskContent & { type: 'task.create-child' })
  | (TaskChange & { type: 'task.update-spec'; goal: string; specification: string; acceptance: string[] })
  | (TaskChange & { type: 'task.replace-breakdown'; blocks: BreakdownBlock[] })
  | (TaskChange & { type: 'task.link-child'; child: TaskRef; childExpectedVersion: number })
  | (TaskChange & { type: 'task.associate-session'; session: SessionRef; purpose: 'related' | 'review' })
  | (TaskChange & { type: 'legacy.map'; address: LegacyAddress })
  | (Command & ExecutionRef & { type: 'task.configure-continuation'; owner: string; epoch: number; policy: ContinuationPolicy })
  | (Command & ExecutionRef & { type: 'task.continue'; owner: string; epoch: number })
  | (Command & ExecutionRef & { type: 'task.organize'; owner: string; epoch: number; organization: import('./work-organization.ts').TaskOrganization })
  | (Command & ExecutionRef & { type: 'task.report'; owner: string; epoch: number; report: TaskReport })
  | (Command & ExecutionRef & { type: 'task.continuation-material'; owner: string; epoch: number; content: ContinuationContent })
  | (Command & ExecutionRef & { type: 'task.control'; owner: string; epoch: number; action: 'progress' | 'wait' | 'pause' | 'resume'; text: string })
  | (Command & ExecutionRef & { type: 'task.input'; owner: string; epoch: number; text: string; kind: 'input' | 'result' })
  | (Command & ExecutionRef & { type: 'task.completion-sync'; owner: string; epoch: number })
  | (Command & ExecutionRef & { type: 'task.reconcile'; owner: string; epoch: number })
  | (TaskChange & { type: 'task.start'; agentId: string; resource: ResourceRef; session?: SessionRef; agentPreset: string; model: { provider: string; model: string; reasoningEffort?: string }; permissionPreset: string })
export type WorkQuery =
  | { type: 'source.execution-options'; projectId: string; sourceId: string }
  | { type: 'continuous.status'; projectId: string; sourceId: string }
  | { type: 'source.list'; projectId: string }
  | { type: 'source.issues'; projectId: string; sourceId: string; page: number; perPage: number; assignee: '@me' | '*'; state: 'open' | 'closed' | 'all'; refresh?: boolean }
  | { type: 'source.issue'; projectId: string; sourceId: string; number: number; nodeId?: string; refresh?: boolean }
  | { type: 'work.capabilities' }
  | { type: 'projects.list' }
  | { type: 'resources.list' }
  | { type: 'project.detail'; projectId: string }
  | { type: 'task.execution-options'; ref: TaskRef }
  | { type: 'task.execution'; ref: TaskRef }
  | { type: 'task.history'; ref: TaskRef; session: SessionRef; cursor?: number; limit?: number }
  | { type: 'task.detail'; ref: TaskRef }
  | { type: 'session.candidates'; projectId: string }
  | { type: 'session.work'; session: SessionRef }
  | { type: 'legacy.resolve'; address: LegacyAddress }
export interface AssociatedWork { ref: TaskRef; title: string; projectName: string; purpose: 'related' | 'review' | 'control' | 'history'; executionId?: string; epoch?: number; currentSession?: SessionRef }
/** Completed fields correspond to command/query; task.detail includes related children and parent. */
export interface SourceResultFields {
  ref?: TaskRef
  source?: WorkSource; sources?: WorkSource[]; page?: IssuePage; issue?: GitHubIssue
  binding?: ExternalBinding; bindings?: ExternalBinding[]
  capabilities?: { githubRead: boolean; githubWrite: false; taskStart: boolean; projectViews: boolean }
}
export interface WorkCompleted extends SourceResultFields {
  continuousRule?: ContinuousWorkRule
  status: 'completed'
  progress?: TaskProgressView
  progressItems?: TaskProgressView[]
  sourceIssues?: GitHubIssueReference[]
  transcript?: { session: SessionRef; events: unknown[]; nextCursor?: number }
  execution?: WorkExecution
  executionOptions?: WorkExecutionOptions
  executionRuntime?: 'running' | 'idle' | 'inactive'
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
export interface WorkFailure extends SourceResultFields { status: 'failed' | 'conflict'; error: { code: string; message: string; currentVersion?: number } }
export type WorkResult = WorkCompleted | WorkFailure
export type WorkRequest = { kind: 'command'; value: WorkCommand } | { kind: 'query'; value: WorkQuery }
export const WORK_ROUTE_PATH = '/a2d2/api/work'
