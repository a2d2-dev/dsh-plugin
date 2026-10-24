import { normalizeSessionTitle } from '@deepseek-ai/dsh-session-title'
import type { WorkSnapshot } from './work-schema.ts'
import type { SessionRef, WorkExecution, WorkTask } from './work-types.ts'

export interface TaskSessionTitle { session: SessionRef; title: string }
export const TASK_SESSION_TITLE_BYTES = 80
const sameSession = (a: SessionRef, b: SessionRef) => a.runtimeId === b.runtimeId && a.sessionId === b.sessionId

/** A readable task fragment; no model output or prompt boilerplate enters a name. */
export function taskTitleText(title: string, goal?: string): string {
  return normalizeSessionTitle(title, 120) || normalizeSessionTitle(goal ?? '', 120) || '任务会话'
}

/** Reserve the identity and sequence before budgeting readable Unicode task text. */
export function formatTaskSessionTitle(identity: string, sequence: string, text: string, parent?: string, others = 0): string {
  let prefix = `${parent ? `${parent}/` : ''}${identity} · ${sequence} · `
  const suffix = others ? ` +${others}任务` : ''
  if (parent && TASK_SESSION_TITLE_BYTES - Buffer.byteLength(prefix + suffix) < 24) prefix = `${identity} · ${sequence} · `
  const available = TASK_SESSION_TITLE_BYTES - Buffer.byteLength(prefix + suffix)
  if (available < 3) throw new Error('Task identity and sequence exceed the supported title budget')
  return prefix + (normalizeSessionTitle(text, available) || normalizeSessionTitle('任务', available)) + suffix
}

/** Source identities locate tasks; epochs locate continuations, never business stages. */
export function workSessionTitles(state: WorkSnapshot, pending?: WorkExecution): TaskSessionTitle[] {
  type Entry = { task: WorkTask; sequence: string; priority: number }
  const names = new Map<string, { session: SessionRef; tasks: Map<string, Entry> }>()
  const taskKey = (ref: { projectId: string; taskId: string }) => JSON.stringify([ref.projectId, ref.taskId])
  const tasks = new Map(state.tasks.map(task => [taskKey({ projectId: task.projectId, taskId: task.id }), task]))
  const issues = new Map(state.externalBindings.map(binding => [taskKey(binding.ref), binding.lastObserved]))
  const executions = new Map(state.executions.map(execution => [taskKey(execution.ref), execution]))
  const numberCounts = new Map<number, number>()
  for (const issue of issues.values()) numberCounts.set(issue.number, (numberCounts.get(issue.number) ?? 0) + 1)
  const idGroups = new Map<string, string[]>()
  for (const task of state.tasks) {
    const id = task.id.replaceAll('-', '')
    const key = id.slice(0, 8)
    const group = idGroups.get(key) ?? []
    group.push(id)
    idGroups.set(key, group)
  }
  const shortId = (task: WorkTask) => {
    const id = task.id.replaceAll('-', '')
    let length = Math.min(8, id.length)
    const group = idGroups.get(id.slice(0, 8))!
    while (length < id.length && group.some(other => other !== id && other.startsWith(id.slice(0, length)))) length++
    return id.slice(0, length)
  }
  const identity = (task: WorkTask) => {
    const issue = issues.get(taskKey({ projectId: task.projectId, taskId: task.id }))
    if (!issue) return `T:${shortId(task)}`
    const ambiguous = (numberCounts.get(issue.number) ?? 0) > 1
    return `#${issue.number}${ambiguous ? `@${shortId(task)}` : ''}`
  }
  const add = (task: WorkTask, session: SessionRef, sequence: string, priority: number) => {
    const key = JSON.stringify([session.runtimeId, session.sessionId])
    const row = names.get(key) ?? { session, tasks: new Map<string, Entry>() }
    row.tasks.set(task.id, { task, sequence, priority })
    names.set(key, row)
  }
  for (const task of state.tasks) {
    for (const purpose of ['related', 'review'] as const) {
      task.sessions.filter(binding => binding.purpose === purpose).forEach((binding, index) => {
        add(task, binding.session, `${purpose === 'review' ? '评审' : '关联'} ${index + 1}`, 0)
      })
    }
    const execution = executions.get(taskKey({ projectId: task.projectId, taskId: task.id }))
    if (!execution) continue
    for (const old of execution.retired ?? []) add(task, old.session, `会话 ${old.epoch}`, 1)
    add(task, execution.session, `会话 ${execution.epoch}`, 2)
    if (pending?.id === execution.id && !sameSession(pending.session, execution.session)) add(task, pending.session, `会话 ${pending.epoch}`, 2)
  }
  return [...names.values()].map(row => {
    // Shared Sessions name their controlling Task, otherwise their first association.
    // The count exposes additional relationships without losing the primary title to truncation.
    const entries = [...row.tasks.values()].sort((a, b) => b.priority - a.priority)
    const { task, sequence } = entries[0]!
    const parent = task.parent && tasks.get(taskKey(task.parent))
    return { session: row.session, title: formatTaskSessionTitle(identity(task), sequence, taskTitleText(task.title, task.goal), parent ? identity(parent) : undefined, entries.length - 1) }
  })
}
