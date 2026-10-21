import type { WorkSnapshot } from './work-schema.ts'
import type { ContinuousWorkRule, TaskRef, WorkExecution } from './work-types.ts'
import type { WorkSource } from './work-sources/types.ts'

export const sameTask = (a: TaskRef | undefined, b: TaskRef | undefined): boolean => !!a && !!b && a.projectId === b.projectId && a.taskId === b.taskId
export function continuousOwner(state: WorkSnapshot, ref: TaskRef) {
  for (const rule of state.continuousRules ?? []) {
    const item = rule.items.find(item => sameTask(item.ref, ref))
    if (item) return { rule, item }
  }
}
export function continuousCompleted(state: WorkSnapshot, execution: WorkExecution): boolean {
  const owner = continuousOwner(state, execution.ref)
  if (!owner) return false
  const task = state.tasks.find(task => task.id === execution.ref.taskId)
  return owner.item.state === 'completed' || (task?.progress?.stage === 'done' && task.progress.specificationVersion === task.specification.version)
}
/** The native pre-step and per-session maintenance guard use the same durable slot. */
export function continuousMayAdvance(state: WorkSnapshot, execution: WorkExecution): boolean {
  const owner = continuousOwner(state, execution.ref)
  return !owner || (!continuousCompleted(state, execution) && owner.item.state === 'active' && sameTask(owner.rule.active, execution.ref))
}
export function sourceScopeError(rule: ContinuousWorkRule, source: WorkSource | undefined): { code: string; message: string } | undefined {
  if (!source?.enabled) return { code: 'source-disabled', message: 'Source is disabled; existing executions are retained' }
  if (source.lastError) return { code: source.lastError.code, message: source.lastError.message }
  if (rule.scope.assignee === '@me' && (!rule.scope.identity || source.identity?.nodeId !== rule.scope.identity.nodeId || source.identity.login.toLowerCase() !== rule.scope.identity.login.toLowerCase())) return { code: 'github-identity-changed', message: 'GitHub account differs from the account explicitly authorized for this rule; reconfigure the scope' }
  if (!source.githubProject || !source.projectSnapshot) return { code: 'source-snapshot-unavailable', message: 'Continuous processing requires a completed GitHub Project observation' }
}
/** Only the published complete Project membership is eligible; archived/draft/PR items never enter. */
export function discoverContinuous(rule: ContinuousWorkRule, source: WorkSource): void {
  const members = new Set(source.projectSnapshot?.items.filter(item => item.kind === 'issue' && !item.archived).map(item => item.issueNodeId))
  const eligible = new Set<string>()
  for (const { issue } of source.observations) {
    if (!members.has(issue.nodeId) || issue.state !== 'open' || !rule.scope.labels.every(label => issue.labels.includes(label))
      || (rule.scope.assignee === '@me' && !issue.assignees.some(login => login.toLowerCase() === rule.scope.identity!.login.toLowerCase()))) continue
    eligible.add(issue.nodeId)
    const item = rule.items.find(item => item.nodeId === issue.nodeId)
    if (item) {
      item.title = issue.title; item.number = issue.number; item.url = issue.url
      if (!item.ref && item.state === 'skipped' && item.reason === 'Issue is outside the current authorized scope') { item.state = 'queued'; delete item.reason }
    } else rule.items.push({ nodeId: issue.nodeId, title: issue.title, number: issue.number, url: issue.url, state: 'queued', attempts: 0 })
  }
  const plan = rule.planning?.plans.find(plan => plan.version === rule.planning!.enabledPlanVersion)
  for (const item of rule.items) {
    if (item.ref) continue // Block never kills accepted work or its safe closeout.
    if (rule.planning?.blocks.includes(item.nodeId)) { item.state = 'blocked'; item.reason = 'Issue is excluded by the persistent Block list'; continue }
    if (rule.planning) {
      const step = plan?.steps.find(step => step.nodeId === item.nodeId)
      if (!step) { item.state = 'skipped'; item.reason = 'Issue is not in an explicitly enabled model plan' }
      else if (step.mode === 'wait') { item.state = 'waiting'; item.reason = step.nextAction }
      else if (eligible.has(item.nodeId) && ['skipped', 'waiting'].includes(item.state)) { item.state = 'queued'; delete item.reason }
    }
  }
  if (plan) rule.items.sort((a, b) => {
    const rank = (nodeId: string) => { const index = plan.steps.findIndex(step => step.nodeId === nodeId); return index < 0 ? Number.MAX_SAFE_INTEGER : index }
    return rank(a.nodeId) - rank(b.nodeId)
  })
  for (const item of rule.items) if (!item.ref && item.state === 'queued' && !eligible.has(item.nodeId)) {
    item.state = 'skipped'; item.reason = 'Issue is outside the current authorized scope'
  }
}
export function continuousDependenciesReady(state: WorkSnapshot, rule: ContinuousWorkRule, nodeId: string): boolean {
  const source = state.sources.find(source => source.id === rule.sourceId)
  const issue = source?.observations.find(item => item.issue.nodeId === nodeId)?.issue
  const item = rule.items.find(item => item.nodeId === nodeId)
  const done = (ref: TaskRef) => {
    const task = state.tasks.find(task => task.id === ref.taskId && task.projectId === ref.projectId)
    return task?.progress?.stage === 'done' && task.progress.specificationVersion === task.specification.version
  }
  const binding = state.externalBindings.find(binding => binding.nodeId === nodeId)
  const task = binding && state.tasks.find(task => task.id === binding.ref.taskId && task.projectId === binding.ref.projectId)
  const ready = !issue?.subIssues?.hasNextPage && (issue?.subIssues?.items ?? []).every(child => {
    const childBinding = state.externalBindings.find(binding => binding.nodeId === child.nodeId)
    return child.state === 'closed' || !!childBinding && done(childBinding.ref)
  }) && (task?.children ?? []).every(done)
  if (!ready && item) item.reason = `Issue ${nodeId} is waiting for complete child/dependency acceptance`
  return ready
}

export const MAX_CONTINUOUS_ATTEMPTS = 3
export function continuousRetry(item: ContinuousWorkRule['items'][number], message: string): void {
  item.attempts++
  item.reason = message
  item.retryAt = new Date(Date.now() + Math.min(60_000, 1000 * 2 ** item.attempts)).toISOString()
  if (item.attempts >= MAX_CONTINUOUS_ATTEMPTS) { if (item.state !== 'completed') item.state = 'blocked'; delete item.retryAt }
}
