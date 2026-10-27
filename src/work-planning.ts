import { z } from 'zod'
import { continuousBlocks } from './work-blocks.ts'
import { issueSchema, sourceSchema, repositorySchema, githubProjectSchema } from './work-sources/schema.ts'
import type { WorkSnapshot } from './work-schema.ts'
import type { ContinuousWorkRule } from './work-types.ts'
import { sourceScopeError } from './work-continuous.ts'

const text = z.string().trim().min(1).max(100_000)
export const planStepSchema = z.object({ nodeId: z.string().min(1).max(256), why: text.max(10_000), nextAction: text.max(10_000), mode: z.enum(['new', 'existing', 'wait']) }).strict()
export const planOutputSchema = z.object({ steps: z.array(planStepSchema).max(1000) }).strict()
const identitySchema = z.object({ login: z.string(), nodeId: z.string() }).strict()
const sourceSummarySchema = z.object({
  id: z.string(), projectId: z.string(), provider: z.literal('github'), version: z.number(), enabled: z.boolean(),
  sourceVersion: z.number(), candidateCount: z.number().int().nonnegative(),
  repository: repositorySchema.optional(), githubProject: githubProjectSchema.optional(), nodeId: z.string().optional(), identity: identitySchema.optional(),
  repositorySnapshot: z.object({ sourceVersion: z.number(), identity: identitySchema }).strict().optional(),
  projectSnapshot: z.object({ identity: identitySchema, project: z.object({ nodeId: z.string(), title: z.string().max(300), url: z.string(), closed: z.boolean() }).strict() }).strict().optional(),
}).strict()
const relationSchema = z.object({ nodeId: z.string(), state: z.enum(['open', 'closed']), canonicalAccepted: z.boolean().optional() }).strict()
const dependencySchema = z.discriminatedUnion('availability', [
  z.object({ availability: z.literal('available'), blockedBy: z.object({ items: z.array(relationSchema), totalCount: z.number(), hasNextPage: z.boolean() }).strict() }).strict(),
  z.object({ availability: z.literal('unavailable'), code: z.string(), message: z.string() }).strict(),
])
const candidateIssueSchema = z.object({
  nodeId: z.string().max(256), number: z.number(), title: z.string().max(300), url: z.string().max(2048), repository: repositorySchema, state: z.enum(['open', 'closed']),
  labels: z.array(z.string()), assignees: z.array(z.string()), updatedAt: z.string().optional(),
  parent: relationSchema.nullable().optional(), subIssues: z.object({ items: z.array(relationSchema), totalCount: z.number(), hasNextPage: z.boolean() }).strict().optional(), dependencies: dependencySchema.optional(),
}).strict()
export const planningBasisSchema = z.object({
  instruction: text, supplements: z.array(text), scopeVersion: z.number().int().positive(), blocks: z.array(z.string()),
  scope: z.object({ assignee: z.enum(['@me', '*']), labels: z.array(z.string()), identity: z.object({ login: z.string(), nodeId: z.string() }).optional() }).strict(),
  executionStrategy: z.object({ resource: z.object({ runtimeId: z.string(), workspaceId: z.string() }), model: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }), agentPreset: z.string(), permissionPreset: z.string() }).strict(),
  relationshipAvailability: z.object({ nativeParentChildren: z.enum(['observed-when-present', 'per-candidate']), nativeDependencies: z.enum(['unavailable-in-source-port', 'per-candidate']) }).strict(),
  source: sourceSummarySchema,
  candidates: z.array(z.object({ issue: candidateIssueSchema, task: z.json().optional(), execution: z.json().optional(), ownerRuleId: z.string().optional() }).strict()),
}).strict()
// Existing saved plans remain readable; only freshly constructed requests use the compact schema.
const savedBasisSchema = z.union([planningBasisSchema, planningBasisSchema.extend({ source: sourceSchema, candidates: z.array(z.object({ issue: issueSchema, task: z.json().optional(), execution: z.json().optional(), ownerRuleId: z.string().optional() }).strict()) })])
export const planningSchema = z.object({
  instruction: text, supplements: z.array(text), scopeVersion: z.number().int().positive(), draftVersion: z.number().int().positive(), blocks: z.array(z.string().min(1).max(256)),
  plans: z.array(z.object({ version: z.number().int().positive(), draftVersion: z.number().int().positive(), basis: savedBasisSchema, steps: z.array(planStepSchema), createdAt: z.string().datetime() }).strict()),
  enabledPlanVersion: z.number().int().positive().optional(), error: z.object({ code: z.string(), message: text }).strict().optional(),
}).strict()
export type WorkPlanning = z.infer<typeof planningSchema>
export type PlanningBasis = z.infer<typeof planningBasisSchema>
export type PlanOutput = z.infer<typeof planOutputSchema>
/** Explicit test injection or the real host LLM adapter. No heuristic implementation. */
export interface WorkPlanner {
  generate(basis: PlanningBasis, model: ContinuousWorkRule['model']): Promise<unknown>
  screen?(basis: import('./work-screening.ts').ScreeningBasis, model: ContinuousWorkRule['model']): Promise<unknown>
}
export class PlanningError extends Error { constructor(readonly code: string, message: string) { super(message) } }

/** Summarize only error messages, never stacks, generated blocks or request bodies. */
export function planningModelErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown model error'
  return message.split(/[\r\n]/, 1)[0]!
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted URL]')
    .replace(/\b[A-Za-z0-9_-]*(?:key|token|secret|password|passwd|credentials?)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[redacted credential]')
    .replace(/\bBearer\s+\S+|\b(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]+/gi, '[redacted credential]')
    .replace(/(?:[A-Za-z]:[\\/]|\.{1,2}\/|~\/|\/)[^\s,;"'<>]+/g, '[redacted path]')
    .slice(0, 400).trim() || 'Unknown model error'
}

/** FNV-1a 64-bit over UTF-16LE code units, identical on host and client.
 * This is a non-cryptographic change detector, never an authentication or security hash.
 * Retain it with saved summaries so changes beyond the truncated goal remain observable.
 */
function goalIdentity(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    hash = BigInt.asUintN(64, (hash ^ BigInt(unit & 0xff)) * 0x100000001b3n)
    hash = BigInt.asUintN(64, (hash ^ BigInt(unit >>> 8)) * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function planningBasis(state: WorkSnapshot, rule: ContinuousWorkRule): PlanningBasis {
  const source = state.sources.find(source => source.id === rule.sourceId)
  const error = sourceScopeError(rule, source)
  if (error) throw new PlanningError(error.code, error.message)
  if (!rule.planning) throw new PlanningError('planning-instruction-required', 'Save a continuous instruction before requesting a plan')
  const members = new Set(source!.repository ? source!.repositorySnapshot!.nodeIds : source!.projectSnapshot!.items.filter(item => item.kind === 'issue' && !item.archived).map(item => item.issueNodeId))
  const candidates = source!.observations.filter(({ issue }) => members.has(issue.nodeId)).map(({ issue }) => {
    const binding = state.externalBindings.find(binding => binding.nodeId === issue.nodeId)
    const task = binding && state.tasks.find(task => task.id === binding.ref.taskId && task.projectId === binding.ref.projectId)
    const execution = task && state.executions.find(execution => execution.ref.taskId === task.id && execution.ref.projectId === task.projectId)
    const owner = task && state.continuousRules?.find(rule => rule.items.some(item => item.ref?.taskId === task.id && item.ref.projectId === task.projectId))
    // Explanatory text is bounded independently of canonical identity and safety facts.
    const relation = ({ nodeId, state: issueState }: { nodeId: string; state: 'open' | 'closed' }) => {
      const binding = state.externalBindings.find(binding => binding.nodeId === nodeId)
      const task = binding && state.tasks.find(task => task.id === binding.ref.taskId && task.projectId === binding.ref.projectId)
      return { nodeId, state: issueState, ...(binding ? { canonicalAccepted: task?.progress?.stage === 'done' && task.progress.specificationVersion === task.specification.version } : {}) }
    }
    const goal = task?.goal.slice(0, 2000)
    return { issue: { nodeId: issue.nodeId, number: issue.number, title: issue.title.slice(0, 300), url: `https://github.com/${issue.repository.owner}/${issue.repository.repository}/issues/${issue.number}`, repository: issue.repository, state: issue.state, labels: issue.labels, assignees: issue.assignees, updatedAt: issue.updatedAt,
      ...(issue.parent !== undefined ? { parent: issue.parent && relation(issue.parent) } : {}),
      ...(issue.subIssues ? { subIssues: { ...issue.subIssues, items: issue.subIssues.items.map(relation) } } : {}),
      ...(issue.dependencies ? { dependencies: issue.dependencies.availability === 'available' ? { availability: 'available' as const, blockedBy: { ...issue.dependencies.blockedBy, items: issue.dependencies.blockedBy.items.map(relation) } } : issue.dependencies } : {}) },
      ...(task ? { task: JSON.parse(JSON.stringify({ ref: binding!.ref, agentId: task.agentId, goal,
        goalTruncated: task.goal.length > 2000, goalIdentity: goalIdentity(task.goal),
        specification: { version: task.specification.version }, progress: task.progress && { stage: task.progress.stage, specificationVersion: task.progress.specificationVersion }, children: task.children, parent: task.parent,
         nativeChildren: (binding?.acceptedChildren?.items ?? binding?.accepted.subIssues?.items ?? []).map(relation),
         childAcceptance: task.children.flatMap(ref => { const binding = state.externalBindings.find(binding => binding.ref.projectId === ref.projectId && binding.ref.taskId === ref.taskId); return binding ? [relation({ nodeId: binding.nodeId, state: binding.lastObserved.state })] : [] }) })) } : {}),
      ...(execution ? { execution: JSON.parse(JSON.stringify({ id: execution.id, ref: execution.ref, agentId: execution.agentId, owner: execution.owner, epoch: execution.epoch, resource: execution.resource, model: execution.model, agentPreset: execution.agentPreset, permissionPreset: execution.permissionPreset, session: execution.session, state: execution.state,
        control: execution.control && { action: execution.control.action, status: execution.control.status } })) } : {}), ...(owner ? { ownerRuleId: owner.id } : {}) }
  })
  const identity = (value: { login: string; nodeId: string } | undefined) => value && { login: value.login, nodeId: value.nodeId }
  const summary = { id: source!.id, projectId: source!.projectId, provider: source!.provider, version: source!.version, enabled: source!.enabled,
    sourceVersion: source!.repositorySnapshot?.sourceVersion ?? source!.version, candidateCount: candidates.length,
    repository: source!.repository, githubProject: source!.githubProject, nodeId: source!.nodeId, identity: identity(source!.identity),
    repositorySnapshot: source!.repositorySnapshot && { sourceVersion: source!.repositorySnapshot.sourceVersion, identity: identity(source!.repositorySnapshot.identity) },
    projectSnapshot: source!.projectSnapshot && { identity: identity(source!.projectSnapshot.identity), project: { nodeId: source!.projectSnapshot.project.nodeId, title: source!.projectSnapshot.project.title.slice(0, 300), url: source!.projectSnapshot.project.url, closed: source!.projectSnapshot.project.closed } },
  }
  const basis = planningBasisSchema.parse({ instruction: rule.planning.instruction, supplements: rule.planning.supplements, blocks: continuousBlocks(rule), scopeVersion: rule.planning.scopeVersion, scope: rule.scope, executionStrategy: { resource: rule.resource, model: rule.model, agentPreset: rule.agentPreset, permissionPreset: rule.permissionPreset }, relationshipAvailability: { nativeParentChildren: 'per-candidate', nativeDependencies: 'per-candidate' }, source: summary, candidates })
  const limit = planningBasisCharacterLimit(candidates.length)
  // Check serialized length: JSON escaping can multiply the size of bounded strings.
  // Remove why-related goal text first, then titles, always in stable nodeId order.
  const ordered = [...basis.candidates].sort((a, b) => a.issue.nodeId.localeCompare(b.issue.nodeId))
  let length = JSON.stringify(basis).length
  for (const candidate of ordered) {
    if (length <= limit) break
    const task = candidate.task as { goal?: string; goalTruncated?: boolean } | undefined
    if (task?.goal) { const previous = JSON.stringify(candidate).length; task.goal = ''; task.goalTruncated = true; length += JSON.stringify(candidate).length - previous }
  }
  for (const candidate of ordered) {
    if (length <= limit) break
    const previous = JSON.stringify(candidate).length
    candidate.issue.title = ''
    length += JSON.stringify(candidate).length - previous
  }
  // Never drop candidates, scope or canonical facts to make an unsafe request fit.
  if (length > limit) throw new PlanningError('planning-payload-too-large', `Planning identities and instructions exceed request limit: requestCharacters=${length}, candidates=${candidates.length}, limit=${limit}`)
  return basis
}

/** 64KiB fixed context plus 4KiB per candidate; 46 candidates fit within 256KiB. */
export function planningBasisCharacterLimit(candidateCount: number): number { return 64 * 1024 + 4096 * candidateCount }

/** Compare planning authority, not discovery bookkeeping or live execution progress. */
export function planningBasisFingerprint(basis: z.infer<typeof savedBasisSchema>): string {
  const pick = (value: unknown, keys: string[]) => {
    const record = value as Record<string, unknown> | undefined
    return record && Object.fromEntries(keys.map(key => [key, record[key]]))
  }
  const identity = (value: unknown) => pick(value, ['login', 'nodeId'])
  const source = basis.source
  const stable = {
    instruction: basis.instruction, supplements: basis.supplements, blocks: [...basis.blocks].sort(),
    scopeVersion: basis.scopeVersion, scope: { ...basis.scope, labels: [...basis.scope.labels].sort() }, executionStrategy: basis.executionStrategy,
    source: {
      id: source.id, projectId: source.projectId, provider: source.provider, version: source.version, enabled: source.enabled,
      sourceVersion: 'sourceVersion' in source ? source.sourceVersion : source.repositorySnapshot?.sourceVersion ?? source.version,
      repository: source.repository, githubProject: source.githubProject, nodeId: source.nodeId, identity: identity(source.identity),
      repositorySnapshot: source.repositorySnapshot && { sourceVersion: source.repositorySnapshot.sourceVersion, identity: identity(source.repositorySnapshot.identity) },
      projectSnapshot: source.projectSnapshot && { identity: identity(source.projectSnapshot.identity), project: pick(source.projectSnapshot.project, ['nodeId', 'url', 'closed']) },
    },
    candidates: basis.candidates.map(candidate => {
      const task = candidate.task as { specification?: { version?: number }; goal?: string; goalIdentity?: string } | undefined
      return {
        nodeId: candidate.issue.nodeId, ownerRuleId: candidate.ownerRuleId,
        relationships: pick(candidate.issue, ['parent', 'subIssues', 'dependencies']),
        task: task && { ...pick(task, ['ref', 'agentId', 'children', 'parent']), goalIdentity: task.goalIdentity ?? goalIdentity(task.goal ?? ''), specificationVersion: task.specification?.version },
        execution: pick(candidate.execution, ['id', 'ref', 'agentId', 'owner', 'epoch', 'resource', 'model', 'agentPreset', 'permissionPreset', 'session']),
      }
    }).sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
  }
  // Object insertion order is not an identity change (including JSON-valued canonical facts).
  return JSON.stringify(stable, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
}

export function samePlannedExecution(saved: unknown, current: unknown): boolean {
  const pick = (value: unknown) => {
    const execution = value as Record<string, unknown> | undefined
    return execution && Object.fromEntries(['id', 'ref', 'agentId', 'owner', 'epoch', 'resource', 'model', 'agentPreset', 'permissionPreset', 'session'].map(key => [key, execution[key]]))
  }
  return JSON.stringify(pick(saved)) === JSON.stringify(pick(current))
}

export function validatePlan(output: unknown, basis: PlanningBasis, rule: ContinuousWorkRule): PlanOutput {
  const parsed = planOutputSchema.safeParse(output)
  if (!parsed.success) throw new PlanningError('planning-malformed', 'Model plan must contain only stable nodeId, why, nextAction and new/existing/wait steps')
  const seen = new Set<string>(), scheduled = new Set<string>()
  for (const step of parsed.data.steps) {
    const candidate = basis.candidates.find(candidate => candidate.issue.nodeId === step.nodeId)
    if (!candidate) throw new PlanningError('planning-outside-source', `Issue ${step.nodeId} is outside the complete authorized source snapshot`)
    if (seen.has(step.nodeId)) throw new PlanningError('planning-duplicate-issue', `Issue ${step.nodeId} appears twice`)
    seen.add(step.nodeId)
    if (basis.blocks.includes(step.nodeId)) throw new PlanningError('planning-blocked-issue', `Issue ${step.nodeId} is in the persistent Block list`)
    const issue = candidate.issue
    if (issue.state !== 'open' || !rule.scope.labels.every(label => issue.labels.includes(label)) || (rule.scope.assignee === '@me' && !issue.assignees.some(login => login.toLowerCase() === rule.scope.identity!.login.toLowerCase()))) throw new PlanningError('planning-outside-scope', `Issue ${step.nodeId} is outside the authorized assignee/label/open scope`)
    if (candidate.ownerRuleId && candidate.ownerRuleId !== rule.id && step.mode !== 'wait') throw new PlanningError('planning-other-rule-owner', `Issue ${step.nodeId} is owned by rule ${candidate.ownerRuleId}; observe or wait`)
    if (step.mode === 'new' && candidate.execution || step.mode === 'existing' && !candidate.execution) throw new PlanningError('planning-execution-mismatch', `Issue ${step.nodeId} execution mode disagrees with its canonical Task`)
    const childDone = (nodeId: string) => {
      const child = basis.candidates.find(candidate => candidate.issue.nodeId === nodeId)?.task as { specification?: { version: number }; progress?: { stage: string; specificationVersion: number } } | undefined
      return child?.progress?.stage === 'done' && child.progress.specificationVersion === child.specification?.version
    }
    const relationDone = (relative: z.infer<typeof relationSchema>) => relative.canonicalAccepted ?? (basis.candidates.some(candidate => candidate.issue.nodeId === relative.nodeId && candidate.task) ? childDone(relative.nodeId) : relative.state === 'closed')
    const complete = (set: typeof issue.subIssues) => !!set && !set.hasNextPage && set.totalCount === set.items.length && new Set(set.items.map(item => item.nodeId)).size === set.items.length
    const taskRelations = candidate.task as { nativeChildren?: z.infer<typeof relationSchema>[]; childAcceptance?: z.infer<typeof relationSchema>[] } | undefined
    const nativeChildren = new Map([...(taskRelations?.nativeChildren ?? []), ...(issue.subIssues?.items ?? []), ...basis.candidates.filter(candidate => candidate.issue.parent?.nodeId === issue.nodeId).map(candidate => candidate.issue)].map(child => [child.nodeId, child]))
    if (step.mode !== 'wait' && (issue.parent === undefined || !complete(issue.subIssues) || [...nativeChildren.values()].some(child => !relationDone(child) && !scheduled.has(child.nodeId)) || taskRelations?.childAcceptance?.some(child => child.canonicalAccepted !== true && !scheduled.has(child.nodeId)))) throw new PlanningError('planning-child-coverage', `Issue ${step.nodeId} requires complete child coverage before parent advancement`)
    if (step.mode !== 'wait' && (issue.dependencies?.availability !== 'available' || !complete(issue.dependencies.blockedBy) || issue.dependencies.blockedBy.items.some(blocker => !relationDone(blocker) && !scheduled.has(blocker.nodeId)))) throw new PlanningError('planning-dependency-coverage', `Issue ${step.nodeId} requires complete native blocker acceptance or prior coverage`)
    if (step.mode !== 'wait') scheduled.add(step.nodeId)
    const execution = candidate.execution as { state?: string; control?: { action?: string }; resource?: { runtimeId: string; workspaceId: string } } | undefined
    if (step.mode === 'existing' && (execution?.state === 'paused' || execution?.control?.action === 'pause')) throw new PlanningError('planning-explicit-resume-required', `Issue ${step.nodeId} was explicitly paused; resume it explicitly`)
    const task = candidate.task as { agentId?: string; progress?: { stage?: string } } | undefined
    if (step.mode === 'existing' && (candidate.execution as { agentId?: string } | undefined)?.agentId !== task?.agentId) throw new PlanningError('planning-coordination-invalid', `Issue ${step.nodeId} has no valid responsible Agent coordination`)
    if (step.mode === 'existing' && task?.progress?.stage === 'done') throw new PlanningError('planning-completed-work', `Issue ${step.nodeId} is already locally accepted; observe or wait without restarting`)
  }
  return parsed.data
}
