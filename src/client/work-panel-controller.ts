import type { WorkClient } from './work-api.ts'
import type { Project, SessionRef, TaskRef, WorkCommand, WorkCompleted, WorkExecution, WorkTask } from '../work-types.ts'
type WithoutCommandId<T> = T extends unknown ? Omit<T, 'commandId'> : never
export type WorkIntent = WithoutCommandId<WorkCommand>

export type DetailTab = 'overview' | 'sessions' | 'related' | 'activity'
export type LocalView = 'all' | 'unassociated' | 'associated'
export interface WorkPanelState {
  projects: Project[]; projectId: string | null; tasks: WorkTask[]
  detail: WorkCompleted | null; detailTab: DetailTab; search: string; view: LocalView
  execution: WorkExecution | null; executionError: string | null
  loading: boolean; error: string | null
}
export interface WorkNavigation {
  selectPanel(id: 'a2d2-panel' | null): void
  openSession(id: string): void
}
/** One root-owned state survives panel unmounts and native-session round trips. */
export class WorkPanelController {
  private state: WorkPanelState = { projects: [], projectId: null, tasks: [], detail: null, detailTab: 'overview', search: '', view: 'all', execution: null, executionError: null, loading: false, error: null }
  private listeners = new Set<() => void>()
  private revision = 0
  private detailRead?: AbortController
  private cancelDetail(): void { this.detailRead?.abort(); this.detailRead = undefined }
  constructor(readonly client: WorkClient, private readonly navigation: WorkNavigation) {}
  getSnapshot = (): WorkPanelState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(value: Partial<WorkPanelState>): void { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()) }
  async initialize(): Promise<void> {
    if (!this.state.loading && !this.state.projects.length) await this.load()
  }
  async load(): Promise<void> {
    this.cancelDetail()
    const revision = ++this.revision
    this.update({ loading: true, error: null })
    try {
      const result = await this.client.query({ type: 'projects.list' })
      if (revision !== this.revision) return
      const projects = result.projects ?? []
      this.update({ projects })
      const projectId = projects.find(project => project.id === this.state.projectId)?.id ?? projects[0]?.id ?? null
      if (projectId !== null) await this.selectProject(projectId)
      else this.update({ projectId: null, tasks: [], detail: null, execution: null, executionError: null, loading: false })
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  async selectProject(projectId: string): Promise<void> {
    this.cancelDetail()
    const revision = ++this.revision
    const changed = projectId !== this.state.projectId
    this.update({ projectId, loading: true, error: null, ...(changed ? { detail: null, execution: null, executionError: null, search: '', view: 'all', tasks: [] } : {}) })
    try {
      const result = await this.client.query({ type: 'project.detail', projectId })
      if (revision === this.revision) this.update({ tasks: result.tasks ?? [], loading: false })
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  async openTask(ref: TaskRef): Promise<void> {
    if (this.state.projectId !== ref.projectId) {
      const projectRevision = this.revision + 1
      await this.selectProject(ref.projectId)
      if (this.revision !== projectRevision || this.state.projectId !== ref.projectId) return
    }
    this.cancelDetail()
    const revision = ++this.revision
    this.update({ detail: null, execution: null, executionError: null, loading: true, error: null, detailTab: 'overview' })
    await this.readDetail(ref, revision)
  }
  private async readDetail(ref: TaskRef, revision: number): Promise<void> {
    const abort = new AbortController()
    this.detailRead = abort
    const [detail, execution] = await Promise.allSettled([
      this.client.query({ type: 'task.detail', ref }, abort.signal),
      this.client.query({ type: 'task.execution', ref }, abort.signal),
    ])
    if (revision !== this.revision || abort.signal.aborted) return
    this.update({
      detail: detail.status === 'fulfilled' ? detail.value : null,
      execution: execution.status === 'fulfilled' ? execution.value.execution ?? null : null,
      executionError: execution.status === 'rejected' ? message(execution.reason) : null,
      error: detail.status === 'rejected' ? message(detail.reason) : null,
      loading: false,
    })
  }
  async revealTask(ref: TaskRef): Promise<void> {
    this.cancelDetail()
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
    this.cancelDetail()
    const revision = ++this.revision
    this.update({ loading: true, error: null, execution: null, executionError: null })
    await this.readDetail({ projectId: task.projectId, taskId: task.id }, revision)
  }
  private pendingCommands = new Map<string, string>()
  async submit(command: WorkIntent): Promise<WorkCompleted> {
    const key = JSON.stringify(command)
    const commandId = this.pendingCommands.get(key) ?? crypto.randomUUID()
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
  back(): void { this.cancelDetail(); ++this.revision; this.update({ detail: null, execution: null, executionError: null, loading: false, error: null }) }
  close(): void { this.navigation.selectPanel(null) }
  currentSession(): SessionRef | null {
    const { execution, detail, loading, executionError } = this.state
    return !loading && !executionError && execution?.actual
      && execution.ref.projectId === detail?.task?.projectId && execution.ref.taskId === detail?.task?.id
      && execution.actual.runtimeId === execution.session.runtimeId
      && ['ready', 'running', 'waiting', 'paused'].includes(execution.state) ? execution.session : null
  }
  openCurrentSession(): void { const session = this.currentSession(); if (session) this.openSession(session) }
  openSession(session: SessionRef): void { this.navigation.openSession(session.sessionId) }
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
