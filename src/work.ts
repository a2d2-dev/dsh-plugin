import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'

const id = z.string().uuid()
const text = z.string().trim().min(1).max(100_000)
const projectSchema = z.object({
  id, name: text, version: z.number().int().positive(), defaultAgentId: id,
}).strict()
const agentSchema = z.object({
  id, projectId: id, role: z.literal('coordinator'),
  policy: z.object({ version: z.literal(1), modelCandidates: z.array(z.string()), instructions: z.string(), capabilities: z.array(z.string()) }).strict(),
}).strict()
const specificationSchema = z.object({ version: z.number().int().positive(), text, acceptance: z.array(text).min(1) }).strict()
const taskSchema = z.object({
  id, projectId: id, title: text, goal: text, version: z.number().int().positive(),
  specification: specificationSchema, agentId: id,
}).strict()
const snapshotSchema = z.object({
  schemaVersion: z.literal(3), projects: z.array(projectSchema), agents: z.array(agentSchema), tasks: z.array(taskSchema),
}).strict()
export type Project = z.infer<typeof projectSchema>
export type ProjectAgent = z.infer<typeof agentSchema>
export type WorkTask = z.infer<typeof taskSchema>
export interface WorkActor { readonly operator: boolean }
export interface WorkHost {
  resources(): Promise<readonly unknown[]>
  sessions(resource: unknown): Promise<readonly unknown[]>
}
export interface WorkCompleted {
  status: 'completed'
  project?: Project
  task?: WorkTask
  projects?: Project[]
  tasks?: WorkTask[]
  agents?: ProjectAgent[]
}
export type WorkResult = WorkCompleted | { status: 'failed' | 'conflict'; error: { code: string; message: string } }
type Snapshot = z.infer<typeof snapshotSchema>
const createProject = z.object({ type: z.literal('project.create'), commandId: text, name: text }).strict()
const createTask = z.object({ type: z.literal('task.create'), commandId: text, projectId: id, title: text, goal: text, specification: text, acceptance: z.array(text).min(1) }).strict()
const commandSchema = z.discriminatedUnion('type', [createProject, createTask])
const taskRef = z.object({ projectId: id, taskId: id }).strict()
const querySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('projects.list') }).strict(),
  z.object({ type: z.literal('project.detail'), projectId: id }).strict(),
  z.object({ type: z.literal('task.detail'), ref: taskRef }).strict(),
])
function failed(code: string, message: string): WorkResult { return { status: 'failed', error: { code, message } } }

/** Public local work commands and queries. One v3 snapshot is the only writer authority. */
export class WorkApplication {
  private readonly file: string
  constructor(readonly directory: string, readonly host: WorkHost) {
    if (!isAbsolute(directory)) throw new Error('Work record directory must be absolute')
    this.file = join(directory, 'work-v3.json')
  }
  private async load(): Promise<Snapshot> {
    try { return snapshotSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 3, projects: [], agents: [], tasks: [] }
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
      let result: WorkCompleted
      if (command.type === 'project.create') {
        const project: Project = { id: randomUUID(), name: command.name, version: 1, defaultAgentId: randomUUID() }
        state.projects.push(project)
        state.agents.push({ id: project.defaultAgentId, projectId: project.id, role: 'coordinator',
          policy: { version: 1, modelCandidates: [], instructions: 'Coordinate accepted work and its acceptance criteria.', capabilities: ['coordination'] } })
        result = { status: 'completed', project }
      } else {
        const project = state.projects.find(item => item.id === command.projectId)
        if (!project) return failed('unknown-project', 'Project does not exist')
        const task: WorkTask = { id: randomUUID(), projectId: project.id, title: command.title, goal: command.goal, version: 1,
          specification: { version: 1, text: command.specification, acceptance: command.acceptance }, agentId: project.defaultAgentId }
        state.tasks.push(task)
        result = { status: 'completed', task }
      }
      await writeFileAtomic(this.file, `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 })
      return result
    })
  }
  async query(input: unknown, actor: WorkActor): Promise<WorkResult> {
    if (!actor.operator) return failed('forbidden', 'Host operator authorization is required')
    const parsed = querySchema.safeParse(input)
    if (!parsed.success) return failed('invalid-query', 'Invalid work query')
    const query = parsed.data
    const state = await this.load()
    if (query.type === 'projects.list') return { status: 'completed', projects: state.projects }
    const projectId = query.type === 'project.detail' ? query.projectId : query.ref.projectId
    const project = state.projects.find(item => item.id === projectId)
    if (!project) return failed('unknown-project', 'Project does not exist')
    if (query.type === 'project.detail') return { status: 'completed', project,
      agents: state.agents.filter(item => item.projectId === projectId), tasks: state.tasks.filter(item => item.projectId === projectId) }
    const task = state.tasks.find(item => item.id === query.ref.taskId && item.projectId === projectId)
    return task ? { status: 'completed', task } : failed('unknown-task', 'Task does not belong to this project')
  }
}
