import { screeningReviewRefSchema } from './work-screening-record.ts'
import { planningSchema } from './work-planning.ts'
import { z } from 'zod'
import { completionSchema, childCompletionSchema } from './work-completion/index.ts'
import { taskOrganizationSchema } from './work-organization.ts'
import { taskProgressSchema, taskReportSchema, workStageSchema } from './work-progress.ts'
import { bindingSchema, repositorySchema, sourceSchema } from './work-sources/schema.ts'
import type { NativeWorkMessage } from './work-types.ts'
const id = z.string().uuid()
const text = z.string().min(1).max(100_000).refine(value => value.trim().length > 0, 'Text must not be blank')
const referenceId = z.string().min(1).max(256)
export const taskRefSchema = z.object({ projectId: id, taskId: id }).strict()
export const resourceRefSchema = z.object({ runtimeId: referenceId, workspaceId: referenceId }).strict()
export const sessionRefSchema = z.object({ runtimeId: referenceId, sessionId: referenceId }).strict()
export const legacyAddressSchema = z.object({ runtimeId: referenceId, projectRoot: text, taskId: referenceId }).strict()
export const policySchema = z.object({ version: z.number().int().positive(), modelCandidates: z.array(z.string()), instructions: z.string(), capabilities: z.array(z.string()) }).strict()
export const continuationPolicySchema = z.object({ version: z.number().int().positive(), enabled: z.boolean(), targetTokens: z.number().int().positive(), reserveTokens: z.number().int().min(1024) }).strict()
export const modelSchema = z.object({ provider: referenceId, model: referenceId, reasoningEffort: referenceId.optional() }).strict()
export const executionDefaultsSchema = z.object({ resource: resourceRefSchema.optional(), model: modelSchema.optional(), agentPreset: referenceId.optional(), permissionPreset: referenceId.optional() }).strict()
export const projectSchema = z.object({ id, name: text, version: z.number().int().positive(), defaultAgentId: id, resources: z.array(resourceRefSchema), continuationPolicy: continuationPolicySchema.optional(), executionDefaults: executionDefaultsSchema.optional() }).strict()
export const agentSchema = z.object({ id, projectId: id, role: z.literal('coordinator'), policy: policySchema }).strict()
export const specificationSchema = z.object({ version: z.number().int().positive(), text: z.string().max(1_000_000), acceptance: z.array(text).max(1000), missing: z.array(z.enum(['body', 'acceptance'])).optional() }).strict().refine(value =>
  (value.text.trim().length > 0 || value.missing?.includes('body')) && (value.acceptance.length > 0 || value.missing?.includes('acceptance')), 'Missing source material must be explicit')
const block = z.object({ id: referenceId, title: text, description: text, status: workStageSchema.optional(), evidence: z.array(text).optional(), child: taskRefSchema.optional() }).strict()
export const taskSchema = z.object({
  id, projectId: id, title: text, goal: text, version: z.number().int().positive(), agentId: id,
  progress: taskProgressSchema.optional(),
  completion: completionSchema.optional(), childCompletions: z.array(childCompletionSchema).optional(),
  specification: specificationSchema, specificationHistory: z.array(specificationSchema),
  breakdown: z.array(block), parent: taskRefSchema.optional(), children: z.array(taskRefSchema),
  sessions: z.array(z.object({ session: sessionRefSchema, purpose: z.enum(['related', 'review']) }).strict()),
  activity: z.array(z.object({ commandId: referenceId, type: referenceId, version: z.number().int().positive() }).strict()),
}).strict()
export const continuationContentSchema = z.object({ body: text, decisions: text, evidence: text, unfinished: text, next: text }).strict()
const actualSchema = z.object({ runtimeId: referenceId, cwd: text, agentPreset: referenceId, provider: referenceId, model: referenceId, reasoningEffort: referenceId.optional(), permissionPreset: referenceId, sandbox: referenceId, approval: referenceId }).strict()
const materialSchema = continuationContentSchema.extend({ commandId: referenceId, ref: taskRefSchema, executionId: id, source: sessionRefSchema, epoch: z.number().int().positive(), taskVersion: z.number().int().positive(), specificationVersion: z.number().int().positive(), settlementKey: text.optional() }).strict()
const deliverySchema = z.enum(['accepted', 'delivered', 'consumed'])
const continuationOperationSchema = z.object({
  protocolVersion: z.literal(1).optional(),
  operationId: id, commandId: referenceId, automatic: z.boolean(),
  phase: z.enum(['reserved', 'material-requested', 'material-saved', 'successor-created', 'taken', 'delivered', 'received']),
  source: sessionRefSchema, successor: sessionRefSchema, sourceEpoch: z.number().int().positive(),
  materialRequestId: referenceId, kickoffId: referenceId, profile: actualSchema.optional(), material: materialSchema.optional(),
  goal: text, specification: specificationSchema, title: text,
  history: z.object({ ref: taskRefSchema, session: sessionRefSchema }).strict(),
  collections: z.array(z.object({ session: sessionRefSchema, jobs: z.array(z.object({ id: referenceId, registryEpoch: referenceId.optional(), instanceId: referenceId.optional() }).strict()), requestId: referenceId, delivery: deliverySchema, status: z.enum(['requested', 'collected']) }).strict()).optional(),
  settlements: z.array(z.object({ parent: sessionRefSchema, child: sessionRefSchema, endSeq: z.number().int().nonnegative(), messageId: referenceId, delivery: deliverySchema }).strict()).optional(),
  materialFactsKey: text.optional(),
  goalActivation: z.object({ status: z.enum(['none', 'disarmed']), goalId: referenceId.optional(), revision: z.number().int().positive().optional(), phase: referenceId.optional() }).strict().optional(),
  readable: z.object({ callId: referenceId, materialCommandId: referenceId }).strict().optional(),
  readRequestId: referenceId.optional(),
  inputSeal: z.number().int().nonnegative().optional(),
  requestDelivery: deliverySchema.optional(), kickoffDelivery: deliverySchema.optional(),
  error: z.object({ code: referenceId, message: text }).strict().optional(),
}).strict().refine(operation => operation.phase !== 'received' || operation.protocolVersion === 1, 'Readable confirmation requires the versioned step protocol')
export const workYieldSchema = z.object({ reason: z.enum(['human', 'external', 'executor', 'internal']), checkedFacts: z.array(text).min(1), wakeCondition: text, executor: sessionRefSchema.optional(), jobId: referenceId.optional() }).strict()
export const executionSchema = z.object({
  id, ref: taskRefSchema, agentId: id, owner: id, epoch: z.number().int().positive(), resource: resourceRefSchema,
  session: sessionRefSchema, sessionMode: z.enum(['create', 'reuse']).default('create'), agentPreset: referenceId, model: modelSchema, permissionPreset: referenceId, policy: policySchema,
  state: z.enum(['accepted', 'creating', 'ready', 'running', 'waiting', 'paused', 'failed']),
  history: z.array(z.object({ state: z.enum(['accepted', 'creating', 'ready', 'running', 'waiting', 'paused', 'failed']), commandId: referenceId }).strict()),
  actual: z.object({ runtimeId: referenceId, cwd: text, agentPreset: referenceId, provider: referenceId, model: referenceId, reasoningEffort: referenceId.optional(),
    permissionPreset: referenceId, sandbox: referenceId, approval: referenceId }).strict().optional(),
  events: z.array(z.object({ id: referenceId, text, kind: z.enum(['input', 'result']), delivery: z.enum(['accepted', 'delivered', 'consumed', 'discarded']), acceptance: z.literal('unassessed'), nativeMessage: z.object({ id: referenceId, role: z.literal('user'), content: z.array(z.unknown()), source: z.unknown() }).passthrough().transform(value => value as NativeWorkMessage).optional() }).strict()).default([]),
  runtimeFailure: z.object({ id: referenceId, message: text, userCancelled: z.boolean(), acknowledged: z.boolean().optional() }).strict().optional(),
  continuationMaterial: materialSchema.optional(),
  continuationPolicy: continuationPolicySchema.optional(),
  continuationObservation: z.object({ totalTokens: z.number().nonnegative(), logRevision: z.number().int().nonnegative(), baseline: z.enum(['usage', 'estimated', 'none']), capacity: z.number().int().positive(), outputReserve: z.number().int().positive(), routeKey: text, observedAt: text }).strict().optional(),
  continuationBlocked: z.object({ code: referenceId, message: text }).strict().optional(),
  continuation: continuationOperationSchema.optional(),
  continuationHistory: z.array(continuationOperationSchema).optional(),
  retired: z.array(z.object({ session: sessionRefSchema, epoch: z.number().int().positive(), operationId: id }).strict()).optional(),
  progress: text.optional(),
  executionGuard: z.object({ corrections: z.number().int().nonnegative(), progress: z.array(referenceId), exhausted: z.boolean().optional() }).strict().optional(),
  control: z.object({ commandId: referenceId, action: z.enum(['wait', 'pause', 'resume', 'end']), status: z.enum(['accepted', 'applied']), reason: text.optional(), yield: workYieldSchema.optional() }).strict().optional(),
  error: z.object({ code: referenceId, message: text }).strict().optional(),
}).strict()
const command = { commandId: referenceId }
const content = { title: text, goal: text, specification: text, acceptance: z.array(text).min(1).max(1000) }
const change = { ...command, ref: taskRefSchema, expectedVersion: z.number().int().positive() }
const externalReference = { nodeId: referenceId.optional(), url: z.string().max(2048).regex(/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/issues\/[1-9][0-9]*\/?$/i).optional() }
const oneReference = (value: { nodeId?: string; url?: string }) => Boolean(value.nodeId) !== Boolean(value.url)
const fence = { ...command, ref: taskRefSchema, executionId: id, owner: id, epoch: z.number().int().positive() }
const githubProjectRef = z.object({ owner: referenceId, type: z.enum(['org', 'user']), number: z.number().int().positive() }).strict()
export const continuousQueueSchema = z.object({ concurrency: z.number().int().min(1).max(32), refreshMinutes: z.number().int().min(1).max(10080), order: z.enum(['oldest', 'newest']), filterPrompt: z.string().max(10_000).optional() }).strict()
const legacyContinuousRuleSchema = z.object({
  id, projectId: id, sourceId: id, version: z.number().int().positive(), enabled: z.boolean(),
  scope: z.object({ assignee: z.enum(['@me', '*']), labels: z.array(referenceId), identity: z.object({ login: referenceId, nodeId: referenceId }).strict().optional() }).strict(),
  resource: resourceRefSchema, model: modelSchema, agentPreset: referenceId, permissionPreset: referenceId,
  items: z.array(z.object({ nodeId: referenceId, title: text, number: z.number().int().positive(), url: text, taskRef: taskRefSchema.optional(), sourceId: id.optional(), ref: taskRefSchema.optional(), executionId: id.optional(),
    screening: z.object({ key: referenceId, matches: z.boolean(), reason: text.max(2000) }).strict().optional(),
    end: z.object({ commandId: referenceId, status: z.enum(['accepted', 'applied']) }).strict().optional(), state: z.enum(['queued', 'active', 'waiting', 'paused', 'blocked', 'completed', 'skipped']), reason: text.optional(), attempts: z.number().int().nonnegative(), retryAt: z.string().datetime().optional(), resumeRequested: z.boolean().optional(), explicitResumeRequested: z.boolean().optional(), followups: z.array(referenceId).optional(), recoveryBlocked: z.boolean().optional() }).strict()),
  planning: planningSchema.optional(), blocks: z.array(referenceId).optional(),
  active: taskRefSchema.optional(), error: z.object({ code: referenceId, message: text }).strict().optional(),
}).strict()
export const continuousRuleSchema = legacyContinuousRuleSchema.extend({
  queue: continuousQueueSchema.optional(), slots: z.array(taskRefSchema).optional(),
  screeningError: z.object({ code: referenceId, message: text }).strict().optional(), screeningReview: screeningReviewRefSchema.optional(),
  lastRefreshedAt: z.string().datetime().optional(), nextRefreshAt: z.string().datetime().optional(),
  migrationConflict: z.object({ code: referenceId, message: text }).strict().optional(),
  legacyRules: z.array(legacyContinuousRuleSchema).optional(),
}).strict()
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ ...command, type: z.literal('github.logout'), login: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/), nodeId: referenceId }).strict(),
  z.object({ ...command, type: z.literal('github.login'), action: z.enum(['start', 'cancel']) }).strict(),
  z.object({ ...command, type: z.literal('continuous.instruct'), projectId: id, sourceId: id, expectedVersion: z.number().int().positive(), text }).strict(),
  z.object({ ...command, type: z.literal('continuous.refresh'), projectId: id, sourceId: id, expectedVersion: z.number().int().positive() }).strict(),
  z.object({ ...command, type: z.literal('continuous.preview'), projectId: id, sourceId: id, expectedVersion: z.number().int().positive() }).strict(),
  z.object({ ...command, type: z.literal('continuous.end'), projectId: id, sourceId: id, expectedVersion: z.number().int().positive(), nodeId: referenceId }).strict(),
  z.object({ ...command, type: z.literal('continuous.block'), projectId: id, sourceId: id, expectedVersion: z.number().int().positive(), nodeId: referenceId, blocked: z.boolean() }).strict(),
  z.object({ ...command, type: z.literal('source.connect'), githubProject: githubProjectRef.optional(), url: z.string().max(2048).optional(), resource: resourceRefSchema.optional() }).strict().refine(value => Boolean(value.url) !== Boolean(value.githubProject)),
  z.object({ ...command, type: z.literal('continuous.configure'), queue: continuousQueueSchema.optional(), projectId: id, sourceId: id, expectedVersion: z.number().int().nonnegative(), assignee: z.enum(['@me', '*']), labels: z.array(referenceId).max(100), resource: resourceRefSchema, model: modelSchema, agentPreset: referenceId, permissionPreset: referenceId, enabled: z.boolean(), rememberExecutionDefaults: z.boolean().optional() }).strict(),
  z.object({ ...command, type: z.literal('continuous.set-enabled'), projectId: id, sourceId: id, expectedVersion: z.number().int().positive(), enabled: z.boolean() }).strict(),
  z.object({ ...command, type: z.literal('source.configure-project'), projectId: id, githubProject: z.object({ owner: referenceId, type: z.enum(['org', 'user']), number: z.number().int().positive() }).strict() }).strict(),
  z.object({ ...command, type: z.literal('source.configure'), projectId: id, repository: repositorySchema }).strict(),
  z.object({ ...command, type: z.literal('source.set-enabled'), projectId: id, sourceId: id, expectedVersion: z.number().int().positive(), enabled: z.boolean() }).strict(),
  z.object({ ...command, type: z.literal('source.import'), projectId: id, sourceId: id, ...externalReference }).strict().refine(oneReference),
  z.object({ ...change, type: z.literal('source.link'), sourceId: id, ...externalReference }).strict().refine(oneReference),
  z.object({ ...fence, type: z.literal('task.continue') }).strict(),
  z.object({ ...fence, type: z.literal('task.configure-continuation'), policy: continuationPolicySchema }).strict(),
  z.object({ ...fence, type: z.literal('task.organize'), organization: taskOrganizationSchema }).strict(),
  z.object({ ...fence, type: z.literal('task.report'), report: taskReportSchema }).strict(),
  z.object({ ...fence, type: z.literal('task.continuation-material'), content: continuationContentSchema }).strict(),
  z.object({ ...fence, type: z.literal('task.control'), action: z.enum(['progress', 'wait', 'pause', 'resume', 'end']), text, yield: workYieldSchema.optional() }).strict(),
  z.object({ ...fence, type: z.literal('task.input'), text, kind: z.enum(['input', 'result']) }).strict(),
  z.object({ ...fence, type: z.literal('task.completion-sync') }).strict(),
  z.object({ ...fence, type: z.literal('task.reconcile') }).strict(),
  z.object({ ...command, type: z.literal('project.configure-continuation'), projectId: id, expectedVersion: z.number().int().positive(), policy: continuationPolicySchema }).strict(),
  z.object({ ...command, type: z.literal('project.create'), name: text, resource: resourceRefSchema.optional() }).strict(),
  z.object({ ...command, type: z.literal('project.attach-resource'), projectId: id, expectedVersion: z.number().int().positive(), resource: resourceRefSchema }).strict(),
  z.object({ ...command, ...content, type: z.literal('task.create'), projectId: id }).strict(),
  z.object({ ...change, ...content, type: z.literal('task.create-child') }).strict(),
  z.object({ ...change, type: z.literal('task.update-spec'), goal: text, specification: text, acceptance: content.acceptance }).strict(),
  z.object({ ...change, type: z.literal('task.replace-breakdown'), blocks: z.array(block).max(1000) }).strict(),
  z.object({ ...change, type: z.literal('task.link-child'), child: taskRefSchema, childExpectedVersion: z.number().int().positive() }).strict(),
  z.object({ ...change, type: z.literal('task.associate-session'), session: sessionRefSchema, purpose: z.enum(['related', 'review']) }).strict(),
  z.object({ ...change, type: z.literal('legacy.map'), address: legacyAddressSchema }).strict(),
  z.object({ ...change, type: z.literal('task.start'), agentId: id, resource: resourceRefSchema, session: sessionRefSchema.optional(),
    agentPreset: referenceId, model: modelSchema, permissionPreset: referenceId, rememberExecutionDefaults: z.boolean().optional() }).strict(),
])
export const querySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('github.account') }).strict(),
  z.object({ type: z.literal('github.repositories'), page: z.number().int().min(1).max(10000) }).strict(),
  z.object({ type: z.literal('source.catalog'), projectId: id, sourceId: id, refresh: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('source.identify'), url: z.string().min(1).max(2048) }).strict(),
  z.object({ type: z.literal('source.execution-options'), projectId: id, sourceId: id }).strict(),
  z.object({ type: z.enum(['continuous.status', 'continuous.review']), projectId: id, sourceId: id }).strict(),
  z.object({ type: z.literal('work.capabilities') }).strict(),
  z.object({ type: z.literal('source.list'), projectId: id }).strict(),
  z.object({ type: z.literal('source.progress'), projectId: id, sourceId: id }).strict(),
  z.object({ type: z.literal('source.issues'), projectId: id, sourceId: id, refresh: z.boolean().optional(), page: z.number().int().min(1).max(100_000), perPage: z.number().int().min(1).max(100), assignee: z.enum(['@me', '*']), state: z.enum(['open', 'closed', 'all']), labels: z.array(z.string().min(1).max(256)).max(100).optional(), search: z.string().max(500).optional() }).strict(),
  z.object({ type: z.literal('source.issue'), projectId: id, sourceId: id, refresh: z.boolean().optional(), number: z.number().int().positive(), nodeId: referenceId.optional() }).strict(),
  z.object({ type: z.literal('projects.list') }).strict(),
  z.object({ type: z.literal('resources.list') }).strict(),
  z.object({ type: z.literal('project.detail'), projectId: id }).strict(),
  z.object({ type: z.literal('task.execution-options'), ref: taskRefSchema }).strict(),
  z.object({ type: z.literal('task.execution'), ref: taskRefSchema }).strict(),
  z.object({ type: z.literal('task.history'), ref: taskRefSchema, session: sessionRefSchema, cursor: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200).optional() }).strict(),
  z.object({ type: z.literal('task.detail'), ref: taskRefSchema }).strict(),
  z.object({ type: z.literal('session.candidates'), projectId: id }).strict(),
  z.object({ type: z.literal('session.work'), session: sessionRefSchema }).strict(),
  z.object({ type: z.literal('legacy.resolve'), address: legacyAddressSchema }).strict(),
])
export const receiptSchema = z.object({ continuousRule: continuousRuleSchema.optional(), status: z.literal('completed'), execution: executionSchema.optional(), project: projectSchema.optional(), task: taskSchema.optional(), ref: taskRefSchema.optional(), source: sourceSchema.optional(), binding: bindingSchema.optional(), reminders: z.array(z.string()).optional() }).strict()
const archiveFileSchema = z.string().regex(/^[0-9a-f-]{36}\.json$/)
// z.record deliberately drops __proto__; command IDs are opaque data and must round-trip it.
const receiptIndexSchema = z.custom<Record<string, unknown>>(value => !!value && typeof value === 'object' && !Array.isArray(value))
  .transform(value => Object.entries(value)).pipe(z.array(z.tuple([z.string(), archiveFileSchema])))
  .transform(entries => Object.fromEntries(entries))
export const historyRefSchema = z.object({ head: archiveFileSchema, length: z.number().int().nonnegative(), first: executionSchema.shape.history.element.optional() }).strict()
export const snapshotSchema = z.object({
  schemaVersion: z.literal(3),
  // Deliberately unknown to pre-DAO strict schemas: old writers must reject this format.
  storage: z.object({ version: z.literal(1), receipts: receiptIndexSchema,
    histories: z.record(z.string(), historyRefSchema),
    sources: z.record(z.string(), z.string().regex(/^[0-9a-f-]{36}\.json$/)),
  }).strict().optional(), projects: z.array(projectSchema), agents: z.array(agentSchema), tasks: z.array(taskSchema),
  sources: z.array(sourceSchema).default([]), externalBindings: z.array(bindingSchema).default([]),
  externalIndex: z.record(z.string(), taskRefSchema).default({}),
  executions: z.array(executionSchema).default([]),
  continuousRules: z.array(continuousRuleSchema).optional(),
  commands: z.array(z.object({ commandId: referenceId, fingerprint: z.string(), result: receiptSchema }).strict()),
  legacyMappings: z.array(z.object({ address: legacyAddressSchema, ref: taskRefSchema }).strict()),
}).strict().superRefine((state, ctx) => {
  if (state.storage && state.commands.some(receipt => !Object.hasOwn(state.storage!.receipts, receipt.commandId))) ctx.addIssue({ code: 'custom', message: 'Missing command archive reference' })
  if (state.storage && state.sources.some(source => !Object.hasOwn(state.storage!.sources, source.id))) ctx.addIssue({ code: 'custom', message: 'Missing source archive reference' })
  const ruleSources = new Set<string>(), claimedTasks = new Set<string>()
  for (const rule of state.continuousRules ?? []) {
    if (ruleSources.has(rule.sourceId) || !state.sources.some(source => source.id === rule.sourceId && source.projectId === rule.projectId)) ctx.addIssue({ code: 'custom', message: 'Continuous rule source authority is inconsistent' })
    ruleSources.add(rule.sourceId)
    const slots = rule.slots ?? (rule.active ? [rule.active] : [])
    if (new Set(slots.map(ref => JSON.stringify(ref))).size !== slots.length) ctx.addIssue({ code: 'custom', message: 'Duplicate continuous dispatch slot' })
    const nodes = new Set<string>()
    for (const item of rule.items) {
      if (nodes.has(item.nodeId)) ctx.addIssue({ code: 'custom', message: 'Continuous queue contains a duplicate Issue' })
      nodes.add(item.nodeId)
      if (item.ref) {
        const key = JSON.stringify(item.ref)
        if (claimedTasks.has(key) || !state.executions.some(execution => execution.id === item.executionId && execution.ref.projectId === item.ref!.projectId && execution.ref.taskId === item.ref!.taskId)) ctx.addIssue({ code: 'custom', message: 'Continuous item execution authority is inconsistent' })
        claimedTasks.add(key)
      }
      if (item.state === 'active' && (!item.ref || !slots.some(ref => JSON.stringify(item.ref) === JSON.stringify(ref)))) ctx.addIssue({ code: 'custom', message: 'Active continuous item has no dispatch slot' })
    }
    if (slots.some(ref => !rule.items.some(item => JSON.stringify(item.ref) === JSON.stringify(ref)))) ctx.addIssue({ code: 'custom', message: 'Continuous dispatch slot has no item' })
  }
  const expected = new Map<string, string>()
  for (const binding of state.externalBindings) {
    const ref = JSON.stringify(binding.ref)
    for (const key of [`github:node:${binding.nodeId}`, ...binding.urls.map(url => `github:url:${url.toLowerCase().replace(/\/$/, '')}`)]) {
      if (expected.has(key)) ctx.addIssue({ code: 'custom', message: 'External binding unique index collision' })
      expected.set(key, ref)
      if (JSON.stringify(state.externalIndex[key]) !== ref) ctx.addIssue({ code: 'custom', message: 'External binding index is inconsistent' })
    }
    if (!state.tasks.some(task => task.id === binding.ref.taskId && task.projectId === binding.ref.projectId)) ctx.addIssue({ code: 'custom', message: 'External binding refers to missing work' })
  }
  if (Object.keys(state.externalIndex).length !== expected.size) ctx.addIssue({ code: 'custom', message: 'External binding index has orphan entries' })
})
export type WorkSnapshot = z.infer<typeof snapshotSchema>
