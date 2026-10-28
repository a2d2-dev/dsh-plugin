import type { GitHubAccount, GitHubRepositoryOption } from '../work-sources/types.ts'
import type { TaskProgressView } from '../work-progress.ts'
import { browserUUID } from './browser-uuid.ts'
import { WorkClientError, type WorkClient } from './work-api.ts'
import type { ExternalBinding, GitHubIssue, IssuePage, IssuePageRequest, WorkSource, SourceCandidate, SourceCatalog } from '../work-sources/types.ts'
import type { Project, SessionRef, TaskRef, WorkCommand, WorkCompleted, WorkExecutionOptions, WorkTask, SourceScanProgress } from '../work-types.ts'
type WithoutCommandId<T> = T extends unknown ? Omit<T, 'commandId'> : never
export type WorkIntent = WithoutCommandId<WorkCommand>

export type DetailTab = 'overview' | 'sessions' | 'continuation' | 'related' | 'activity'
export type LocalView = 'all' | 'unassociated' | 'associated'
export type SourceTab = 'overview' | 'project' | 'issues' | 'prs' | 'delegation'
export interface SourcePanelState extends IssuePageRequest {
  tab: SourceTab; catalog: SourceCatalog | null; viewNumber: number | null; viewPage: number
  sources: WorkSource[]; sourceId: string | null; listing: IssuePage | null; issue: GitHubIssue | null
  /** A click selects the detail surface before its remote data is available. */
  issueTarget: { number: number; nodeId?: string } | null
  bindings: ExternalBinding[]; loading: boolean; error: string | null; cached: boolean
  loadingMore: boolean; moreError: string | null; listEpoch: number
  canonical: TaskRef | null
  /** Live Project scan progress while the directory load is in flight. */
  scan: SourceScanProgress | null
}
const emptySource = (): SourcePanelState => ({tab:'overview',catalog:null,viewNumber:null,viewPage:1,sources:[],sourceId:null,listing:null,issue:null,issueTarget:null,bindings:[],page:1,perPage:100,assignee:'@me',state:'open',loading:false,loadingMore:false,moreError:null,listEpoch:0,error:null,cached:true,canonical:null,scan:null})
/** One bounded refresh scans a couple of Project pages; cap the automatic continuation rounds. */
const MAX_SCAN_ROUNDS=120
/** Fold one source's discovery checkpoint into the small progress shape the panel renders. */
function scanProgressOf(discovery?: WorkSource['discovery']): SourceScanProgress | null {
  const checkpoint=discovery?.checkpoint
  if(!discovery||!checkpoint)return null
  return { state:discovery.state, pages:checkpoint.pages, fetched:checkpoint.items.length,
    ...(checkpoint.total===undefined?{}:{total:checkpoint.total}),
    ...(checkpoint.startedAt===undefined?{}:{startedAt:checkpoint.startedAt}),
    ...(discovery.lastSuccessAt===undefined?{}:{lastSuccessAt:discovery.lastSuccessAt}) }
}
export interface StartSelection {
  resourceIndex: number; modelIndex: number; agentPreset: string; permissionPreset: string
}
export interface StartupState {
  busy: boolean; error: string | null; options: WorkExecutionOptions | null; selection: StartSelection | null
  preview: boolean; previewLoading: boolean; expanded: boolean; remember: boolean
}
const emptyStartup = (): StartupState => ({ busy: false, error: null, options: null, selection: null, preview: false, previewLoading: false, expanded: false, remember: true })
/** The server resolves project history and policy; indices are only a view of its current catalog. */
export function startSelection(options: WorkExecutionOptions): StartSelection {
  const preferred = options.selection
  return {
    resourceIndex: Math.max(0, options.resources.findIndex(item => item.ref.runtimeId === preferred?.resource.runtimeId && item.ref.workspaceId === preferred.resource.workspaceId)),
    modelIndex: Math.max(0, options.models.findIndex(item => item.provider === options.defaults.model.provider && item.model === options.defaults.model.model)),
    agentPreset: options.agentPresets.includes(options.defaults.agentPreset) ? options.defaults.agentPreset : options.agentPresets[0]!,
    permissionPreset: options.permissionPresets.includes(options.defaults.permissionPreset) ? options.defaults.permissionPreset : options.permissionPresets[0]!,
  }
}
export interface HistoryState {
  session: SessionRef | null; events: unknown[]; nextCursor?: number
  loading: boolean; loaded: boolean; error: string | null
}
const emptyHistory = (): HistoryState => ({ session: null, events: [], loading: false, loaded: false, error: null })
export interface WorkPanelState {
  github: { account: GitHubAccount | null; busy: boolean; error: string | null; items: GitHubRepositoryOption[]; nextPage: number | null; repositoriesLoaded: boolean; repositoriesLoading: boolean }
  connection: { url: string; candidate: SourceCandidate | null; loading: boolean; error: string | null }
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
  private state: WorkPanelState = { github: { account: null, busy: false, error: null, items: [], nextPage: null, repositoriesLoaded: false, repositoriesLoading: false }, connection: { url: '', candidate: null, loading: false, error: null }, projectSources: {}, issueFilter: 'all', observationError: null, history: emptyHistory(), progressItems: [], startup: emptyStartup(), object:'issues', source:emptySource(), projects: [], projectId: null, tasks: [], detail: null, detailTab: 'overview', search: '', view: 'all', loading: false, error: null }
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
    return this.state.loading || this.state.source.loading || this.state.source.loadingMore || this.state.startup.busy || !!this.state.startup.options || this.state.history.loading || this.activeCommands > 0
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
      const { sourceId, issue, page, perPage, assignee, state, labels, search } = snapshot.source
      const cached = !watchingSource || !sourceId ? Promise.resolve(null) : issue
        ? query({ type: 'source.issue', projectId, sourceId, number: issue.number, nodeId: issue.nodeId, refresh: false })
        : snapshot.source.tab !== 'issues' && (snapshot.source.catalog !== null || snapshot.source.listing === null)
        ? query({ type: 'source.catalog', projectId, sourceId, refresh: false })
        : query({ type: 'source.issues', projectId, sourceId, page, perPage, assignee, state, ...(labels?.length?{labels}:{}), ...(search?.trim()?{search}:{}), refresh: false })
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
      let restartProjectIssues = false
      if (watchingSource) {
        const nextSource = { ...this.state.source }
        if (sourceList.status === 'fulfilled' && sourceList.value?.sources) nextSource.sources = sourceList.value.sources
        if (sourcePage.status === 'fulfilled' && sourcePage.value) {
          const result = sourcePage.value
          if (result.source?.id === sourceId) nextSource.sources = nextSource.sources.map(item => item.id === sourceId ? result.source! : item)
          if (result.catalog) nextSource.catalog = result.catalog
          if (issue && result.issue?.nodeId === issue.nodeId) {
            nextSource.issue = result.issue
            if (result.bindings) nextSource.bindings = result.bindings
          } else if (!issue && result.page) {
            const listing = nextSource.listing
            const previousSource = snapshot.source.sources.find(item=>item.id===sourceId)
            const observedSource = nextSource.sources.find(item=>item.id===sourceId)
            restartProjectIssues = Boolean(previousSource?.githubProject && previousSource.projectSnapshot?.observedAt !== observedSource?.projectSnapshot?.observedAt)
            nextSource.listing = restartProjectIssues ? null : listing ? { ...result.page, items: [...new Map([...listing.items,...result.page.items].map(item=>[item.nodeId,item])).values()] } : result.page
          }
          nextSource.cached = true
        }
        update.source = nextSource
      }
      this.update(update)
      if (restartProjectIssues && current()) await this.browseIssues({},false)
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
      const connected = projects.filter(project => projectSources[project.id]?.length)
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
    this.updateSource({issueTarget:null,error:null})
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
  async refreshDetail(): Promise<void> {
    const {detail,source}=this.state,issue=source.issueTarget??source.issue
    if(issue&&(!detail?.task||source.error)) {
      const selected=source.sources.find(item=>item.id===source.sourceId)
      await this.openIssue(issue.number,Boolean(selected?.enabled),issue.nodeId)
    } else if(detail?.task) await this.refreshTask()
    else await this.load()
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
  /** Read-only preparation makes remembered settings editable before the single start click. */
  async previewStart(): Promise<void> {
    const { projectId, detail, source, startup } = this.state
    if (!projectId || detail?.execution || detail?.task?.completion || startup.busy || startup.previewLoading || startup.options || source.loading || this.state.loading) return
    const ref = detail?.task ? { projectId: detail.task.projectId, taskId: detail.task.id } : null
    if (!ref && (!source.issue || !source.sourceId)) return
    const revision = this.revision, sourceRevision = this.sourceRevision
    this.update({ startup: { ...startup, previewLoading: true } })
    try {
      const result = await this.client.query(ref ? { type: 'task.execution-options', ref } : { type: 'source.execution-options', projectId, sourceId: source.sourceId! })
      if (revision !== this.revision || sourceRevision !== this.sourceRevision || this.state.startup.busy || this.state.startup.options) return
      const options = result.executionOptions
      if (!options || (!options.fallbackReasons?.length && options.selectionSource !== 'remembered')) return
      if (![options.resources, options.models, options.agentPresets, options.permissionPresets].every(values => values.length)) return
      this.update({ startup: { ...emptyStartup(), options, selection: startSelection(options), preview: true, expanded: Boolean(options.fallbackReasons?.length) } })
    } catch { /* Starting explicitly retries the catalog read and reports a failure there. */ }
    finally { if (revision === this.revision && sourceRevision === this.sourceRevision) this.update({ startup: { ...this.state.startup, previewLoading: false } }) }
  }
  setStartSettings(value: Partial<Pick<StartupState, 'expanded' | 'remember'>>): void {
    if (!this.state.startup.busy) this.update({ startup: { ...this.state.startup, ...value } })
  }
  /** One explicit start intent may import an Issue, but navigation changes cancel its later UI steps. */
  async prepareStart(fromIssue = false, confirmed?: StartupState): Promise<void> {
    if (this.state.startup.busy || this.state.startup.previewLoading) return
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
      const result = await this.client.query(useSource ? {type:'source.execution-options',projectId:ref.projectId,sourceId:sourceId!} : {type:'task.execution-options',ref})
      if (!current()) return
      let options = result.executionOptions
      if (!options) throw Error('宿主未返回可用的执行配置')
      if (!options.resources.length) throw Error('没有可用执行目录，请检查宿主的工作目录配置。')
      if (!options.models.length || !options.agentPresets.length || !options.permissionPresets.length) throw Error('宿主暂无可用模型、Agent 预设或权限配置')
      let selection = startSelection(options), changed = false
      // Re-map the visible confirmation by identity when the fresh catalog has a different order.
      if (confirmed?.options && confirmed.selection && ref.projectId === projectId) {
        const previous = confirmed.selection, catalog = confirmed.options
        const resource = catalog.resources[previous.resourceIndex]?.ref, model = catalog.models[previous.modelIndex]
        const resourceIndex = options.resources.findIndex(item => item.ref.runtimeId === resource?.runtimeId && item.ref.workspaceId === resource.workspaceId)
        const modelIndex = options.models.findIndex(item => item.provider === model?.provider && item.model === model.model)
        const selectedModel: WorkExecutionOptions['defaults']['model'] | undefined = model?.provider === catalog.defaults.model.provider && model.model === catalog.defaults.model.model ? catalog.defaults.model : model && { provider: model.provider, model: model.model }
        const efforts = options.models[modelIndex]?.reasoningEfforts
        changed = resourceIndex < 0 || modelIndex < 0 || !options.agentPresets.includes(previous.agentPreset) || !options.permissionPresets.includes(previous.permissionPreset)
          || Boolean(selectedModel?.reasoningEffort !== undefined && efforts && !efforts.includes(selectedModel.reasoningEffort))
        if (!changed) {
          selection = { ...previous, resourceIndex, modelIndex }
          options = { ...options, defaults: { ...options.defaults, model: selectedModel! } }
        } else options = { ...options, fallbackReasons: [...(options.fallbackReasons ?? []), '刚才选择的执行配置已不可用，已重新选择默认值，请确认。'] }
      }
      const fallback = Boolean(options.fallbackReasons?.length)
      this.update({ startup: { ...emptyStartup(), options, selection, expanded: fallback || Boolean(confirmed?.expanded), remember: confirmed?.remember ?? true } })
      if (!changed && ((confirmed && ref.projectId === projectId) || (!fallback && [options.resources, options.models, options.agentPresets, options.permissionPresets].every(values => values.length === 1)))) await this.startPrepared()
    } catch (error) { if (current()) this.update({ startup: { ...this.state.startup, busy: false, error: message(error) } }) }
  }
  selectStart(value: Partial<StartSelection>): void {
    const startup = this.state.startup
    if (!startup.busy && startup.selection) this.update({ startup: { ...startup, selection: { ...startup.selection, ...value }, error: null } })
  }
  cancelStart(): void { ++this.revision; this.update({ startup: emptyStartup() }) }
  async startPrepared(): Promise<void> {
    const { startup, detail } = this.state
    if (startup.busy || !startup.options || !startup.selection) return
    if (startup.preview) { await this.prepareStart(!detail?.task, startup); return }
    if (!detail?.task) return
    const { options, selection } = startup, task = detail.task
    const resource = options.resources[selection.resourceIndex]?.ref, selectedModel = options.models[selection.modelIndex]
    const model = selectedModel && selectedModel.provider === options.defaults.model.provider && selectedModel.model === options.defaults.model.model ? options.defaults.model : selectedModel && { provider: selectedModel.provider, model: selectedModel.model }
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
        agentId: options.agentId, resource, model, agentPreset: selection.agentPreset, permissionPreset: selection.permissionPreset, rememberExecutionDefaults: startup.remember })
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
      && execution.ref.taskId === detail.task.id && !!execution.session.sessionId && !!execution.session.runtimeId
      && execution.actual.runtimeId === execution.session.runtimeId ? execution.session : null
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
  /** Explicitly read a native Issue through its own repository source; never import a Task. */
  async openNativeIssue(issue: import('../work-sources/types.ts').GitHubIssueReference): Promise<void> {
    const previous = this.state
    const origin = previous.detail?.task ? { projectId: previous.projectId, tasks: previous.tasks, progressItems: previous.progressItems, source: previous.source, object: previous.object, search: previous.search, view: previous.view, detail: previous.detail, detailTab: previous.detailTab, issueFilter: previous.issueFilter } : undefined
    const revision = ++this.revision, sourceRevision = this.advanceSourceRevision()
    const current = () => revision === this.revision && sourceRevision === this.sourceRevision
    this.update({ loading: true, error: null })
    try {
      let selected = Object.values(previous.projectSources).flat().find(source => source.enabled && source.repository?.owner.toLowerCase() === issue.repository.owner.toLowerCase() && source.repository.repository.toLowerCase() === issue.repository.repository.toLowerCase())
      if (!selected) {
        if (!previous.projectId) throw Error('请先选择项目，再读取独立工作要求。')
        selected = (await this.submit({ type: 'source.configure', projectId: previous.projectId, repository: issue.repository })).source
        if (!current()) return
        if (!selected) throw Error('未取得子 Issue 的仓库来源。')
      }
      const source = selected
      const [result, project] = await Promise.all([
        this.client.query({ type: 'source.issue', projectId: source.projectId, sourceId: source.id, number: issue.number, nodeId: issue.nodeId, refresh: true }),
        this.client.query({ type: 'project.detail', projectId: source.projectId }),
      ])
      if (!current()) return
      if (result.issue?.nodeId !== issue.nodeId) throw Error('子 Issue 身份与读取响应不一致。')
      const sources = [...(previous.projectSources[source.projectId] ?? []).filter(item => item.id !== source.id), result.source ?? source]
      if (origin) this.detailTrail.push(origin)
      this.update({ projectId: source.projectId, projectSources: { ...this.state.projectSources, [source.projectId]: sources }, tasks: project.tasks ?? [], progressItems: project.progressItems ?? [], detail: null, detailTab: 'overview', loading: false, object: 'issues', source: { ...emptySource(), sources, sourceId: source.id, issue: result.issue, bindings: result.bindings ?? [], cached: false } })
      const binding = result.bindings?.find(binding => binding.nodeId === issue.nodeId)
      if (binding) await this.openTask(binding.ref)
    } catch (error) { if (current()) this.update({ loading: false, error: message(error) }) }
  }
  async openQueueItem(item: import('../work-types.ts').ContinuousWorkItem, sourceId: string): Promise<void> {
    const ref = item.ref ?? item.taskRef
    if (ref) { await this.openTask(ref); return }
    sourceId = item.sourceId ?? sourceId
    const projectId = this.state.projectId
    if (!projectId) return
    if (this.state.source.sourceId !== sourceId) {
      await this.selectConnectedSource(projectId, sourceId)
      if (this.state.projectId !== projectId || this.state.source.sourceId !== sourceId) return
      await this.selectSourceTab('delegation')
    }
    await this.openIssue(item.number, false, item.nodeId)
  }
  /** Queue links observe the current session; they never invoke recovery/start. */
  async openQueueSession(ref: TaskRef, history = false): Promise<void> {
    if (history) {
      await this.openTask(ref)
      if (this.state.detail?.task?.id === ref.taskId && this.state.projectId === ref.projectId) this.setDetailTab('sessions')
      return
    }
    await this.enterTask(ref)
  }
  async enterTask(ref: TaskRef): Promise<void> {
    try { await this.openCurrentTask(ref) }
    catch (error) { this.update({ error: message(error) }) }
  }
  async syncCompletion(command: WorkCommand): Promise<void> {
    if (command.type !== 'task.completion-sync' || this.state.startup.busy) return
    const revision = this.revision, sourceRevision = this.sourceRevision
    const current = () => revision === this.revision && sourceRevision === this.sourceRevision
    this.update({ startup: { ...emptyStartup(), busy: true } })
    try {
      const { commandId: _commandId, ...intent } = command
      await this.submit(intent)
      if (!current()) return
      const detail = await this.client.query({ type: 'task.detail', ref: command.ref })
      if (current()) this.update({ detail, startup: emptyStartup() })
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
  private moreRead?: AbortController
  private advanceSourceRevision(): number { this.issueRead?.abort(); this.issueRead=undefined; this.moreRead?.abort(); this.moreRead=undefined; this.updateSource({loadingMore:false,moreError:null}); this.stopObservation(); this.closeHistory(); this.update({ startup: emptyStartup(), observationError: null }); return ++this.sourceRevision }
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
      this.updateSource({sources,sourceId,loading:false,issue:null,issueTarget:null,bindings:[],canonical:null,tab:'overview',catalog:sources.find(source=>source.id===sourceId)?.catalog??null})
      if(sourceId){if(this.state.source.catalog)await this.browseDirectory(false);else await this.browseIssues({},false)}
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
    this.update({search:'',issueFilter:'all'})
    const project=this.state.source.sources.find(item=>item.id===sourceId)?.githubProject!==undefined
    this.updateSource({...emptySource(),sources:this.state.source.sources,sourceId,...(project?{tab:'overview' as const}:{})})
    if(!project){
      const reading=this.browseIssues({},false), revision=this.sourceRevision
      await reading
      if(revision!==this.sourceRevision)return
    }
    await this.browseDirectory(false)
  }
  async browseIssues(change:Partial<IssuePageRequest>={},refresh=false):Promise<void> {
    const {projectId}=this.state, previous=this.state.source
    if(!projectId || !previous.sourceId) return
    const revision=this.advanceSourceRevision()
    const changed=Object.entries(change).some(([key,value])=>previous[key as keyof IssuePageRequest]!==value)
    this.updateSource({...change,page:change.page??1,perPage:100,listEpoch:previous.listEpoch+1,loading:true,error:null,issue:null,issueTarget:null,bindings:[],canonical:null,...(changed?{listing:null}:{})})
    const {sourceId,page,perPage,assignee,state,labels,search}=this.state.source
    try {
      const result=await this.client.query({type:'source.issues',projectId,sourceId:sourceId!,page,perPage,assignee,state,...(labels?.length?{labels}:{}),...(search?.trim()?{search}:{}),refresh})
      if(revision===this.sourceRevision) this.receiveSource(result,refresh,false)
    }catch(error){if(revision===this.sourceRevision) this.sourceFailed(error,false)}
  }
  /** Append one batch, leaving the cursor unchanged on failure for an exact retry. */
  async moreIssues(): Promise<void> {
    const previous=this.state.source, projectId=this.state.projectId
    const next=previous.listing?.nextPage
    if(!projectId||!previous.sourceId||!next||previous.loading||previous.loadingMore||previous.issue||this.state.detail)return
    const revision=this.sourceRevision, abort=new AbortController()
    this.stopObservation();this.moreRead=abort
    this.updateSource({loadingMore:true,moreError:null})
    const current=()=>!abort.signal.aborted&&revision===this.sourceRevision&&this.moreRead===abort
    const source=previous.sources.find(item=>item.id===previous.sourceId)
    try {
      const result=await this.client.query({type:'source.issues',projectId,sourceId:previous.sourceId,page:next,perPage:100,assignee:previous.assignee,state:previous.state,...(previous.labels?.length?{labels:previous.labels}:{}),...(previous.search?.trim()?{search:previous.search}:{}),refresh:Boolean(source?.enabled&&!source.githubProject)},abort.signal)
      if(!current())return
      if(!result.page)throw Error('来源未返回后续列表')
      if(result.page.items.length>100||result.page.nextPage!==undefined&&result.page.nextPage<=next)throw Error('来源后续列表位置未向前推进')
      if(result.source?.lastError)throw Error(`${result.source.lastError.code}: ${result.source.lastError.message}`)
      if(source?.githubProject&&result.source&&result.source.projectSnapshot?.observedAt!==source.projectSnapshot?.observedAt){
        this.updateSource({sources:this.state.source.sources.map(item=>item.id===source.id?result.source!:item),listing:null})
        await this.browseIssues({},false)
        return
      }
      const listing=this.state.source.listing!
      const items=[...new Map([...listing.items,...result.page.items].map(item=>[item.nodeId,item])).values()]
      const sources=result.source?this.state.source.sources.map(item=>item.id===previous.sourceId?result.source!:item):this.state.source.sources
      this.updateSource({listing:{...result.page,items},sources,page:next,loadingMore:false,cached:!source?.enabled})
      if(result.progressItems)this.mergeProgressItems(result.progressItems)
    }catch(error){if(current())this.updateSource({loadingMore:false,moreError:message(error)})}
    finally {if(this.moreRead===abort)this.moreRead=undefined}
  }
  private issueRead?: AbortController
  async openIssue(number:number,refresh=true,nodeId?:string):Promise<void> {
    const {projectId}=this.state,previous=this.state.source,{sourceId}=previous
    if(!projectId || !sourceId) return
    this.detailTrail=[]
    ++this.revision
    const revision=this.advanceSourceRevision(),abort=new AbortController()
    this.issueRead=abort
    const selected=previous.sources.find(source=>source.id===sourceId)
    const issue=[previous.issue,...(previous.listing?.items??[]),...(selected?.observations.map(item=>item.issue)??[])]
      .find((item):item is GitHubIssue=>!!item&&item.number===number&&(!nodeId||item.nodeId===nodeId))??null
    this.update({detail:null,detailTab:'overview',loading:false,error:null})
    this.updateSource({issueTarget:{number,...(nodeId?{nodeId}:{})},issue,bindings:previous.bindings.filter(binding=>binding.nodeId===issue?.nodeId),canonical:null,loading:true,cached:true,error:null})
    const current=()=>!abort.signal.aborted&&revision===this.sourceRevision
    try {
      const result=await this.client.query({type:'source.issue',projectId,sourceId,number,refresh,...(nodeId?{nodeId}:{})},abort.signal)
      if(!current())return
      if(result.issue?.number!==number||(nodeId&&result.issue.nodeId!==nodeId))throw Error('Issue 身份与读取响应不一致')
      this.receiveSource(result,refresh,true)
      await this.loadIssueProgress(revision)
    }catch(error){if(current()) {
      this.sourceFailed(error,true)
      await this.loadIssueProgress(revision)
    }}finally {if(this.issueRead===abort)this.issueRead=undefined}
  }
  /** Viewing an Issue only resolves an existing binding; it never imports or starts work. */
  private async loadIssueProgress(sourceRevision: number): Promise<void> {
    const revision=this.revision
    const issue = this.state.source.issue
    const ref = this.state.source.bindings.find(binding => binding.nodeId === issue?.nodeId)?.ref
      ?? (issue ? this.progressForIssue(issue)?.ref : undefined)
    if (!ref) return
    this.updateSource({loading:true})
    try {
      const detail = await this.client.query({type:'task.detail',ref})
      if (revision === this.revision && sourceRevision === this.sourceRevision) {
        if(detail.task?.id!==ref.taskId||detail.task.projectId!==ref.projectId)throw Error('工作进展与所选 Issue 不一致')
        this.update({detail})
        this.updateSource({loading:false})
      }
    } catch (error) { if (revision === this.revision && sourceRevision === this.sourceRevision) {this.update({error:message(error)});this.updateSource({loading:false})} }
  }
  private issueDrafts = new Map<string,{search:string;labels:string}>()
  issueQueryDraft():{search:string;labels:string} {
    const id=this.state.source.sourceId??''
    return this.issueDrafts.get(id)??{search:this.state.source.search??'',labels:this.state.source.labels?.join(', ')??''}
  }
  setIssueQueryDraft(change:Partial<{search:string;labels:string}>):void {
    this.issueDrafts.set(this.state.source.sourceId??'',{...this.issueQueryDraft(),...change})
    this.update({})
  }
  private githubAccountRequest = 0
  private githubEpoch = 0
  async refreshGitHubAccount(): Promise<void> {
    if (this.state.github.busy) return
    const request = ++this.githubAccountRequest
    this.update({ github: { ...this.state.github, busy: true, error: null } })
    try {
      const result = await this.client.query({ type: 'github.account' })
      if (request !== this.githubAccountRequest) return
      if (!result.githubAccount) throw Error('GitHub 未返回账号状态')
      this.receiveGitHubAccount(result.githubAccount)
    } catch (error) {
      if (request === this.githubAccountRequest) this.update({ github: { ...this.state.github, busy: false, error: message(error) } })
    }
  }
  private receiveGitHubAccount(account: GitHubAccount): void {
    const changed = this.state.github.account?.identity?.nodeId !== account.identity?.nodeId
    if (changed) {
      ++this.githubEpoch
      this.setSourceURLDraft(this.state.connection.url)
    }
    this.update({ github: { ...this.state.github, account: account, busy: false,
      ...(changed ? { items: [], nextPage: null, repositoriesLoaded: false, repositoriesLoading: false } : {}) } })
  }
  async logoutGitHub(): Promise<void> {
    const { account, busy } = this.state.github
    if (busy || !account?.identity) return
    this.update({ github: { ...this.state.github, busy: true, error: null } })
    try {
      const result = await this.submit({ type: 'github.logout', login: account.identity.login, nodeId: account.identity.nodeId })
      if (!result.githubAccount) throw Error('GitHub 未返回退出后的账号状态')
      this.receiveGitHubAccount(result.githubAccount)
    } catch (error) { this.update({ github: { ...this.state.github, busy: false, error: message(error) } }) }
  }
  async loginGitHub(action: 'start' | 'cancel'): Promise<void> {
    this.update({ github: { ...this.state.github, busy: true, error: null } })
    try {
      const result = await this.submit({ type: 'github.login', action })
      if (!result.githubLogin) throw Error('GitHub 未返回登录状态')
      this.update({ github: { ...this.state.github, busy: false, account: {
        ...(this.state.github.account ?? { status: 'disconnected' as const }), login: result.githubLogin,
      } } })
    } catch (error) { this.update({ github: { ...this.state.github, busy: false, error: message(error) } }) }
  }
  async loadGitHubRepositories(reset = false): Promise<void> {
    const state = this.state.github
    if (state.repositoriesLoading || state.account?.status !== 'connected') return
    const page = reset || !state.repositoriesLoaded ? 1 : state.nextPage
    if (page === null) return
    const epoch = this.githubEpoch, identity = state.account.identity?.nodeId
    this.update({ github: { ...state, repositoriesLoading: true, error: null } })
    try {
      const result = await this.client.query({ type: 'github.repositories', page })
      if (epoch !== this.githubEpoch) return
      const repositories = result.githubRepositories
      if (!repositories) throw Error('GitHub 未返回仓库目录')
      if (repositories.identity.nodeId !== identity) {
        await this.refreshGitHubAccount()
        throw Error('GitHub 账号已变化，请重新读取仓库目录')
      }
      const items = [...(page === 1 ? [] : this.state.github.items), ...repositories.items]
      this.update({ github: { ...this.state.github, items: [...new Map(items.map(item => [item.nodeId, item])).values()],
        nextPage: repositories.nextPage ?? null, repositoriesLoaded: true, repositoriesLoading: false } })
    } catch (error) {
      if (epoch === this.githubEpoch) this.update({ github: { ...this.state.github, repositoriesLoading: false, error: message(error) } })
    }
  }
  private connectionRevision = 0
  setSourceURLDraft(url: string): void {
    ++this.connectionRevision
    this.update({connection:{url,candidate:null,loading:false,error:null}})
  }
  async identifySource(): Promise<void> {
    const revision=++this.connectionRevision, url=this.state.connection.url
    this.update({connection:{url,candidate:null,loading:true,error:null}})
    try {
      const result=await this.client.query({type:'source.identify',url})
      if(revision!==this.connectionRevision)return
      if(!result.candidate)throw Error('来源识别未返回完整候选')
      this.update({connection:{url,candidate:result.candidate,loading:false,error:null}})
    }catch(error){if(revision===this.connectionRevision)this.update({connection:{url,candidate:null,loading:false,error:message(error)}})}
  }
  async connectSource(): Promise<void> {
    const candidate=this.state.connection.candidate
    if(!candidate)throw Error('请先识别来源')
    const revision=++this.revision, sourceRevision=this.advanceSourceRevision()
    const result=await this.submit({type:'source.connect',url:candidate.entryUrl})
    if(revision!==this.revision||sourceRevision!==this.sourceRevision)return
    if(!result.project||!result.source)throw Error('来源连接未返回项目和来源')
    const project=result.project, source=result.source
    const sources=[...(this.state.projectSources[project.id]??[]).filter(item=>item.id!==source.id),source]
    this.update({projects:[...this.state.projects.filter(item=>item.id!==project.id),project],projectSources:{...this.state.projectSources,[project.id]:sources}})
    const selecting=this.selectProject(project.id,false), selectedRevision=this.revision
    await selecting
    if(selectedRevision!==this.revision)return
    this.update({detail:null,object:'issues'})
    this.updateSource({...emptySource(),sources,sourceId:source.id})
    await this.browseDirectory(true)
  }
  async selectConnectedSource(projectId:string,sourceId:string):Promise<void> {
    if(projectId!==this.state.projectId){
      const revision=this.revision+1
      await this.selectProject(projectId,false)
      if(revision!==this.revision)return
      // Switching project clears the source list; load this project's sources
      // before selecting one, otherwise the panel has no source to render.
      const result=await this.client.query({type:'source.list',projectId})
      if(this.state.projectId!==projectId)return
      const sources=result.sources ?? []
      this.update({projectSources:{...this.state.projectSources,[projectId]:sources}})
      this.updateSource({sources})
    }
    this.update({detail:null,object:'issues'})
    await this.selectSource(sourceId)
  }
  async selectSourceTab(tab:SourceTab):Promise<void> {
    this.advanceSourceRevision();++this.revision
    this.update({detail:null,loading:false,search:'',issueFilter:'all'})
    this.updateSource({tab,issue:null,issueTarget:null,error:null,loading:false})
    if(tab==='issues')await this.browseIssues({},!this.state.source.listing)
    else if(tab!=='delegation')await this.browseDirectory(false)
  }
  setProjectView(viewNumber:number|null,viewPage=1):void { this.updateSource({viewNumber,viewPage}) }
  async browseDirectory(refresh=false):Promise<void> {
    const {projectId}=this.state,{sourceId}=this.state.source
    if(!projectId||!sourceId)return
    const revision=this.advanceSourceRevision()
    this.updateSource({loading:true,error:null,issue:null,issueTarget:null,scan:null})
    const timer=setInterval(()=>{void this.readSourceScan(projectId,sourceId,revision)},800)
    try {
      const selected=this.state.source.sources.find(item=>item.id===sourceId)
      const catalogRead=this.client.query({type:'source.catalog',projectId,sourceId,refresh})
      const scanError=selected?.githubProject&&refresh?await this.scanProjectSource(projectId,sourceId,revision):null
      if(revision!==this.sourceRevision)return
      const reads=await Promise.allSettled([catalogRead,
        !selected?.githubProject&&refresh?this.client.query({type:'source.issues',projectId,sourceId,page:1,perPage:100,assignee:'*',state:'all',refresh:true}):Promise.resolve(null)])
      if(revision!==this.sourceRevision)return
      let source=this.state.source.sources.find(item=>item.id===sourceId), catalog=this.state.source.catalog, cached=!refresh
      const errors:string[]=[]
      if(scanError)errors.push(message(scanError))
      for(const read of reads) {
        const value=read.status==='fulfilled'?read.value:read.reason instanceof WorkClientError?read.reason.result:null
        if(read.status==='rejected'){errors.push(message(read.reason));cached=true}
        if(value?.status==='completed'&&value.progressItems)this.mergeProgressItems(value.progressItems)
        if(value?.source)source={...source,...value.source,...(catalog?{catalog}: {})} as WorkSource
        if(value?.catalog){catalog=value.catalog;if(source)source={...source,catalog}}
        if(value?.source?.catalogError&&read.status==='fulfilled'){errors.push(`${value.source.catalogError.code}: ${value.source.catalogError.message}`);cached=true}
      }
      const scan=scanProgressOf(source?.discovery)
      const sources=source?this.state.source.sources.map(item=>item.id===sourceId?source!:item):this.state.source.sources
      if(source)this.update({projectSources:{...this.state.projectSources,[projectId]:sources}})
      this.updateSource({sources,catalog,loading:false,cached,scan,error:errors.join('；')||(!catalog?'目录尚无可读缓存，请刷新来源':null)})
    }catch(error){if(revision===this.sourceRevision)this.updateSource({loading:false,cached:true,error:message(error)})}
    finally { clearInterval(timer) }
  }
  /** Read the durable scan checkpoint so a long Project discovery reports fetched/total while it runs. */
  private async readSourceScan(projectId:string,sourceId:string,revision:number):Promise<void> {
    try {
      const result=await this.client.query({type:'source.progress',projectId,sourceId})
      if(revision===this.sourceRevision&&result.scan)this.updateSource({scan:result.scan})
    } catch {}
  }
  private mergeProgressItems(items:TaskProgressView[]):void {
    this.update({progressItems:[...this.state.progressItems.filter(item=>!items.some(progress=>progress.ref.projectId===item.ref.projectId&&progress.ref.taskId===item.ref.taskId)),...items]})
  }
  /**
   * One refresh request scans only a couple of Project pages, so a large Project
   * stops at a partial checkpoint and reports the page as unobserved. Keep
   * asking until the full snapshot is published instead of surfacing that
   * intermediate state as an error.
   */
  private async scanProjectSource(projectId:string,sourceId:string,revision:number):Promise<Error|null> {
    for(let round=0;round<MAX_SCAN_ROUNDS;round++) {
      try {
        const value=await this.client.query({type:'source.issues',projectId,sourceId,page:1,perPage:100,assignee:'*',state:'all',refresh:true})
        if(revision!==this.sourceRevision)return null
        if(value.source)this.updateSource({sources:this.state.source.sources.map(item=>item.id===sourceId?{...item,...value.source} as WorkSource:item)})
        if(value.progressItems)this.mergeProgressItems(value.progressItems)
        if(!value.source?.discovery?.checkpoint)return null
      } catch(error) {
        if(revision!==this.sourceRevision)return null
        if(error instanceof WorkClientError&&error.result.error.code==='source-page-unobserved'){
          const pending=error.result.source
          if(pending)this.updateSource({sources:this.state.source.sources.map(item=>item.id===sourceId?{...item,...pending} as WorkSource:item)})
          const scan=scanProgressOf(pending?.discovery)
          if(scan)this.updateSource({scan})
          if(!pending?.discovery?.checkpoint)return error
          continue
        }
        return error instanceof Error?error:new Error(String(error))
      }
    }
    return new Error(`Project 扫描超过 ${MAX_SCAN_ROUNDS} 轮仍未完成，请稍后刷新来源继续`)
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
    return this.state.projects.filter(project=>this.state.projectSources[project.id]?.length)
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
  backToIssues():void {++this.revision;this.advanceSourceRevision();this.update({detail:null,loading:false,error:null});this.updateSource({issue:null,issueTarget:null,bindings:[],canonical:null,loading:false,error:null})}
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
    this.updateSource({issue:null,issueTarget:null,bindings:[],canonical:null,loading:false})
    if (!this.state.source.listing && this.state.source.sourceId) void this.browseIssues({},false)
  }
  leavePanel(): void {
    const interrupted=Boolean(this.issueRead)
    ++this.revision; this.invalidateSourceNavigation(); this.update({loading:false})
    if(interrupted)this.updateSource({error:'详情读取已中断，请重试加载详情。'})
  }
  close(): void { this.leavePanel(); this.navigation.selectPanel(null) }
  openSession(session: SessionRef): void { this.leavePanel(); this.navigation.openSession(session.sessionId) }
  setSearch(search: string): void { this.update({ search }) }
  setView(view: LocalView): void { this.update({ view }) }
  setDetailTab(detailTab: DetailTab): void { this.update({ detailTab }) }
  progressForIssue(issue: Pick<GitHubIssue,'url'> & Partial<Pick<GitHubIssue,'nodeId'>>): TaskProgressView | undefined {
    const key = (value: string): string | undefined => {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password
          && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*\/?$/.test(url.pathname)
          ? url.pathname.toLowerCase().replace(/\/$/, '') : undefined
      } catch { return undefined }
    }
    const canonical = key(issue.url)
    return this.state.progressItems.find(item => (issue.nodeId && item.source?.nodeId === issue.nodeId) || (canonical && item.source && key(item.source.url) === canonical))
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
        || !execution.session?.sessionId || !execution.session.runtimeId
        || execution.actual.runtimeId !== execution.session.runtimeId) throw Error('当前处理会话暂不可进入，请稍后重试或查看工作详情。')
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
