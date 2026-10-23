import type { WorkSnapshot } from './work-schema.ts'
import type { TaskRef } from './work-types.ts'
import { sameTask } from './work-continuous.ts'

const key = (ref: TaskRef): string => `${ref.projectId}/${ref.taskId}`
const refOf = (task: { projectId: string; id: string }): TaskRef => ({ projectId: task.projectId, taskId: task.id })

/**
 * GitHub is the only primary store in this stage, so a subtask is a native
 * sub-issue and a local child Task without a binding is invalid cache. Drop the
 * never-started legacy local children an earlier build created, and unlink them
 * from parents, requirement blocks and child completions.
 *
 * Started or reported work is preserved for audit; completion gates ignore
 * non-canonical children instead of reading them as necessary work.
 */
export function normalizeLegacyLocalChildren(state: WorkSnapshot): WorkSnapshot {
  const canonical = new Set(state.externalBindings.map(binding => key(binding.ref)))
  const hasLegacy = state.tasks.some(task => task.parent && !canonical.has(key(refOf(task))))
  if (!hasLegacy) return state
  const executed = new Set(state.executions.map(execution => key(execution.ref)))
  const dropped = new Set<string>()
  for (const task of state.tasks) {
    const ref = refOf(task)
    if (!task.parent || canonical.has(key(ref)) || executed.has(key(ref))) continue
    if (task.progress || task.completion || task.sessions.length > 0) continue
    dropped.add(key(ref))
  }
  if (dropped.size === 0) return state
  const tasks = state.tasks.filter(task => !dropped.has(key(refOf(task)))).map(task => {
    const children = task.children.filter(ref => !dropped.has(key(ref)))
    const breakdown = task.breakdown.some(block => block.child && dropped.has(key(block.child)))
      ? task.breakdown.map(block => block.child && dropped.has(key(block.child)) ? { ...block, child: undefined } : block)
      : task.breakdown
    const childCompletions = task.childCompletions?.some(completion => dropped.has(key(completion.child)))
      ? task.childCompletions.filter(completion => !dropped.has(key(completion.child)))
      : task.childCompletions
    if (children.length === task.children.length && breakdown === task.breakdown && childCompletions === task.childCompletions) return task
    return { ...task, children, breakdown, ...(childCompletions ? { childCompletions } : {}) }
  })
  return { ...state, tasks }
}

/** Canonical children are the only necessary children: native sub-issue records. */
export function isCanonicalChild(state: WorkSnapshot, ref: TaskRef): boolean {
  return state.externalBindings.some(binding => sameTask(binding.ref, ref))
}
