import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { commandSchema, querySchema, snapshotSchema } from './work-schema.ts'
import type { WorkSnapshot } from './work-schema.ts'
import type { HostResource, Project, SessionCandidate, TaskRef, WorkCommand, WorkCompleted, WorkResult, WorkTask } from './work-types.ts'
export type * from './work-types.ts'

/** Only trusted adapters construct authorization; browser payloads cannot supply it. */
export interface WorkActor { readonly operator: boolean }
/** Read-only host port: no session creation, mutation, model invocation or coordination capability. */
export interface WorkHost {
  resources(): Promise<readonly HostResource[]>
  sessions(resource: HostResource): Promise<readonly SessionCandidate[]>
}
function failed(code: string, message: string): WorkResult { return { status: 'failed', error: { code, message } } }
function conflict(currentVersion: number): WorkResult {
  return { status: 'conflict', error: { code: 'version-conflict', message: 'Expected version is stale', currentVersion } }
}
function taskAt(state: WorkSnapshot, ref: TaskRef): WorkTask | undefined {
  return state.tasks.find(item => item.id === ref.taskId && item.projectId === ref.projectId)
}

/** Public local work commands and queries. One v3 snapshot is the only writer authority. */
export class WorkApplication {
  private readonly file: string
  constructor(readonly directory: string, readonly host: WorkHost) {
    if (!isAbsolute(directory)) throw new Error('Work record directory must be absolute')
    this.file = join(directory, 'work-v3.json')
  }
  private async load(): Promise<WorkSnapshot> {
    try { return snapshotSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 3, projects: [], agents: [], tasks: [], commands: [], legacyMappings: [] }
      throw error
    }
  }
  async execute(input: unknown, actor: WorkActor): Promise<WorkResult> {
    if (!actor.operator) return failed('forbidden', 'Host operator authorization is required')
    const parsed = commandSchema.safeParse(input)
    if (!parsed.success) return failed('invalid-command', 'Invalid work command')
    const command = parsed.data
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    return withFileLock(this.file, async () => {
      const state = await this.load()
      const fingerprint = JSON.stringify(command)
      const previous = state.commands.find(item => item.commandId === command.commandId)
      if (previous) return previous.fingerprint === fingerprint ? previous.result : { status: 'conflict', error: { code: 'command-id-reused', message: 'Command ID already has different content' } }
      const result = await this.apply(state, command)
      if (result.status !== 'completed') return result
      // Receipt owns a detached snapshot: subsequent commands must not alter retry results.
      state.commands.push({ commandId: command.commandId, fingerprint, result: structuredClone(result) })
      await writeFileAtomic(this.file, `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 })
      return result
    })
  }
  private newTask(state: WorkSnapshot, command: Extract<WorkCommand, { type: 'task.create' | 'task.create-child' }>, project: Project): WorkTask {
    const task: WorkTask = { id: randomUUID(), projectId: project.id, title: command.title, goal: command.goal, version: 1,
      specification: { version: 1, text: command.specification, acceptance: command.acceptance }, agentId: project.defaultAgentId,
      specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [{ commandId: command.commandId, type: command.type, version: 1 }] }
    state.tasks.push(task)
    return task
  }
  private changed(task: WorkTask, command: WorkCommand): void {
    task.version++
    task.activity.push({ commandId: command.commandId, type: command.type, version: task.version })
  }
  private async apply(state: WorkSnapshot, command: WorkCommand): Promise<WorkResult> {
    if (command.type === 'project.create') {
      const project: Project = { id: randomUUID(), name: command.name, version: 1, defaultAgentId: randomUUID(), resources: [] }
      state.projects.push(project)
      state.agents.push({ id: project.defaultAgentId, projectId: project.id, role: 'coordinator',
        policy: { version: 1, modelCandidates: [], instructions: 'Coordinate accepted work and its acceptance criteria.', capabilities: ['coordination'] } })
      return { status: 'completed', project }
    }
    const projectId = 'projectId' in command ? command.projectId : command.ref.projectId
    const project = state.projects.find(item => item.id === projectId)
    if (!project) return failed('unknown-project', 'Project does not exist')
    if (command.type === 'task.create') return { status: 'completed', task: this.newTask(state, command, project) }
    if (!('ref' in command)) return failed('unsupported-command', 'Command is not implemented')
    const task = taskAt(state, command.ref)
    if (!task) return failed('unknown-task', 'Task does not belong to this project')
    if (task.version !== command.expectedVersion) return conflict(task.version)
    if (command.type === 'task.replace-breakdown') {
      if (new Set(command.blocks.map(block => block.id)).size !== command.blocks.length) return failed('duplicate-block', 'Breakdown block IDs must be unique')
      task.breakdown = command.blocks
      this.changed(task, command)
      return { status: 'completed', task }
    }
    if (command.type === 'task.create-child') {
      const child = this.newTask(state, command, project)
      child.parent = command.ref
      task.children.push({ projectId, taskId: child.id })
      this.changed(task, command)
      return { status: 'completed', task: child }
    }
    if (command.type === 'task.link-child') {
      if (command.child.projectId !== projectId) return failed('cross-project-reference', 'Parent and child must belong to the same project')
      const child = taskAt(state, command.child)
      if (!child) return failed('unknown-task', 'Child Task does not belong to this project')
      if (child.version !== command.childExpectedVersion) return conflict(child.version)
      let ancestor: WorkTask | undefined = task
      while (ancestor) {
        if (ancestor.id === child.id) return failed('task-cycle', 'Parent relationship would form a cycle')
        ancestor = ancestor.parent ? taskAt(state, ancestor.parent) : undefined
      }
      if (child.parent && child.parent.taskId !== task.id) return failed('child-already-linked', 'Child already has another parent')
      if (task.children.some(ref => ref.taskId === child.id)) return { status: 'completed', task }
      child.parent = command.ref
      task.children.push(command.child)
      this.changed(child, command)
      this.changed(task, command)
      return { status: 'completed', task }
    }
    if (command.type === 'task.update-spec') {
      task.specificationHistory.push(task.specification)
      task.specification = { version: task.specification.version + 1, text: command.specification, acceptance: command.acceptance }
      task.goal = command.goal
      this.changed(task, command)
      return { status: 'completed', task }
    }
    return failed('unsupported-command', 'Command is not implemented')
  }
  async query(input: unknown, actor: WorkActor): Promise<WorkResult> {
    if (!actor.operator) return failed('forbidden', 'Host operator authorization is required')
    const parsed = querySchema.safeParse(input)
    if (!parsed.success) return failed('invalid-query', 'Invalid work query')
    const query = parsed.data
    const state = await this.load()
    if (query.type === 'projects.list') return { status: 'completed', projects: state.projects }
    if (query.type !== 'project.detail' && query.type !== 'task.detail') return failed('unsupported-query', 'Query is not implemented')
    const projectId = query.type === 'project.detail' ? query.projectId : query.ref.projectId
    const project = state.projects.find(item => item.id === projectId)
    if (!project) return failed('unknown-project', 'Project does not exist')
    if (query.type === 'project.detail') return { status: 'completed', project,
      agents: state.agents.filter(item => item.projectId === projectId), tasks: state.tasks.filter(item => item.projectId === projectId) }
    const task = taskAt(state, query.ref)
    return task ? { status: 'completed', task,
      ...(task.parent ? { parent: taskAt(state, task.parent) } : {}),
      children: task.children.map(ref => taskAt(state, ref)!).filter(Boolean),
    } : failed('unknown-task', 'Task does not belong to this project')
  }
}
