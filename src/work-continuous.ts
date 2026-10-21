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
  for (const item of rule.items) if (!item.ref && item.state === 'queued' && !eligible.has(item.nodeId)) {
    item.state = 'skipped'; item.reason = 'Issue is outside the current authorized scope'
  }
}
export const MAX_CONTINUOUS_ATTEMPTS = 3
export function continuousRetry(item: ContinuousWorkRule['items'][number], message: string): void {
  item.attempts++
  item.reason = message
  item.retryAt = new Date(Date.now() + Math.min(60_000, 1000 * 2 ** item.attempts)).toISOString()
  if (item.attempts >= MAX_CONTINUOUS_ATTEMPTS) { if (item.state !== 'completed') item.state = 'blocked'; delete item.retryAt }
}
