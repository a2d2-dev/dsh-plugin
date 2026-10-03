/**
 * Project-local task documents on disk. One YAML document per task under
 * `<projectRoot>/.dsh/a2d2/tasks/`, written atomically under a file lock.
 *
 * `<projectRoot>/.dsh/` is the established project-local root (the same anchor
 * `skill-filesystem` uses for `.dsh/skills`); the plugin's short name namespaces
 * this store so the plugin's footprint stays one directory even when it later
 * owns further kinds of state.
 * @module @deepseek-ai/dsh-a2d2/src/store
 */

import { mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskId } from './brand.ts'
import { parseTaskDocument, renderTaskDocument, taskIdFromFilename } from './document.ts'
import { HandoffDocumentError, handoffDocumentName } from './handoff-document.ts'
import { LocalFileError, readLocalFile, requireLocalFile } from './local-file.ts'
import type { CreateTaskRequest, Task } from './types.ts'

/** Path segments appended to a project root to reach the task documents. */
export const TASKS_DIRECTORY_SEGMENTS = ['.dsh', 'a2d2', 'tasks'] as const

/** Path segments appended to a project root to reach the handoff documents. */
export const HANDOFFS_DIRECTORY_SEGMENTS = ['.dsh', 'a2d2', 'handoffs'] as const

/** Marker used when a deployment configures none. */
export const DEFAULT_PROJECT_MARKERS: readonly string[] = ['.git']

/** Filename extension of every task document. */
export const TASK_DOCUMENT_EXTENSION = '.yaml'

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    // A missing or unreadable marker is simply not a marker; the walk continues
    // and the cwd fallback still applies.
    return false
  }
}

/**
 * Walk upward from a session directory to the first directory carrying one of
 * the project markers.
 *
 * The contract mirrors the instruction loader's resolver: the cwd itself is
 * tested first, the filesystem root ends the walk, and a cwd with no marker
 * anywhere above it is its own project root.
 * @param cwd - absolute session working directory where the walk begins.
 * @param markers - directory entries that identify a project root.
 * @returns the discovered project root, or the resolved cwd when none matches.
 */
export async function resolveProjectRoot(cwd: string, markers: readonly string[]): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    for (const marker of markers) {
      if (await isDirectory(join(current, marker))) return current
    }
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/**
 * The directory holding one project's task documents.
 * @param projectRoot - the project root directory.
 * @returns the absolute tasks directory.
 */
export function tasksDirectory(projectRoot: string): string {
  return join(projectRoot, ...TASKS_DIRECTORY_SEGMENTS)
}

/**
 * The directory holding one project's handoff documents.
 *
 * Handoffs live beside task documents because a successor session continues a
 * task and must be able to read the handoff from the same project tree.
 * @param projectRoot - the project root directory.
 * @returns the absolute handoffs directory.
 */
export function handoffsDirectory(projectRoot: string): string {
  return join(projectRoot, ...HANDOFFS_DIRECTORY_SEGMENTS)
}

/** Turn a task name into the kebab-case stem of its document id. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const TASK_ISSUE_ID_PATTERN = /^issue-[1-9][0-9]*$/

/** Whether a task id is reserved for a tracker task issue. */
function isTaskIssueId(id: string): boolean {
  return TASK_ISSUE_ID_PATTERN.test(id)
}

/** Configuration of a {@link TaskDocumentStore}. */
export interface TaskDocumentStoreConfig {
  /** Fixed project root; when set, the session cwd is ignored. */
  readonly root?: string
  /** Directory entries identifying a project root. */
  readonly projectMarkers: readonly string[]
}

/**
 * File-backed task documents for one deployment.
 *
 * Every method takes the caller's session cwd and resolves the project root
 * itself, so callers never carry project bookkeeping.
 */
export class TaskDocumentStore {
  private readonly config: TaskDocumentStoreConfig

  /**
   * Create a store over the configured project root or the cwd-derived one.
   * @param config - resolved store configuration.
   */
  constructor(config: TaskDocumentStoreConfig) {
    this.config = config
  }

  /**
   * The project root a session directory belongs to.
   * @param cwd - absolute session working directory.
   * @returns the configured root, or the marker-derived project root.
   */
  async projectRoot(cwd: string): Promise<string> {
    return this.config.root ?? await resolveProjectRoot(cwd, this.config.projectMarkers)
  }

  /**
   * Read every task document of the session's project.
   *
   * A project with no tasks directory is valid empty state; a document that
   * fails validation throws, because silently dropping it would hide a task a
   * person can see in their own working tree.
   * @param cwd - absolute session working directory.
   * @returns the tasks in filename order.
 * @throws LocalFileError when a task document exists but is unreadable.
   */
  async list(cwd: string): Promise<readonly Task[]> {
    const directory = tasksDirectory(await this.projectRoot(cwd))
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const documents = entries.filter(entry => entry.endsWith(TASK_DOCUMENT_EXTENSION)).sort()
    const tasks: Task[] = []
    for (const entry of documents) {
      const path = join(directory, entry)
      const text = requireLocalFile(path, await readLocalFile(path))
      if (text === undefined) throw new LocalFileError(path, 'error', 'task document disappeared while listing')
      tasks.push(parseTaskDocument(text, taskIdFromFilename(entry)))
    }
    return tasks
  }

  /**
   * Read one task document.
   * @param cwd - absolute session working directory.
   * @param id - the task to read.
   * @returns the task, or `undefined` when no document carries that id.
 * @throws LocalFileError when the document exists but is unreadable.
   */
  async read(cwd: string, id: TaskId): Promise<Task | undefined> {
    return await this.readFilename(this.filename(await this.projectRoot(cwd), id), id)
  }

  /**
   * Write one task document atomically under its own file lock.
   * @param cwd - absolute session working directory.
   * @param task - the task to persist; its id names the document.
   */
  async write(cwd: string, task: Task): Promise<void> {
    const filename = this.filename(await this.projectRoot(cwd), task.id)
    await this.writeFilename(filename, task)
  }

  /**
   * Read and possibly write one task document while holding that document's lock.
   * @param cwd - absolute session working directory.
   * @param id - the task document id whose lock is held.
   * @param update - produces the task to return and whether it must be persisted.
   * @returns the returned task and whether this call wrote it.
   */
  async updateLocked(
    cwd: string,
    id: TaskId,
    update: (existing: Task | undefined) => Promise<{ readonly task: Task, readonly write: boolean }>,
  ): Promise<{ readonly task: Task, readonly written: boolean }> {
    const filename = this.filename(await this.projectRoot(cwd), id)
    await mkdir(dirname(filename), { recursive: true })
    return await withFileLock(filename, async () => {
      const existing = await this.readFilename(filename, id)
      const next = await update(existing)
      if (next.write) await writeFileAtomic(filename, renderTaskDocument(next.task), { mode: 0o600, dirMode: 0o700 })
      return { task: next.task, written: next.write }
    })
  }

  /**
   * Mint an unused task id for a name.
   *
   * Non-ASCII names (for example Chinese ones) carry no kebab-case stem, so the
   * id falls back to a timestamp stem rather than failing: the name a person
   * reads lives in the document, and the id only has to be unique and safe.
   * @param cwd - absolute session working directory.
   * @param name - the requested name, which supplies the preferred stem.
   * @returns an id no existing document uses.
   */
  async mintId(cwd: string, name: string): Promise<TaskId> {
    const directory = tasksDirectory(await this.projectRoot(cwd))
    const slug = slugify(name)
    const stem = slug === '' ? `task-${Date.now().toString(36)}` : slug
    for (let attempt = 1; ; attempt += 1) {
      const candidate = attempt === 1 ? stem : `${stem}-${attempt}`
      if (isTaskIssueId(candidate)) continue
      try {
        await stat(join(directory, candidate + TASK_DOCUMENT_EXTENSION))
      } catch {
        return TaskId(candidate)
      }
    }
  }

  private async readFilename(filename: string, id: TaskId): Promise<Task | undefined> {
    const text = requireLocalFile(filename, await readLocalFile(filename))
    return text === undefined ? undefined : parseTaskDocument(text, id)
  }

  private async writeFilename(filename: string, task: Task): Promise<void> {
    const text = renderTaskDocument(task)
    // The lock file sits beside the document, so the directory must exist before
    // the lock is taken; writeFileAtomic's own parent creation runs too late.
    await mkdir(dirname(filename), { recursive: true })
    await withFileLock(filename, async () => {
      await writeFileAtomic(filename, text, { mode: 0o600, dirMode: 0o700 })
    })
  }

  private filename(projectRoot: string, id: TaskId): string {
    return join(tasksDirectory(projectRoot), id + TASK_DOCUMENT_EXTENSION)
  }
}

/**
 * Write one handoff document atomically under its own file lock.
 * @param directory - the project's handoffs directory.
 * @param source - the handed-off session, whose id names the document.
 * @param text - the rendered document.
 * @returns the absolute path written.
 */
export async function writeHandoffDocument(
  directory: string,
  source: SessionId,
  text: string,
): Promise<string> {
  const filename = join(directory, handoffDocumentName(source))
  // The lock file sits beside the document, so the directory must exist before
  // the lock is taken; writeFileAtomic's own parent creation runs too late.
  await mkdir(directory, { recursive: true })
  await withFileLock(filename, async () => {
    await writeFileAtomic(filename, text, { mode: 0o600, dirMode: 0o700 })
  })
  return filename
}

/**
 * Read one handoff document's raw text.
 *
 * A missing document is a failure rather than an empty result: the successor
 * asked to continue from a handoff that a person or a fresh clone may still have
 * to produce, and silently continuing without it would lose the session's
 * context without saying so.
 * @param directory - the project's handoffs directory.
 * @param source - the handed-off session, whose id names the document.
 * @returns the document's UTF-8 content.
 * @throws HandoffDocumentError when no document exists for that session.
 */
export async function readHandoffDocument(directory: string, source: SessionId): Promise<string> {
  const filename = join(directory, handoffDocumentName(source))
  const text = requireLocalFile(filename, await readLocalFile(filename))
  if (text === undefined) {
    throw new HandoffDocumentError(
      'malformed',
      `no handoff document at "${filename}"; the source session must run /handoff in the same project first`,
    )
  }
  return text
}

/**
 * Build a task document for a new task.
 * @param id - the minted id.
 * @param request - the requested name and optional goal.
 * @param now - injection point for the creation timestamp.
 * @returns the task before it is written.
 */
export function newTask(id: TaskId, request: CreateTaskRequest, now: Date): Task {
  const name = request.name.trim()
  if (name === '') throw new Error('a2d2: a task name must not be blank')
  const goal = request.goal?.trim()
  return {
    id,
    name,
    ...(goal === undefined || goal === '' ? {} : { goal }),
    state: 'active',
    createdAt: now.toISOString(),
    members: [],
  }
}

/**
 * Append a member to a task unless it is already one.
 *
 * Membership registration is idempotent so a retried handoff cannot duplicate a
 * member or overwrite the edge the first attempt recorded.
 * @param task - the task to extend.
 * @param sessionId - the session joining the task.
 * @param handoffFrom - the member this session was handed off from, when any.
 * @returns the extended task, or the same task when it already had the member.
 */
export function withMember(
  task: Task,
  sessionId: SessionId,
  handoffFrom?: SessionId,
): Task {
  if (task.members.some(member => member.sessionId === sessionId)) return task
  const member = handoffFrom === undefined ? { sessionId } : { sessionId, handoffFrom }
  return { ...task, members: [...task.members, member] }
}
