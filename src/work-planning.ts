import { z } from 'zod'
import { issueSchema, sourceSchema } from './work-sources/schema.ts'
import type { WorkSnapshot } from './work-schema.ts'
import type { ContinuousWorkRule } from './work-types.ts'
import { sourceScopeError } from './work-continuous.ts'

const text = z.string().trim().min(1).max(100_000)
export const planStepSchema = z.object({ nodeId: z.string().min(1).max(256), why: text.max(10_000), nextAction: text.max(10_000), mode: z.enum(['new', 'existing', 'wait']) }).strict()
export const planOutputSchema = z.object({ steps: z.array(planStepSchema).max(1000) }).strict()
export const planningBasisSchema = z.object({
  instruction: text, supplements: z.array(text), scopeVersion: z.number().int().positive(), blocks: z.array(z.string()),
  source: sourceSchema,
  candidates: z.array(z.object({ issue: issueSchema, task: z.json().optional(), execution: z.json().optional(), ownerRuleId: z.string().optional() }).strict()),
}).strict()
export const planningSchema = z.object({
  instruction: text, supplements: z.array(text), scopeVersion: z.number().int().positive(), draftVersion: z.number().int().positive(), blocks: z.array(z.string().min(1).max(256)),
  plans: z.array(z.object({ version: z.number().int().positive(), draftVersion: z.number().int().positive(), basis: planningBasisSchema, steps: z.array(planStepSchema), createdAt: z.string().datetime() }).strict()),
  enabledPlanVersion: z.number().int().positive().optional(), error: z.object({ code: z.string(), message: text }).strict().optional(),
}).strict()
export type WorkPlanning = z.infer<typeof planningSchema>
export type PlanningBasis = z.infer<typeof planningBasisSchema>
export type PlanOutput = z.infer<typeof planOutputSchema>
/** Explicit test injection or the real host LLM adapter. No heuristic implementation. */
export interface WorkPlanner { generate(basis: PlanningBasis, model: ContinuousWorkRule['model']): Promise<unknown> }
export class PlanningError extends Error { constructor(readonly code: string, message: string) { super(message) } }

export function planningBasis(state: WorkSnapshot, rule: ContinuousWorkRule): PlanningBasis {
  const source = state.sources.find(source => source.id === rule.sourceId)
  const error = sourceScopeError(rule, source)
  if (error) throw new PlanningError(error.code, error.message)
  if (!rule.planning) throw new PlanningError('planning-instruction-required', 'Save a continuous instruction before requesting a plan')
  const members = new Set(source!.projectSnapshot!.items.filter(item => item.kind === 'issue' && !item.archived).map(item => item.issueNodeId))
  const candidates = source!.observations.filter(({ issue }) => members.has(issue.nodeId)).map(({ issue }) => {
    const binding = state.externalBindings.find(binding => binding.nodeId === issue.nodeId)
    const task = binding && state.tasks.find(task => task.id === binding.ref.taskId && task.projectId === binding.ref.projectId)
    const execution = task && state.executions.find(execution => execution.ref.taskId === task.id && execution.ref.projectId === task.projectId)
    const owner = task && state.continuousRules?.find(rule => rule.items.some(item => item.ref?.taskId === task.id && item.ref.projectId === task.projectId))
    // Only canonical work facts; unrelated Session history never enters a planning request.
    return { issue, ...(task ? { task: JSON.parse(JSON.stringify({ ref: binding!.ref, agentId: task.agentId, goal: task.goal, specification: task.specification, progress: task.progress, children: task.children, parent: task.parent, breakdown: task.breakdown })) } : {}),
      ...(execution ? { execution: JSON.parse(JSON.stringify({ id: execution.id, ref: execution.ref, agentId: execution.agentId, owner: execution.owner, epoch: execution.epoch, resource: execution.resource, model: execution.model, agentPreset: execution.agentPreset, permissionPreset: execution.permissionPreset, session: execution.session, state: execution.state, control: execution.control, error: execution.error })) } : {}), ...(owner ? { ownerRuleId: owner.id } : {}) }
  })
  return planningBasisSchema.parse({ instruction: rule.planning.instruction, supplements: rule.planning.supplements, blocks: rule.planning.blocks, scopeVersion: rule.planning.scopeVersion, source, candidates })
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
  const seen = new Set<string>()
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
    if (step.mode !== 'wait' && (issue.subIssues?.hasNextPage || issue.subIssues?.items.some(child => child.state === 'open' && !seen.has(child.nodeId) && !childDone(child.nodeId)))) throw new PlanningError('planning-child-coverage', `Issue ${step.nodeId} requires complete child coverage before parent advancement`)
    const execution = candidate.execution as { state?: string; control?: { action?: string }; resource?: { runtimeId: string; workspaceId: string } } | undefined
    if (step.mode === 'existing' && (execution?.state === 'paused' || execution?.control?.action === 'pause')) throw new PlanningError('planning-explicit-resume-required', `Issue ${step.nodeId} was explicitly paused; resume it explicitly`)
    const task = candidate.task as { agentId?: string; progress?: { stage?: string } } | undefined
    if (step.mode === 'existing' && (candidate.execution as { agentId?: string } | undefined)?.agentId !== task?.agentId) throw new PlanningError('planning-coordination-invalid', `Issue ${step.nodeId} has no valid responsible Agent coordination`)
    if (step.mode === 'existing' && task?.progress?.stage === 'done') throw new PlanningError('planning-completed-work', `Issue ${step.nodeId} is already locally accepted; observe or wait without restarting`)
  }
  return parsed.data
}
