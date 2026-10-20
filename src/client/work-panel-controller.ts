import { browserUUID } from './browser-uuid.ts'
import { WorkClientError, type WorkClient } from './work-api.ts'
import type { ExternalBinding, GitHubIssue, IssuePage, IssuePageRequest, WorkSource } from '../work-sources/types.ts'
import type { Project, SessionRef, TaskRef, WorkCommand, WorkCompleted, WorkTask } from '../work-types.ts'
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
export interface WorkPanelState {
  object: 'projects' | 'issues' | 'prs'; source: SourcePanelState
  projects: Project[]; projectId: string | null; tasks: WorkTask[]
  detail: WorkCompleted | null; detailTab: DetailTab; search: string; view: LocalView
  loading: boolean; error: string | null
}
export interface WorkNavigation {
  selectPanel(id: 'a2d2-panel' | null): void
  openSession(id: string): void
}
/** One root-owned state survives panel unmounts and native-session round trips. */
export class WorkPanelController {
  private state: WorkPanelState = { object:'projects', source:emptySource(), projects: [], projectId: null, tasks: [], detail: null, detailTab: 'overview', search: '', view: 'all', loading: false, error: null }
  private listeners = new Set<() => void>()
  private sourceOrigin: Pick<WorkPanelState,'projectId'|'tasks'|'source'|'object'|'search'|'view'> | null = null
  private revision = 0
  constructor(readonly client: WorkClient, private readonly navigation: WorkNavigation) {}
  getSnapshot = (): WorkPanelState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(value: Partial<WorkPanelState>): void { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()) }
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
      this.update({ projects })
      const projectId = projects.find(project => project.id === this.state.projectId)?.id ?? projects[0]?.id ?? null
      if (projectId !== null) await this.selectProject(projectId)
      else this.update({ projectId: null, tasks: [], detail: null, loading: false })
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  async selectProject(projectId: string): Promise<void> {
    this.invalidateSourceNavigation()
    const revision = ++this.revision
    const changed = projectId !== this.state.projectId
    if (changed) this.sourceOrigin=null
    this.update({ projectId, loading: true, error: null, ...(changed ? { detail: null, search: '', view: 'all', tasks: [], object:'projects' as const, source:emptySource() } : {}) })
    try {
      const result = await this.client.query({ type: 'project.detail', projectId })
      if (revision === this.revision) this.update({ tasks: result.tasks ?? [], loading: false })
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  async openTask(ref: TaskRef): Promise<void> {
    this.invalidateSourceNavigation()
    if (this.state.projectId !== ref.projectId) {
      const origin=this.state.object==='issues'&&this.state.source.issue?{projectId:this.state.projectId,tasks:this.state.tasks,source:this.state.source,object:this.state.object,search:this.state.search,view:this.state.view}:null
      const projectRevision = this.revision + 1
      await this.selectProject(ref.projectId)
      if (this.revision !== projectRevision || this.state.projectId !== ref.projectId) return
      this.sourceOrigin=origin
    }
    const revision = ++this.revision
    this.update({ detail: null, loading: true, error: null, detailTab: 'overview' })
    try {
      const detail = await this.client.query({ type: 'task.detail', ref })
      if (revision === this.revision) this.update({ detail, loading: false })
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
      if (revision === this.revision) await this.openTask(ref)
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  async refreshTask(): Promise<void> {
    const task = this.state.detail?.task
    if (!task) return
    const revision = ++this.revision
    this.update({ loading: true, error: null })
    try {
      const detail = await this.client.query({ type: 'task.detail', ref: { projectId: task.projectId, taskId: task.id } })
      if (revision === this.revision) this.update({ detail, loading: false })
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  private sourceRevision = 0
  private updateSource(value: Partial<SourcePanelState>): void { this.update({source:{...this.state.source,...value}}) }
  /** Navigation invalidates source UI effects, never an already authorized command. */
  private invalidateSourceNavigation(): void { ++this.sourceRevision; this.updateSource({loading:false}) }
  setObject(object: WorkPanelState['object']): void { ++this.revision; this.invalidateSourceNavigation(); this.update({object,loading:false}) }
  async showSources(): Promise<void> {
    const projectId=this.state.projectId
    if (!projectId) return
    ++this.revision
    const revision=++this.sourceRevision
    this.update({object:'issues',detail:null,loading:false,error:null})
    this.updateSource({loading:true,error:null})
    try {
      const result=await this.client.query({type:'source.list',projectId})
      if(revision!==this.sourceRevision) return
      const sources=result.sources ?? []
      const sourceId=sources.find(item=>item.id===this.state.source.sourceId)?.id ?? sources[0]?.id ?? null
      this.updateSource({sources,sourceId,loading:false})
      if(sourceId) await this.browseIssues({},false)
    } catch(error) {if(revision===this.sourceRevision) this.updateSource({loading:false,error:message(error)})}
  }
  async configureSource(owner:string,repository:string):Promise<void> {
    const projectId=this.state.projectId,revision=++this.sourceRevision
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
  async selectSource(sourceId:string):Promise<void> {
    ++this.sourceRevision
    this.updateSource({...emptySource(),sources:this.state.source.sources,sourceId})
    await this.browseIssues({},false)
  }
  async browseIssues(change:Partial<IssuePageRequest>={},refresh=false):Promise<void> {
    const {projectId}=this.state, previous=this.state.source
    if(!projectId || !previous.sourceId) return
    const revision=++this.sourceRevision
    const changed=Object.entries(change).some(([key,value])=>previous[key as keyof IssuePageRequest]!==value)
    this.updateSource({...change,loading:true,error:null,issue:null,bindings:[],canonical:null,...(changed?{listing:null}:{})})
    const {sourceId,page,perPage,assignee,state}=this.state.source
    try {
      const result=await this.client.query({type:'source.issues',projectId,sourceId:sourceId!,page,perPage,assignee,state,refresh})
      if(revision===this.sourceRevision) this.receiveSource(result,refresh,false)
    }catch(error){if(revision===this.sourceRevision) this.sourceFailed(error,false)}
  }
  async openIssue(number:number,refresh=true):Promise<void> {
    const {projectId}=this.state,{sourceId}=this.state.source
    if(!projectId || !sourceId) return
    const revision=++this.sourceRevision
    this.updateSource({...(this.state.source.issue?.number===number?{}:{issue:null,bindings:[]}),canonical:null,loading:true,error:null})
    try {
      const result=await this.client.query({type:'source.issue',projectId,sourceId,number,refresh})
      if(revision===this.sourceRevision) this.receiveSource(result,refresh,true)
    }catch(error){if(revision===this.sourceRevision) this.sourceFailed(error,true)}
  }
  private receiveSource(result:Pick<WorkCompleted,'source'|'page'|'issue'|'bindings'>,refresh:boolean,detail:boolean):void {
    const sources=result.source?this.state.source.sources.map(source=>source.id===result.source!.id?result.source!:source):this.state.source.sources
    this.updateSource({sources,loading:false,cached:!refresh,error:result.source?.lastError?`${result.source.lastError.code}: ${result.source.lastError.message}`:null,...(detail?{...(result.issue?{issue:result.issue}:{}),...(result.bindings?{bindings:result.bindings}:{})}:result.page?{listing:result.page}:{})})
  }
  private sourceFailed(error:unknown,detail:boolean):void {
    if(error instanceof WorkClientError) this.receiveSource(error.result,false,detail)
    this.updateSource({loading:false,cached:true,error:message(error)})
  }
  async setSourceEnabled(enabled:boolean):Promise<void> {
    const {projectId}=this.state,source=this.state.source.sources.find(item=>item.id===this.state.source.sourceId)
    if(!projectId || !source) return
    const revision=++this.sourceRevision
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
    const revision=++this.sourceRevision
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
  backToIssues():void {++this.sourceRevision;this.updateSource({issue:null,bindings:[],canonical:null,loading:false,error:null})}
  private pendingCommands = new Map<string, string>()
  async submit(command: WorkIntent): Promise<WorkCompleted> {
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
  }
  back(): void {
    ++this.revision; this.invalidateSourceNavigation()
    const origin=this.sourceOrigin;this.sourceOrigin=null
    this.update({...(origin??{}),detail:null,loading:false,error:null})
  }
  leavePanel(): void { ++this.revision; this.invalidateSourceNavigation(); this.update({loading:false}) }
  close(): void { this.leavePanel(); this.navigation.selectPanel(null) }
  openSession(session: SessionRef): void { this.leavePanel(); this.navigation.openSession(session.sessionId) }
  setSearch(search: string): void { this.update({ search }) }
  setView(view: LocalView): void { this.update({ view }) }
  setDetailTab(detailTab: DetailTab): void { this.update({ detailTab }) }
  visibleTasks(): WorkTask[] {
    const { tasks, search, view } = this.state
    const query = search.trim().toLocaleLowerCase()
    return tasks.filter(task => (view === 'all' || (view === 'associated' ? task.sessions.length > 0 : task.sessions.length === 0))
      && (!query || `${task.title}\n${task.goal}\n${task.specification.text}`.toLocaleLowerCase().includes(query)))
  }
}
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
