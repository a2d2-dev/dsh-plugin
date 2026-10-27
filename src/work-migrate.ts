import type { WorkSnapshot } from './work-schema.ts'
import type { ContinuousWorkRule, TaskRef } from './work-types.ts'
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
  state = normalizeContinuousQueues(state)
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

/** Collapse legacy per-source rules without choosing a broader execution authority. */
export function normalizeContinuousQueues(state: WorkSnapshot): WorkSnapshot {
  if (!state.continuousRules?.some(rule => !rule.slots || rule.items.some(item => !item.sourceId)) && new Set(state.continuousRules?.map(rule => rule.projectId)).size === (state.continuousRules?.length ?? 0)) return state
  const rules: ContinuousWorkRule[] = []
  for (const old of state.continuousRules ?? []) {
    const rule = structuredClone(old)
    rule.slots ??= rule.active ? [rule.active] : []
    for (const item of rule.items) item.sourceId ??= rule.sourceId
    const current = rules.find(item => item.projectId === rule.projectId)
    if (!current) { rules.push(rule); continue }
    // Keep every original setting/plan/item for audit, including duplicate observations.
    current.legacyRules ??= [legacySettings(current)]
    current.legacyRules.push(legacySettings(rule))
    if (!current.planning && rule.planning) current.planning = structuredClone(rule.planning)
    else if (current.planning && rule.planning) current.planning.blocks = [...new Set([...current.planning.blocks, ...rule.planning.blocks])]
    if (rule.blocks?.length) current.blocks = [...new Set([...(current.blocks ?? []), ...rule.blocks])]
    current.enabled = false
    current.version = Math.max(current.version, rule.version) + 1
    current.migrationConflict = { code: 'continuous-scope-conflict', message: 'Multiple legacy source scopes exist. Save explicit Project queue settings before starting further work; existing executions and legacy settings are retained.' }
    current.error = current.migrationConflict
    for (const item of rule.items) {
      const duplicate = current.items.find(prior => prior.nodeId === item.nodeId)
      if (!duplicate) current.items.push(item)
      else if (item.ref && !duplicate.ref) Object.assign(duplicate, item)
      else if (!duplicate.ref && (item.state === 'blocked' || item.state === 'completed')) Object.assign(duplicate, item)
    }
    for (const ref of rule.slots) if (!current.slots!.some(prior => sameTask(prior, ref))) current.slots!.push(ref)
    current.active = current.slots![0]
  }
  return { ...state, continuousRules: rules as WorkSnapshot['continuousRules'] }
}

function legacySettings(rule: ContinuousWorkRule): Omit<ContinuousWorkRule, 'legacyRules'> {
  const { queue, slots, lastRefreshedAt, nextRefreshAt, migrationConflict, legacyRules, ...legacy } = rule
  return structuredClone(legacy)
}
