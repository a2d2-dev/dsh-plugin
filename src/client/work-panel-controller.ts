import type { TaskProgressView } from '../work-progress.ts'
import { browserUUID } from './browser-uuid.ts'
import { WorkClientError, type WorkClient } from './work-api.ts'
import type { ExternalBinding, GitHubIssue, IssuePage, IssuePageRequest, WorkSource } from '../work-sources/types.ts'
import type { Project, SessionRef, TaskRef, WorkCommand, WorkCompleted, WorkExecutionOptions, WorkTask } from '../work-types.ts'
type WithoutCommandId<T> = T extends unknown ? Omit<T, 'commandId'> : never
export type WorkIntent = WithoutCommandId<WorkCommand>

export type DetailTab = 'overview' | 'sessions' | 'related' | 'activity'
export type LocalView = 'all' | 'unassociated' | 'associated'
export interface SourcePanelState extends IssuePageRequest {
  sources: WorkSource[]; sourceId: string | null; listing: IssuePage | null; issue: GitHubIssue | null
  bindings: ExternalBinding[]; loading: boolean; error: string | null; cached: boolean
  canonical: TaskRef | null
}
const emptySource = (): SourcePanelState => ({sources:[],sourceId:null,listing:null,issue:null,bindings:[],page:1,perPage:20,assignee:'@me',state:'open',loading:false,error:null,cached:true,canonical:null})
export interface StartSelection {
  resourceIndex: number; modelIndex: number; agentPreset: string; permissionPreset: string
}
export interface StartupState {
  busy: boolean; error: string | null; options: WorkExecutionOptions | null; selection: StartSelection | null
}
const emptyStartup = (): StartupState => ({ busy: false, error: null, options: null, selection: null })
export interface HistoryState {
  session: SessionRef | null; events: unknown[]; nextCursor?: number
  loading: boolean; loaded: boolean; error: string | null
}
const emptyHistory = (): HistoryState => ({ session: null, events: [], loading: false, loaded: false, error: null })
export interface WorkPanelState {
  observationError: string | null
  history: HistoryState
  progressItems: TaskProgressView[]
  startup: StartupState
  object: 'projects' | 'issues' | 'prs'; source: SourcePanelState
  projects: Project[]; projectId: string | null; tasks: WorkTask[]
  projectSources: Record<string, WorkSource[]>
  issueFilter: 'all' | 'not-started' | 'processing' | 'waiting' | 'blocked' | 'completed'
  detail: WorkCompleted | null; detailTab: DetailTab; search: string; view: LocalView
  loading: boolean; error: string | null
}
export interface WorkNavigation {
  selectPanel(id: 'a2d2-panel' | null): void
  openSession(id: string): void
}
/** One root-owned state survives panel unmounts and native-session round trips. */
export class WorkPanelController {
  private state: WorkPanelState = { projectSources: {}, issueFilter: 'all', observationError: null, history: emptyHistory(), progressItems: [], startup: emptyStartup(), object:'issues', source:emptySource(), projects: [], projectId: null, tasks: [], detail: null, detailTab: 'overview', search: '', view: 'all', loading: false, error: null }
  private listeners = new Set<() => void>()
  private sourceOrigin: Pick<WorkPanelState,'projectId'|'tasks'|'progressItems'|'source'|'object'|'search'|'view'|'issueFilter'> | null = null
  private detailTrail: Pick<WorkPanelState,'projectId'|'tasks'|'progressItems'|'source'|'object'|'search'|'view'|'detail'|'detailTab'|'issueFilter'>[] = []
  private revision = 0
  constructor(readonly client: WorkClient, private readonly navigation: WorkNavigation) {}
  getSnapshot = (): WorkPanelState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(value: Partial<WorkPanelState>): void {
    const progress = value.detail?.progress
    if (progress) value = { ...value, progressItems: [...(value.progressItems ?? this.state.progressItems).filter(item => item.ref.projectId !== progress.ref.projectId || item.ref.taskId !== progress.ref.taskId), progress] }
    this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener())
  }
  private observationRead?: AbortController
  private activeCommands = 0
  stopObservation(): void { this.observationRead?.abort() }
  private observationBlocked(): boolean {
    return this.state.loading || this.state.source.loading || this.state.startup.busy || !!this.state.startup.options || this.state.history.loading || this.activeCommands > 0
  }
  /** Visible-panel observation reads local projections/cache only; it never starts work or refreshes GitHub. */
  async observeCurrent(allowed: () => boolean = () => true): Promise<void> {
    if (this.observationRead || this.observationBlocked() || !allowed() || !this.state.projectId) return
    const snapshot = this.state, projectId = snapshot.projectId!, task = snapshot.detail?.task
    const revision = this.revision, sourceRevision = this.sourceRevision
    const abort = new AbortController(); this.observationRead = abort
    const current = () => !abort.signal.aborted && revision === this.revision && sourceRevision === this.sourceRevision && !this.observationBlocked() && allowed()
    const query = <T extends Parameters<WorkClient['query']>[0]>(value: T) => this.client.query(value, abort.signal)
    try {
      const base = task ? query({ type: 'task.detail', ref: { projectId: task.projectId, taskId: task.id } }) : query({ type: 'project.detail', projectId })
      const related = task ? query({ type: 'project.detail', projectId }) : Promise.resolve(null)
      const watchingSource = !task && snapshot.object === 'issues'
      const sources = watchingSource ? query({ type: 'source.list', projectId }) : Promise.resolve(null)
      const { sourceId, issue, page, perPage, assignee, state } = snapshot.source
      const cached = !watchingSource || !sourceId ? Promise.resolve(null) : issue
        ? query({ type: 'source.issue', projectId, sourceId, number: issue.number, nodeId: issue.nodeId, refresh: false })
        : query({ type: 'source.issues', projectId, sourceId, page, perPage, assignee, state, refresh: false })
      const [observed, sourceList, sourcePage, relatedWork] = await Promise.allSettled([base, sources, cached, related])
      if (!current()) return
      const update: Partial<WorkPanelState> = { observationError: null }
      const failures = [observed, sourceList, sourcePage, relatedWork].filter(result => result.status === 'rejected')
      if (failures.length) update.observationError = failures.map(result => message((result as PromiseRejectedResult).reason)).join('；')
      if (observed.status === 'fulfilled') {
        const result = observed.value
        if (task && result.task?.id === task.id && result.task.projectId === task.projectId) {
          update.detail = result
          update.tasks = this.state.tasks.map(item => item.id === task.id && item.projectId === task.projectId ? result.task! : item)
        } else if (!task) {
          update.tasks = result.tasks ?? snapshot.tasks
          update.progressItems = result.progressItems ?? snapshot.progressItems
          if (result.project?.id === projectId) update.projects = this.state.projects.map(item => item.id === projectId ? result.project! : item)
        }
      }
      if (task && relatedWork.status === 'fulfilled' && relatedWork.value) {
        const related = relatedWork.value
        const newer = (saved: WorkTask): WorkTask => {
          const observed = related.tasks?.find(item => item.id === saved.id && item.projectId === saved.projectId)
          return observed && observed.version > saved.version ? observed : saved
        }
        if (update.detail) update.detail = { ...update.detail, children: update.detail.children?.map(newer), ...(update.detail.parent ? { parent: newer(update.detail.parent) } : {}) }
        update.tasks = (related.tasks ?? snapshot.tasks).map(item => item.id === task.id && item.projectId === task.projectId ? update.detail?.task ?? item : item)
        update.progressItems = related.progressItems ?? snapshot.progressItems
        if (related.project?.id === projectId) update.projects = this.state.projects.map(item => item.id === projectId ? related.project! : item)
      }
      if (watchingSource) {
        const nextSource = { ...this.state.source }
        if (sourceList.status === 'fulfilled' && sourceList.value?.sources) nextSource.sources = sourceList.value.sources
        if (sourcePage.status === 'fulfilled' && sourcePage.value) {
          const result = sourcePage.value
          if (result.source?.id === sourceId) nextSource.sources = nextSource.sources.map(item => item.id === sourceId ? result.source! : item)
          if (issue && result.issue?.nodeId === issue.nodeId) {
            nextSource.issue = result.issue
            if (result.bindings) nextSource.bindings = result.bindings
          } else if (!issue && result.page) nextSource.listing = result.page
          nextSource.cached = true
        }
        update.source = nextSource
      }
      this.update(update)
      if (!task && this.state.source.issue && current()) await this.loadIssueProgress(sourceRevision)
    } catch (error) { if (current()) this.update({ observationError: message(error) }) }
    finally { if (this.observationRead === abort) this.observationRead = undefined }
  }
  async initialize(): Promise<void> {
    if (!this.state.loading && !this.state.projects.length) await this.load()
  }
  async load(): Promise<void> {
    this.invalidateSourceNavigation()
    const revision = ++this.revision
    this.update({ loading: true, error: null })
    try {
      const result = await this.client.query({ type: 'projects.list' })
      if (revision !== this.revision) return
      const projects = result.projects ?? []
      const discovered = await Promise.all(projects.map(async project => {
        const result = await this.client.query({ type: 'source.list', projectId: project.id })
        return [project.id, result.sources ?? []] as const
      }))
      if (revision !== this.revision) return
      const projectSources = Object.fromEntries(discovered)
      this.update({ projects, projectSources })
      const connected = projects.filter(project => projectSources[project.id]?.some(source => source.githubProject))
      const projectId = projects.find(project => project.id === this.state.projectId)?.id ?? connected[0]?.id ?? null
      if (projectId !== null) await this.selectProject(projectId)
      else this.update({ projectId: null, tasks: [], detail: null, loading: false })
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  async selectProject(projectId: string, browse = true): Promise<void> {
    if (browse) this.detailTrail=[]
    this.invalidateSourceNavigation()
    const revision = ++this.revision
    const changed = projectId !== this.state.projectId
    if (changed) this.sourceOrigin=null
    this.update({ projectId, loading: true, error: null, ...(changed ? { detail: null, search: '', view: 'all', issueFilter: 'all', tasks: [], object:'issues' as const, source:emptySource() } : {}) })
    try {
      const result = await this.client.query({ type: 'project.detail', projectId })
      if (revision === this.revision) {
        this.update({ tasks: result.tasks ?? [], progressItems: result.progressItems ?? [], ...(result.project ? { projects: this.state.projects.map(item => item.id === result.project!.id ? result.project! : item) } : {}), loading: false })
        if (browse) await this.showSources()
      }
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  async openTask(ref: TaskRef, remember = true): Promise<void> {
    const previous=this.state, task=previous.detail?.task
    if (remember && task && (task.id!==ref.taskId||task.projectId!==ref.projectId)) {
      const {projectId,tasks,progressItems,source,object,search,view,detail,detailTab,issueFilter}=previous
      this.detailTrail.push({projectId,tasks,progressItems,source,object,search,view,detail,detailTab,issueFilter})
    } else if (!remember) this.detailTrail=[]
    this.invalidateSourceNavigation()
    if (this.state.projectId !== ref.projectId) {
      const origin=this.state.object==='issues'&&this.state.source.issue?{projectId:this.state.projectId,tasks:this.state.tasks,progressItems:this.state.progressItems,source:this.state.source,object:this.state.object,search:this.state.search,view:this.state.view,issueFilter:this.state.issueFilter}:null
      const projectRevision = this.revision + 1
      await this.selectProject(ref.projectId, false)
      if (this.revision !== projectRevision || this.state.projectId !== ref.projectId) return
      this.sourceOrigin=origin
    }
    const revision = ++this.revision
    this.update({ detail: null, loading: true, error: null, detailTab: 'overview' })
    try {
      const detail = await this.client.query({ type: 'task.detail', ref })
      if (revision === this.revision) {
        this.update({ detail, loading: false })
        if (!this.state.source.sourceId && !this.state.source.issue) {
          const sourcesResult=await this.client.query({type:'source.list',projectId:ref.projectId})
          if (revision!==this.revision) return
          const sources=sourcesResult.sources??[]
          this.update({projectSources:{...this.state.projectSources,[ref.projectId]:sources}})
          this.updateSource({sources,sourceId:sources.find(item=>detail.bindings?.some(binding=>binding.sourceIds.includes(item.id)))?.id??sources.find(item=>item.githubProject)?.id??null})
        }
      }
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  async revealTask(ref: TaskRef): Promise<void> {
    this.invalidateSourceNavigation()
    const revision = ++this.revision
    this.update({ loading: true, error: null })
    this.navigation.selectPanel('a2d2-panel')
    try {
      if (!this.state.projects.length) {
        const result = await this.client.query({ type: 'projects.list' })
        if (revision !== this.revision) return
        this.update({ projects: result.projects ?? [] })
      }
      if (revision === this.revision) await this.openTask(ref,false)
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  async refreshTask(): Promise<void> {
    const task = this.state.detail?.task
    if (!task) return
    this.closeHistory()
    const revision = ++this.revision
    this.update({ loading: true, error: null, startup: emptyStartup() })
    try {
      const detail = await this.client.query({ type: 'task.detail', ref: { projectId: task.projectId, taskId: task.id } })
      if (revision === this.revision) this.update({ detail, loading: false })
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  /** One explicit start intent may import an Issue, but navigation changes cancel its later UI steps. */
  async prepareStart(fromIssue = false): Promise<void> {
    if (this.state.startup.busy) return
    const projectId = this.state.projectId
    const { issue, sourceId, bindings, canonical } = this.state.source
    const selectedTask = this.state.detail?.task
    const revision = ++this.revision, sourceRevision = this.sourceRevision
    const current = () => revision === this.revision && sourceRevision === this.sourceRevision
    this.update({ startup: { ...emptyStartup(), busy: true } })
    try {
      let ref: TaskRef | undefined
      if (fromIssue) {
        if (!projectId || !sourceId || !issue) throw Error('请先读取完整 Issue')
        ref = bindings.find(binding => binding.nodeId === issue.nodeId)?.ref ?? canonical ?? undefined
        if (!ref) {
          try {
            const imported = await this.submit({ type: 'source.import', projectId, sourceId, nodeId: issue.nodeId })
            ref = imported.ref
          } catch (error) {
            if (!(error instanceof WorkClientError) || error.result.error.code !== 'external-object-owned' || !error.result.ref) throw error
            ref = error.result.ref
          }
        }
      } else if (selectedTask) ref = { projectId: selectedTask.projectId, taskId: selectedTask.id }
      if (!current()) return
      if (!ref) throw Error('工作服务未返回工作的定位信息')
      const detail = await this.client.query({ type: 'task.detail', ref })
      if (!current()) return
      if (!detail.task || detail.task.id !== ref.taskId || detail.task.projectId !== ref.projectId) throw Error('工作详情与启动目标不一致')
      if (ref.projectId !== this.state.projectId) {
        const project = await this.client.query({ type: 'project.detail', projectId: ref.projectId })
        if (!current()) return
        this.sourceOrigin = { projectId: this.state.projectId, tasks: this.state.tasks, progressItems: this.state.progressItems, source: this.state.source, object: this.state.object, search: this.state.search, view: this.state.view, issueFilter: this.state.issueFilter }
        this.update({ projectId: ref.projectId, tasks: project.tasks ?? [], progressItems: project.progressItems ?? [], object: 'projects', source: emptySource(), search: '', view: 'all' })
      }
      this.update({ detail, detailTab: 'overview', loading: false, error: null })
      if (detail.execution) {
        this.update({ startup: { ...emptyStartup(), error: this.executionFailure(detail) } })
        const session = this.currentSession()
        if (session) this.openSession(session)
        return
      }
      const useSource=Boolean(sourceId && ref.projectId === projectId)
      const [result, continuous] = await Promise.all([
        this.client.query(useSource ? {type:'source.execution-options',projectId:ref.projectId,sourceId:sourceId!} : {type:'task.execution-options',ref}),
        useSource ? this.client.query({type:'continuous.status',projectId:ref.projectId,sourceId:sourceId!}) : Promise.resolve(null),
      ])
      if (!current()) return
      const rule=continuous?.continuousRule
      const options = result.executionOptions ? {...result.executionOptions,defaults:{...result.executionOptions.defaults,
        ...(rule && result.executionOptions.models.some(item=>item.provider===rule.model.provider&&item.model===rule.model.model)?{model:rule.model}:{}),
        ...(rule && result.executionOptions.agentPresets.includes(rule.agentPreset)?{agentPreset:rule.agentPreset}:{}),
        ...(rule && result.executionOptions.permissionPresets.includes(rule.permissionPreset)?{permissionPreset:rule.permissionPreset}:{}),
      }} : undefined
      if (!options) throw Error('宿主未返回可用的执行配置')
      if (!options.resources.length) throw Error('没有可用执行目录，请检查宿主的工作目录配置。')
      if (!options.models.length || !options.agentPresets.length || !options.permissionPresets.length) throw Error('宿主暂无可用模型、Agent 预设或权限配置')
      const selection: StartSelection = { resourceIndex: Math.max(0,options.resources.findIndex(item=>item.ref.runtimeId===rule?.resource.runtimeId&&item.ref.workspaceId===rule.resource.workspaceId)),
        modelIndex: Math.max(0, options.models.findIndex(model => model.provider === options.defaults.model.provider && model.model === options.defaults.model.model)),
        agentPreset: options.agentPresets.includes(options.defaults.agentPreset) ? options.defaults.agentPreset : options.agentPresets[0]!,
        permissionPreset: options.permissionPresets.includes(options.defaults.permissionPreset) ? options.defaults.permissionPreset : options.permissionPresets[0]!,
      }
      this.update({ startup: { busy: false, error: null, options, selection } })
      if ([options.resources, options.models, options.agentPresets, options.permissionPresets].every(values => values.length === 1)) await this.startPrepared()
    } catch (error) { if (current()) this.update({ startup: { ...this.state.startup, busy: false, error: message(error) } }) }
  }
  selectStart(value: Partial<StartSelection>): void {
    const startup = this.state.startup
    if (!startup.busy && startup.selection) this.update({ startup: { ...startup, selection: { ...startup.selection, ...value }, error: null } })
  }
  cancelStart(): void { ++this.revision; this.update({ startup: emptyStartup() }) }
  async startPrepared(): Promise<void> {
    const { startup, detail } = this.state
    if (startup.busy || !startup.options || !startup.selection || !detail?.task) return
    const { options, selection } = startup, task = detail.task
    const resource = options.resources[selection.resourceIndex]?.ref, selectedModel = options.models[selection.modelIndex]
    const model = selectedModel && selectedModel.provider === options.defaults.model.provider && selectedModel.model === options.defaults.model.model ? options.defaults.model : selectedModel
    if (!resource || !model || !options.agentPresets.includes(selection.agentPreset) || !options.permissionPresets.includes(selection.permissionPreset)) {
      this.update({ startup: { ...startup, error: '请选择宿主提供的执行配置' } }); return
    }
    const revision = this.revision, sourceRevision = this.sourceRevision
    const current = () => revision === this.revision && sourceRevision === this.sourceRevision
    this.update({ startup: { ...startup, busy: true, error: null } })
    try {
      const ref = { projectId: task.projectId, taskId: task.id }
      // Re-read before writing: another browser may already have started this Task.
      const latest = await this.client.query({ type: 'task.detail', ref })
      if (!current()) return
      if (!latest.task) throw Error('工作详情暂不可用')
      if (!latest.execution) {
        const project = latest.project ?? this.state.projects.find(item => item.id === ref.projectId)
        if (project && !project.resources.some(item => item.runtimeId === resource.runtimeId && item.workspaceId === resource.workspaceId)) {
          const attached = await this.submit({type:'project.attach-resource',projectId:project.id,expectedVersion:project.version,resource})
          if (!current()) return
          if (attached.project) this.update({projects:this.state.projects.map(item=>item.id===attached.project!.id?attached.project!:item)})
        }
      }
      const result = latest.execution ? latest : await this.submit({ type: 'task.start', ref, expectedVersion: latest.task.version,
        agentId: options.agentId, resource, model, agentPreset: selection.agentPreset, permissionPreset: selection.permissionPreset })
      if (!current()) return
      // A completed command can contain a failed execution; retain it even if refresh fails.
      this.update({ detail: { ...latest, ...result }, startup: { ...emptyStartup(), busy: true } })
      const refreshed = await this.client.query({ type: 'task.detail', ref })
      if (!current()) return
      const observed = { ...refreshed, execution: refreshed.execution ?? result.execution }
      this.update({ detail: observed, tasks: this.state.tasks.map(item => item.id === refreshed.task?.id ? refreshed.task : item), startup: { ...emptyStartup(), error: this.executionFailure(observed) } })
      const session = this.currentSession()
      if (session) this.openSession(session)
    } catch (error) { if (current()) this.update({ startup: { ...this.state.startup, busy: false, error: message(error) } }) }
  }
  private executionFailure(result: WorkCompleted): string | null {
    const execution = result.execution
    return execution?.state === 'failed' ? `${execution.error?.code ?? '启动失败'}: ${execution.error?.message ?? '执行未能启动，请检查配置后恢复原执行。'}` : null
  }
  currentSession(): SessionRef | null {
    const { detail, loading } = this.state, execution = detail?.execution
    return !loading && execution?.actual && execution.ref.projectId === detail?.task?.projectId
      && execution.ref.taskId === detail.task.id && execution.actual.runtimeId === execution.session.runtimeId
      && ['ready', 'running', 'waiting', 'paused'].includes(execution.state) ? execution.session : null
  }
  openCurrentSession(): void { const session = this.currentSession(); if (session) this.openSession(session) }
  async controlExecution(action: 'pause' | 'resume' | 'reconcile' | 'continue'): Promise<void> {
    const execution = this.state.detail?.execution
    if (!execution || this.state.startup.busy) return
    const progress = this.state.detail?.progress
    if (action !== 'reconcile' && progress?.stage === 'done' && progress.criteria.current) return
    const revision = this.revision, sourceRevision = this.sourceRevision
    const current = () => revision === this.revision && sourceRevision === this.sourceRevision
    this.update({ startup: { ...emptyStartup(), busy: true } })
    try {
      const fence = { ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }
      const result = await this.submit(action === 'reconcile' ? { type: 'task.reconcile', ...fence } : action === 'continue' ? { type: 'task.continue', ...fence } : { type: 'task.control', ...fence, action, text: action === 'pause' ? '用户暂停处理' : '用户明确恢复处理' })
      if (!current()) return
      const detail = await this.client.query({ type: 'task.detail', ref: execution.ref })
      if (current()) this.update({ detail, startup: { ...emptyStartup(), error: this.executionFailure(detail.execution ? detail : result) } })
    } catch (error) { if (current()) this.update({ startup: { ...emptyStartup(), error: message(error) } }) }
  }
  async saveContinuation(policy: import('../work-types.ts').ContinuationPolicy, forExecution: boolean): Promise<void> {
    const { projectId, detail } = this.state, project = this.state.projects.find(item => item.id === projectId)
    const execution = forExecution ? detail?.execution : undefined
    if (!project || (forExecution && !execution)) throw Error('当前项目或执行不可用')
    const revision = this.revision, sourceRevision = this.sourceRevision
    const result = execution ? await this.submit({ type: 'task.configure-continuation', ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch, policy })
      : await this.submit({ type: 'project.configure-continuation', projectId: project.id, expectedVersion: project.version, policy })
    if (revision !== this.revision || sourceRevision !== this.sourceRevision) return
    if (result.project) this.update({ projects: this.state.projects.map(item => item.id === result.project!.id ? result.project! : item) })
    if (execution) await this.refreshTask()
  }
  private historyRevision = 0
  private historyRead?: AbortController
  closeHistory(): void {
    ++this.historyRevision; this.historyRead?.abort(); this.historyRead = undefined
    this.update({ history: emptyHistory() })
  }
  async openHistory(session: SessionRef): Promise<void> {
    this.stopObservation()
    this.closeHistory()
    const execution = this.state.detail?.execution
    if (!execution?.retired?.some(item => item.session.runtimeId === session.runtimeId && item.session.sessionId === session.sessionId)) {
      this.update({ history: { ...emptyHistory(), error: '该会话不属于当前工作的接续历史' } }); return
    }
    this.update({ history: { ...emptyHistory(), session } })
    await this.readHistoryPage()
  }
  async moreHistory(): Promise<void> {
    if (this.state.history.loading || this.state.history.nextCursor === undefined) return
    await this.readHistoryPage(this.state.history.nextCursor)
  }
  async retryHistory(): Promise<void> {
    const history = this.state.history
    if (history.loading || !history.session) return
    await this.readHistoryPage(history.loaded ? history.nextCursor : undefined)
  }
  private async readHistoryPage(cursor?: number): Promise<void> {
    const { detail, history } = this.state, session = history.session, task = detail?.task
    if (!session || !task) return
    const ref = { projectId: task.projectId, taskId: task.id }
    const revision = this.revision, sourceRevision = this.sourceRevision, historyRevision = ++this.historyRevision
    this.historyRead?.abort()
    const abort = new AbortController(); this.historyRead = abort
    const current = () => !abort.signal.aborted && revision === this.revision && sourceRevision === this.sourceRevision && historyRevision === this.historyRevision
    this.update({ history: { ...history, loading: true, error: null } })
    try {
      const result = await this.client.query({ type: 'task.history', ref, session, limit: 50, ...(cursor === undefined ? {} : { cursor }) }, abort.signal)
      if (!current()) return
      const transcript = result.transcript
      if (!transcript || transcript.session.runtimeId !== session.runtimeId || transcript.session.sessionId !== session.sessionId || !Array.isArray(transcript.events)) throw Error('历史响应与所选会话不一致')
      if (transcript.nextCursor !== undefined && (!Number.isSafeInteger(transcript.nextCursor) || transcript.nextCursor <= (cursor ?? 0))) throw Error('历史分页位置未向前推进')
      this.update({ history: { session, events: cursor === undefined ? transcript.events : [...history.events, ...transcript.events], ...(transcript.nextCursor === undefined ? {} : { nextCursor: transcript.nextCursor }), loading: false, loaded: true, error: null } })
    } catch (error) { if (current()) this.update({ history: { ...this.state.history, loading: false, error: message(error) } }) }
  }
  private advanceSourceRevision(): number { this.stopObservation(); this.closeHistory(); this.update({ startup: emptyStartup(), observationError: null }); return ++this.sourceRevision }
  private sourceRevision = 0
  private updateSource(value: Partial<SourcePanelState>): void { this.update({source:{...this.state.source,...value}}) }
  /** Navigation invalidates source UI effects, never an already authorized command. */
  private invalidateSourceNavigation(): void { this.advanceSourceRevision(); this.updateSource({loading:false}) }
  setObject(object: WorkPanelState['object']): void { ++this.revision; this.invalidateSourceNavigation(); this.update({object,loading:false}) }
  async showSources(): Promise<void> {
    const projectId=this.state.projectId
    if (!projectId) return
    ++this.revision
    const revision=this.advanceSourceRevision()
    this.update({object:'issues',detail:null,loading:false,error:null})
    this.updateSource({loading:true,error:null})
    try {
      const result=await this.client.query({type:'source.list',projectId})
      if(revision!==this.sourceRevision) return
      const sources=result.sources ?? []
      this.update({projectSources:{...this.state.projectSources,[projectId]:sources}})
      const sourceId=sources.find(item=>item.id===this.state.source.sourceId)?.id ?? sources.find(item=>item.githubProject)?.id ?? sources[0]?.id ?? null
      this.updateSource({sources,sourceId,loading:false})
      if(sourceId) await this.browseIssues({},false)
    } catch(error) {if(revision===this.sourceRevision) this.updateSource({loading:false,error:message(error)})}
  }
  async configureSource(owner:string,repository:string):Promise<void> {
    const projectId=this.state.projectId,revision=this.advanceSourceRevision()
    if(!projectId) throw Error('请先选择项目')
    try {
      const result=await this.submit({type:'source.configure',projectId,repository:{owner:owner.trim(),repository:repository.trim()}})
      if(revision!==this.sourceRevision) return
      if(!result.source) throw Error('工作服务未返回来源')
      const sources=[...this.state.source.sources.filter(item=>item.id!==result.source!.id),result.source]
      this.update({object:'issues'})
      this.updateSource({...emptySource(),sources,sourceId:result.source.id})
      await this.browseIssues({},true)
    } catch(error) { if(revision===this.sourceRevision) throw error }
  }
  async configureProjectSource(owner: string, type: 'org' | 'user', number: number): Promise<void> {
    const projectId = this.state.projectId, revision = this.advanceSourceRevision()
    if (!projectId) throw Error('请先选择项目')
    try {
      const result = await this.submit({ type: 'source.configure-project', projectId, githubProject: { owner: owner.trim(), type, number } })
      if (revision !== this.sourceRevision) return
      if (!result.source) throw Error('工作服务未返回来源')
      const sources = [...this.state.source.sources.filter(item => item.id !== result.source!.id), result.source]
      this.update({ object: 'issues' })
      this.updateSource({ ...emptySource(), sources, sourceId: result.source.id })
      await this.browseIssues({}, true)
    } catch (error) { if (revision === this.sourceRevision) throw error }
  }
  async selectSource(sourceId:string):Promise<void> {
    this.advanceSourceRevision()
    this.updateSource({...emptySource(),sources:this.state.source.sources,sourceId})
    await this.browseIssues({},false)
  }
  async browseIssues(change:Partial<IssuePageRequest>={},refresh=false):Promise<void> {
    const {projectId}=this.state, previous=this.state.source
    if(!projectId || !previous.sourceId) return
    const revision=this.advanceSourceRevision()
    const changed=Object.entries(change).some(([key,value])=>previous[key as keyof IssuePageRequest]!==value)
    this.updateSource({...change,loading:true,error:null,issue:null,bindings:[],canonical:null,...(changed?{listing:null}:{})})
    const {sourceId,page,perPage,assignee,state}=this.state.source
    try {
      const result=await this.client.query({type:'source.issues',projectId,sourceId:sourceId!,page,perPage,assignee,state,refresh})
      if(revision===this.sourceRevision) this.receiveSource(result,refresh,false)
    }catch(error){if(revision===this.sourceRevision) this.sourceFailed(error,false)}
  }
  async openIssue(number:number,refresh=true,nodeId?:string):Promise<void> {
    this.detailTrail=[]
    ++this.revision
    this.update({detail:null,detailTab:'overview',loading:false,error:null})
    const {projectId}=this.state,{sourceId}=this.state.source
    if(!projectId || !sourceId) return
    const revision=this.advanceSourceRevision()
    this.updateSource({...(this.state.source.issue?.number===number&&(!nodeId||this.state.source.issue.nodeId===nodeId)?{}:{issue:null,bindings:[]}),canonical:null,loading:true,error:null})
    try {
      const result=await this.client.query({type:'source.issue',projectId,sourceId,number,refresh,...(nodeId?{nodeId}:{})})
      if(revision===this.sourceRevision) {
        this.receiveSource(result,refresh,true)
        await this.loadIssueProgress(revision)
      }
    }catch(error){if(revision===this.sourceRevision) {
      this.sourceFailed(error,true)
      await this.loadIssueProgress(revision)
    }}
  }
  /** Viewing an Issue only resolves an existing binding; it never imports or starts work. */
  private async loadIssueProgress(sourceRevision: number): Promise<void> {
    const revision=this.revision
    const issue = this.state.source.issue
    const ref = this.state.source.bindings.find(binding => binding.nodeId === issue?.nodeId)?.ref
      ?? (issue ? this.progressForIssue(issue)?.ref : undefined)
    if (!ref) return
    try {
      const detail = await this.client.query({type:'task.detail',ref})
      if (revision === this.revision && sourceRevision === this.sourceRevision && detail.task?.id === ref.taskId && detail.task.projectId === ref.projectId) this.update({detail})
    } catch (error) { if (revision === this.revision && sourceRevision === this.sourceRevision) this.update({error:message(error)}) }
  }
  async connectProject(githubProject: {owner:string;type:'org'|'user';number:number}, resource?: import('../work-types.ts').ResourceRef): Promise<void> {
    const revision = ++this.revision
    const sourceRevision = this.advanceSourceRevision()
    try {
      const result = await this.submit({type:'source.connect',githubProject:{...githubProject,owner:githubProject.owner.trim()},...(resource?{resource}:{})})
      if (revision !== this.revision || sourceRevision !== this.sourceRevision) return
      if (!result.project || !result.source) throw Error('GitHub Project 连接未返回项目与来源')
      const project = result.project, source = result.source
      const sources=[...(this.state.projectSources[project.id]??[]).filter(item=>item.id!==source.id),source]
      this.update({projects:[...this.state.projects.filter(item=>item.id!==project.id),project],projectSources:{...this.state.projectSources,[project.id]:sources}})
      const selecting=this.selectProject(project.id,false), selectedRevision=this.revision
      await selecting
      if (selectedRevision !== this.revision) return
      this.update({detail:null,object:'issues'})
      this.updateSource({...emptySource(),sources,sourceId:source.id})
      await this.browseIssues({},true)
    } catch(error) { if (revision===this.revision && sourceRevision===this.sourceRevision) throw error }
  }
  connectedProjects(): Project[] {
    return this.state.projects.filter(project=>this.state.projectSources[project.id]?.some(source=>source.githubProject))
  }
  setIssueFilter(issueFilter: WorkPanelState['issueFilter']): void { this.update({issueFilter}) }
  visibleIssues(): GitHubIssue[] {
    const query=this.state.search.trim().toLocaleLowerCase()
    return (this.state.source.listing?.items??[]).filter(issue=>{
      const progress=this.progressForIssue(issue), status=progress?.processingState??'not-started'
      const filter=this.state.issueFilter
      return (filter==='all'||status===filter||(filter==='waiting'&&status==='paused'))
        && (!query || `${issue.repository.owner}/${issue.repository.repository} #${issue.number} ${issue.title} ${issue.body??''} ${issue.labels.join(' ')}`.toLocaleLowerCase().includes(query))
    })
  }
  private receiveSource(result:Pick<WorkCompleted,'source'|'page'|'issue'|'bindings'>,refresh:boolean,detail:boolean):void {
    const sources=result.source?this.state.source.sources.map(source=>source.id===result.source!.id?result.source!:source):this.state.source.sources
    if (result.source) this.update({projectSources:{...this.state.projectSources,[result.source.projectId]:sources}})
    this.updateSource({sources,loading:false,cached:!refresh,error:result.source?.lastError?`${result.source.lastError.code}: ${result.source.lastError.message}`:null,...(detail?{...(result.issue?{issue:result.issue}:{}),...(result.bindings?{bindings:result.bindings}:{})}:result.page?{listing:result.page}:{})})
  }
  private sourceFailed(error:unknown,detail:boolean):void {
    if(error instanceof WorkClientError) this.receiveSource(error.result,false,detail)
    this.updateSource({loading:false,cached:true,error:message(error)})
  }
  async setSourceEnabled(enabled:boolean):Promise<void> {
    const {projectId}=this.state,source=this.state.source.sources.find(item=>item.id===this.state.source.sourceId)
    if(!projectId || !source) return
    const revision=this.advanceSourceRevision()
    this.updateSource({loading:true,error:null})
    try {
      const result=await this.submit({type:'source.set-enabled',projectId,sourceId:source.id,expectedVersion:source.version,enabled})
      if(revision!==this.sourceRevision) return
      if(!result.source) throw Error('工作服务未返回来源')
      this.updateSource({loading:false,sources:this.state.source.sources.map(item=>item.id===source.id?result.source!:item)})
    }catch(error){if(revision===this.sourceRevision)this.updateSource({loading:false,error:message(error)})}
  }
  async acceptIssue(existing?:WorkTask):Promise<void> {
    const {projectId}=this.state,{sourceId,issue}=this.state.source
    if(!projectId || !sourceId || !issue) throw Error('请先读取完整 Issue')
    const revision=this.advanceSourceRevision()
    this.updateSource({loading:true,error:null,canonical:null})
    try {
      const result=await this.submit(existing
        ? {type:'source.link',ref:{projectId:existing.projectId,taskId:existing.id},expectedVersion:existing.version,sourceId,nodeId:issue.nodeId}
        : {type:'source.import',projectId,sourceId,nodeId:issue.nodeId})
      if(revision!==this.sourceRevision) return
      if(!result.ref) throw Error('工作服务未返回已保存工作的定位信息')
      this.updateSource({loading:false,...(result.binding?{bindings:[result.binding]}:{})})
      await this.openTask(result.ref)
    } catch(error) {
      if(revision!==this.sourceRevision) return
      this.updateSource({loading:false,error:error instanceof WorkClientError&&error.result.error.code==='external-object-owned'?'该 Issue 已关联本地工作，请打开已有工作。':message(error),canonical:error instanceof WorkClientError?error.result.ref??null:null})
    }
  }
  backToIssues():void {++this.revision;this.advanceSourceRevision();this.update({detail:null,loading:false,error:null});this.updateSource({issue:null,bindings:[],canonical:null,loading:false,error:null})}
  private pendingCommands = new Map<string, string>()
  async submit(command: WorkIntent): Promise<WorkCompleted> {
    this.stopObservation(); ++this.activeCommands
    try {
      const key = JSON.stringify(command)
      const commandId = this.pendingCommands.get(key) ?? browserUUID()
      this.pendingCommands.set(key, commandId)
      const result = await this.client.command({ ...command, commandId })
      this.pendingCommands.delete(key)
      if (result.task) {
        const task = result.task
        const tasks = this.state.tasks.some(item => item.id === task.id)
          ? this.state.tasks.map(item => item.id === task.id ? task : item)
          : task.projectId === this.state.projectId ? [...this.state.tasks, task] : this.state.tasks
        this.update({ tasks })
      }
      return result
    } finally { --this.activeCommands }
  }
  canReturnToRequirement(): boolean { return this.detailTrail.length>0 }
  back(): void {
    ++this.revision; this.invalidateSourceNavigation()
    const previous=this.detailTrail.pop()
    if (previous) { this.update({...previous,loading:false,error:null}); return }
    const origin=this.sourceOrigin;this.sourceOrigin=null
    this.update({...(origin??{}),detail:null,loading:false,error:null})
    this.updateSource({issue:null,bindings:[],canonical:null,loading:false})
    if (!this.state.source.listing && this.state.source.sourceId) void this.browseIssues({},false)
  }
  leavePanel(): void { ++this.revision; this.invalidateSourceNavigation(); this.update({loading:false}) }
  close(): void { this.leavePanel(); this.navigation.selectPanel(null) }
  openSession(session: SessionRef): void { this.leavePanel(); this.navigation.openSession(session.sessionId) }
  setSearch(search: string): void { this.update({ search }) }
  setView(view: LocalView): void { this.update({ view }) }
  setDetailTab(detailTab: DetailTab): void { this.update({ detailTab }) }
  progressForIssue(issue: Pick<GitHubIssue,'nodeId'|'url'>): TaskProgressView | undefined {
    const key = (value: string): string | undefined => {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password
          && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*\/?$/.test(url.pathname)
          ? url.pathname.toLowerCase().replace(/\/$/, '') : undefined
      } catch { return undefined }
    }
    const canonical = key(issue.url)
    return this.state.progressItems.find(item => item.source?.nodeId === issue.nodeId || (canonical && item.source && key(item.source.url) === canonical))
  }
  /** Each mounted native entry owns its timer and request lifetime. Polling only observes. */
  watchSessionWork(sessionId: string, receive: (work: import('../work-types.ts').AssociatedWork[]) => void, reportError: (error: string | null) => void): () => void {
    const abort = new AbortController()
    let reading = false
    const load = async () => {
      if (reading || abort.signal.aborted) return
      reading = true
      try {
        const resources = await this.client.query({ type: 'resources.list' }, abort.signal)
        if (abort.signal.aborted) return
        const runtimes = [...new Set(resources.resources?.map(resource => resource.ref.runtimeId) ?? [])]
        const results = await Promise.all(runtimes.map(runtimeId => this.client.query({ type: 'session.work', session: { runtimeId, sessionId } }, abort.signal)))
        if (!abort.signal.aborted) { receive(results.flatMap(result => result.work ?? [])); reportError(null) }
      } catch (error) { if (!abort.signal.aborted) reportError(message(error)) }
      finally { reading = false }
    }
    void load()
    const timer = setInterval(() => { void load() }, 5000)
    return () => { abort.abort(); clearInterval(timer) }
  }
  private currentTaskRead?: AbortController
  /** Only an explicit click enters the freshly observed, verified control Session. */
  async openCurrentTask(ref: TaskRef, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return
    this.currentTaskRead?.abort()
    const abort = new AbortController(); this.currentTaskRead = abort
    const cancel = () => abort.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    const revision = this.revision, sourceRevision = this.sourceRevision
    try {
      const detail = await this.client.query({ type: 'task.detail', ref }, abort.signal)
      if (abort.signal.aborted || revision !== this.revision || sourceRevision !== this.sourceRevision) return
      const execution = detail.execution
      if (detail.task?.id !== ref.taskId || detail.task.projectId !== ref.projectId || !execution?.actual
        || execution.ref.taskId !== ref.taskId || execution.ref.projectId !== ref.projectId
        || execution.actual.runtimeId !== execution.session.runtimeId
        || !['ready', 'running', 'waiting', 'paused'].includes(execution.state)) throw Error('当前处理会话暂不可进入，请稍后重试或查看工作详情。')
      this.openSession(execution.session)
    } catch (error) { if (!abort.signal.aborted) throw error }
    finally { signal?.removeEventListener('abort', cancel); if (this.currentTaskRead === abort) this.currentTaskRead = undefined }
  }
  visibleTaskRows(): { task: WorkTask; depth: number }[] {
    const tasks = this.visibleTasks(), ids = new Set(tasks.map(task => task.id)), visited = new Set<string>()
    const rows: { task: WorkTask; depth: number }[] = []
    const visit = (task: WorkTask, depth: number) => {
      if (visited.has(task.id)) return
      visited.add(task.id); rows.push({ task, depth })
      for (const child of tasks.filter(item => item.parent?.taskId === task.id && item.parent.projectId === task.projectId)) visit(child, depth + 1)
    }
    for (const task of tasks.filter(item => !item.parent || !ids.has(item.parent.taskId))) visit(task, 0)
    for (const task of tasks) visit(task, 0)
    return rows
  }
  sessionCounts(task: WorkTask): { total: number; current: number; historical: number; associated: number } {
    const { detail, progressItems } = this.state
    const execution = detail?.task?.id === task.id && detail.task.projectId === task.projectId ? detail.execution : undefined
    const control = execution?.session ?? progressItems.find(item => item.ref.taskId === task.id && item.ref.projectId === task.projectId)?.execution?.session
    const key = (session: SessionRef) => JSON.stringify([session.runtimeId, session.sessionId])
    const seen = new Set<string>(control ? [key(control)] : [])
    const current = seen.size
    for (const retired of execution?.retired ?? []) seen.add(key(retired.session))
    const historical = seen.size - current
    for (const association of task.sessions) seen.add(key(association.session))
    return { total: seen.size, current, historical, associated: seen.size - current - historical }
  }
  visibleTasks(): WorkTask[] {
    const { tasks, search, view } = this.state
    const query = search.trim().toLocaleLowerCase()
    return tasks.filter(task => (view === 'all' || (view === 'associated' ? this.sessionCounts(task).total > 0 : this.sessionCounts(task).total === 0))
      && (!query || `${task.title}\n${task.goal}\n${task.specification.text}`.toLocaleLowerCase().includes(query)))
  }
}
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
