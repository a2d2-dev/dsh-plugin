import { continuousBlocks } from './work-blocks.ts'
import { screeningKey, SCREENING_PENDING } from './work-screening.ts'
import type { WorkSnapshot } from './work-schema.ts'
import type { ContinuousWorkRule, TaskRef, WorkExecution } from './work-types.ts'
import type { WorkSource } from './work-sources/types.ts'

export const sameTask = (a: TaskRef | undefined, b: TaskRef | undefined): boolean => !!a && !!b && a.projectId === b.projectId && a.taskId === b.taskId
export const continuousSlots = (rule: ContinuousWorkRule): TaskRef[] => rule.slots ?? (rule.active ? [rule.active] : [])
export const continuousHasSlot = (rule: ContinuousWorkRule, ref: TaskRef): boolean => continuousSlots(rule).some(slot => sameTask(slot, ref))
export function continuousSetSlot(rule: ContinuousWorkRule, ref: TaskRef, retain: boolean): void {
  rule.slots = continuousSlots(rule).filter(slot => !sameTask(slot, ref))
  if (retain) rule.slots.push(ref)
  rule.active = rule.slots[0]
}
export function continuousProblem(item: ContinuousWorkRule['items'][number], message: string): void {
  if (item.state !== 'completed') item.state = 'blocked'
  item.reason = message; item.attempts++; delete item.retryAt; delete item.resumeRequested; delete item.explicitResumeRequested
}
export function continuousOwner(state: WorkSnapshot, ref: TaskRef) {
  for (const rule of state.continuousRules ?? []) {
    const item = rule.items.find(item => sameTask(item.ref, ref))
    if (item) return { rule, item }
  }
}
export function continuousCompleted(state: WorkSnapshot, execution: WorkExecution): boolean {
  const owner = continuousOwner(state, execution.ref)
  if (!owner) return false
  const task = state.tasks.find(task => task.id === execution.ref.taskId && task.projectId === execution.ref.projectId)
  return owner.item.state === 'completed' || (task?.progress?.stage === 'done' && task.progress.specificationVersion === task.specification.version)
}
/** The native pre-step and per-session maintenance guard use the same durable slot. */
export function continuousMayAdvance(state: WorkSnapshot, execution: WorkExecution): boolean {
  const owner = continuousOwner(state, execution.ref)
  return !owner || (!continuousCompleted(state, execution) && owner.item.state === 'active' && continuousHasSlot(owner.rule, execution.ref))
}
export function sourceScopeError(rule: ContinuousWorkRule, source: WorkSource | undefined): { code: string; message: string } | undefined {
  if (rule.migrationConflict) return rule.migrationConflict
  if (!source?.enabled) return { code: 'source-disabled', message: 'Source is disabled; existing executions are retained' }
  if (source.lastError) return { code: source.lastError.code, message: source.lastError.message }
  if (rule.scope.assignee === '@me' && (!rule.scope.identity || source.identity?.nodeId !== rule.scope.identity.nodeId || source.identity.login.toLowerCase() !== rule.scope.identity.login.toLowerCase())) return { code: 'github-identity-changed', message: 'GitHub account differs from the account explicitly authorized for this rule; reconfigure the scope' }
  if (source.repository) return source.repositorySnapshot?.sourceVersion === source.version ? undefined : { code: 'source-snapshot-unavailable', message: 'Continuous processing requires a complete version-matched repository candidate scan' }
  if (!source.githubProject || !source.projectSnapshot) return { code: 'source-snapshot-unavailable', message: 'Continuous processing requires a completed GitHub Project observation' }
}
/** Read-only canonical facts never acquire a slot, execution ownership or host resources. */
export function observeContinuousTasks(state: WorkSnapshot, rule: ContinuousWorkRule): void {
  for (const item of rule.items) {
    item.sourceId ??= rule.sourceId
    const binding = state.externalBindings.find(binding => binding.nodeId === item.nodeId)
    if (!binding) continue
    item.taskRef = binding.ref
    if (item.ref) continue // Owned work must retain its safe settlement and closeout path.
    const task = state.tasks.find(task => task.projectId === binding.ref.projectId && task.id === binding.ref.taskId)
    if (task?.progress?.stage === 'done' && task.progress.specificationVersion === task.specification.version) {
      item.state = 'completed'; item.reason = task.progress.summary || 'Canonical Task is already accepted'
      delete item.retryAt; delete item.resumeRequested; delete item.explicitResumeRequested; delete item.recoveryBlocked
    }
  }
}

/** Only the published complete Project membership is eligible; archived/draft/PR items never enter. */
export function discoverContinuous(rule: ContinuousWorkRule, source: WorkSource, state?: WorkSnapshot): void {
  const members = new Set(source.repository ? source.repositorySnapshot?.nodeIds : source.projectSnapshot?.items.filter(item => item.kind === 'issue' && !item.archived).map(item => item.issueNodeId))
  const eligible = new Set<string>()
  for (const { issue } of source.observations) {
    if (!members.has(issue.nodeId) || issue.state !== 'open' || !rule.scope.labels.every(label => issue.labels.includes(label))
      || (rule.scope.assignee === '@me' && !issue.assignees.some(login => login.toLowerCase() === rule.scope.identity!.login.toLowerCase()))) continue
    eligible.add(issue.nodeId)
    const item = rule.items.find(item => item.nodeId === issue.nodeId)
    if (item) {
      if (item.ref || ['blocked', 'completed', 'paused'].includes(item.state)) continue
      item.title = issue.title; item.number = issue.number; item.url = issue.url
      if (!item.ref && item.state === 'skipped' && item.reason === 'Issue is outside the current authorized scope') { item.state = 'queued'; delete item.reason }
    } else rule.items.push({ sourceId: source.id, nodeId: issue.nodeId, title: issue.title, number: issue.number, url: issue.url, state: 'queued', attempts: 0 })
  }
  const plan = rule.queue ? undefined : rule.planning?.plans.find(plan => plan.version === rule.planning!.enabledPlanVersion)
  for (const item of rule.items) {
    if (item.ref || ['blocked', 'completed', 'paused'].includes(item.state)) continue // Block never kills accepted work or its safe closeout.
    if (continuousBlocks(rule).includes(item.nodeId)) { item.state = 'blocked'; item.reason = 'Issue is excluded by the persistent Block list'; continue }
    if (rule.planning && !rule.queue) {
      const step = plan?.steps.find(step => step.nodeId === item.nodeId)
      if (!step) { item.state = 'skipped'; item.reason = 'Issue is not in an explicitly enabled model plan' }
      else if (step.mode === 'wait') { item.state = 'waiting'; item.reason = step.nextAction }
      else if (eligible.has(item.nodeId) && ['skipped', 'waiting'].includes(item.state)) { item.state = 'queued'; delete item.reason }
    }
  }
  if (rule.queue) {
    for (const item of rule.items) if (!item.ref && item.state === 'skipped' && item.reason === 'Issue is not in an explicitly enabled model plan' && eligible.has(item.nodeId)) { item.state = 'queued'; delete item.reason }
    const observations = new Map(source.observations.map(row => [row.issue.nodeId, row.issue]))
    const batchKey = rule.queue.filterPrompt?.trim() ? screeningKey(rule, source, state) : undefined
    for (const item of rule.items) {
      if (item.ref || ['blocked', 'completed', 'paused'].includes(item.state) || !eligible.has(item.nodeId)) continue
      if (rule.queue.filterPrompt?.trim()) {
        const decision = item.screening
        if (!decision || decision.key !== batchKey) { item.state = 'waiting'; item.reason = SCREENING_PENDING }
        else { item.state = decision.matches ? 'queued' : 'skipped'; item.reason = decision.reason }
      } else if (item.screening || item.reason === SCREENING_PENDING) {
        item.state = 'queued'; delete item.reason; delete item.screening
      }
    }
    const waiting = rule.items.filter(item => item.state === 'queued').sort((a, b) => {
      const left = observations.get(a.nodeId), right = observations.get(b.nodeId)
      const order = (left?.createdAt ?? '').localeCompare(right?.createdAt ?? '') || a.number - b.number || a.nodeId.localeCompare(b.nodeId)
      return rule.queue!.order === 'newest' ? -order : order
    })
    let index = 0
    rule.items = rule.items.map(item => item.state === 'queued' ? waiting[index++]! : item)
  }
  if (plan) rule.items.sort((a, b) => {
    const rank = (nodeId: string) => { const index = plan.steps.findIndex(step => step.nodeId === nodeId); return index < 0 ? Number.MAX_SAFE_INTEGER : index }
    return rank(a.nodeId) - rank(b.nodeId)
  })
  for (const item of rule.items) if (!item.ref && ['queued', 'waiting', 'skipped'].includes(item.state) && !eligible.has(item.nodeId)) {
    item.state = 'skipped'; item.reason = 'Issue is outside the current authorized scope'
  }
}
/** Resumable accepted work competes with new waiting work under the same ordering and capacity. */
export function continuousCandidates(rule: ContinuousWorkRule, source: WorkSource | undefined, state?: WorkSnapshot): ContinuousWorkRule['items'] {
  const batchKey = rule.queue?.filterPrompt?.trim() && source ? screeningKey(rule, source, state) : undefined
  const candidates = rule.items.filter(item => (!rule.queue || rule.enabled || item.explicitResumeRequested) && (item.state === 'queued' || item.ref && item.executionId && item.resumeRequested && item.state !== 'completed')).filter(item => {
    if (item.ref || !rule.queue?.filterPrompt?.trim()) return true
    return !!batchKey && item.screening?.matches === true && item.screening.key === batchKey
  })
  if (!rule.queue) return candidates.sort((a, b) => Number(!!b.resumeRequested) - Number(!!a.resumeRequested))
  const observations = new Map(source?.observations.map(row => [row.issue.nodeId, row.issue]))
  return candidates.sort((a, b) => {
    const left = observations.get(a.nodeId), right = observations.get(b.nodeId)
    const order = (left?.createdAt ?? '').localeCompare(right?.createdAt ?? '') || a.number - b.number || a.nodeId.localeCompare(b.nodeId)
    return rule.queue!.order === 'newest' ? -order : order
  })
}
export function continuousDependenciesReady(state: WorkSnapshot, rule: ContinuousWorkRule, nodeId: string): boolean {
  const source = state.sources.find(source => source.id === rule.sourceId)
  const issue = source?.observations.find(item => item.issue.nodeId === nodeId)?.issue
  const done = (ref: TaskRef) => {
    const task = state.tasks.find(task => task.id === ref.taskId && task.projectId === ref.projectId)
    return task?.progress?.stage === 'done' && task.progress.specificationVersion === task.specification.version
  }
  const binding = state.externalBindings.find(binding => binding.nodeId === nodeId)
  const task = binding && state.tasks.find(task => task.id === binding.ref.taskId && task.projectId === binding.ref.projectId)
  // A list observation is not proof of an empty relationship set. Both native
  // reads must be complete, including the total count and unique identities.
  const complete = (relation: NonNullable<typeof issue>['subIssues']) => !!relation && !relation.hasNextPage && relation.totalCount === relation.items.length && new Set(relation.items.map(item => item.nodeId)).size === relation.items.length
  if (!issue || issue.parent === undefined || !complete(issue.subIssues) || issue.dependencies?.availability !== 'available' || !complete(issue.dependencies.blockedBy)) return false
  const accepted = (relative: { nodeId: string; state: 'open' | 'closed' }) => {
    const canonical = state.externalBindings.find(binding => binding.nodeId === relative.nodeId)
    // Once imported, even a closed Issue must pass its canonical Task acceptance.
    return canonical ? done(canonical.ref) : relative.state === 'closed'
  }
  // An accepted native child scope cannot disappear when discovery shrinks.
  const nativeChildren = new Map([...(binding?.acceptedChildren?.items ?? binding?.accepted.subIssues?.items ?? []), ...issue.subIssues!.items,
    ...source!.observations.filter(row => row.issue.parent?.nodeId === nodeId).map(row => row.issue)].map(child => [child.nodeId, child]))
  const canonicalChildren = (task?.children ?? []).filter(ref => state.externalBindings.some(binding => sameTask(binding.ref, ref)))
  return [...nativeChildren.values()].every(accepted) && issue.dependencies.blockedBy.items.every(accepted) && canonicalChildren.every(done)
}

export const MAX_CONTINUOUS_ATTEMPTS = 3
export function continuousRetry(item: ContinuousWorkRule['items'][number], message: string): void {
  item.attempts++
  item.reason = message
  item.retryAt = new Date(Date.now() + Math.min(60_000, 1000 * 2 ** item.attempts)).toISOString()
  if (item.attempts >= MAX_CONTINUOUS_ATTEMPTS) { if (item.state !== 'completed') item.state = 'blocked'; delete item.retryAt }
}
