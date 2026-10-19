import type { WorkClient } from './work-api.ts'
import type { Project, SessionRef, TaskRef, WorkCommand, WorkCompleted, WorkTask } from '../work-types.ts'
type WithoutCommandId<T> = T extends unknown ? Omit<T, 'commandId'> : never
export type WorkIntent = WithoutCommandId<WorkCommand>

export type DetailTab = 'overview' | 'sessions' | 'related' | 'activity'
export type LocalView = 'all' | 'unassociated' | 'associated'
export interface WorkPanelState {
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
  private state: WorkPanelState = { projects: [], projectId: null, tasks: [], detail: null, detailTab: 'overview', search: '', view: 'all', loading: false, error: null }
  private listeners = new Set<() => void>()
  private revision = 0
  constructor(readonly client: WorkClient, private readonly navigation: WorkNavigation) {}
  getSnapshot = (): WorkPanelState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(value: Partial<WorkPanelState>): void { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()) }
  async load(): Promise<void> {
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
    const revision = ++this.revision
    const changed = projectId !== this.state.projectId
    this.update({ projectId, loading: true, error: null, ...(changed ? { detail: null, search: '', view: 'all', tasks: [] } : {}) })
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
    const revision = ++this.revision
    this.update({ detail: null, loading: true, error: null, detailTab: 'overview' })
    try {
      const detail = await this.client.query({ type: 'task.detail', ref })
      if (revision === this.revision) this.update({ detail, loading: false })
    } catch (error) { if (revision === this.revision) this.update({ loading: false, error: message(error) }) }
  }
  async revealTask(ref: TaskRef): Promise<void> { this.navigation.selectPanel('a2d2-panel'); await this.openTask(ref) }
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
  back(): void { ++this.revision; this.update({ detail: null, loading: false, error: null }) }
  close(): void { this.navigation.selectPanel(null) }
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
