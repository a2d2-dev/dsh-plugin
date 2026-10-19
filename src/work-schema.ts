import { z } from 'zod'
const id = z.string().uuid()
const text = z.string().min(1).max(100_000).refine(value => value.trim().length > 0, 'Text must not be blank')
const referenceId = z.string().min(1).max(256)
export const taskRefSchema = z.object({ projectId: id, taskId: id }).strict()
export const resourceRefSchema = z.object({ runtimeId: referenceId, workspaceId: referenceId }).strict()
export const sessionRefSchema = z.object({ runtimeId: referenceId, sessionId: referenceId }).strict()
export const legacyAddressSchema = z.object({ runtimeId: referenceId, projectRoot: text, taskId: referenceId }).strict()
export const policySchema = z.object({ version: z.number().int().positive(), modelCandidates: z.array(z.string()), instructions: z.string(), capabilities: z.array(z.string()) }).strict()
export const projectSchema = z.object({ id, name: text, version: z.number().int().positive(), defaultAgentId: id, resources: z.array(resourceRefSchema) }).strict()
export const agentSchema = z.object({ id, projectId: id, role: z.literal('coordinator'), policy: policySchema }).strict()
export const specificationSchema = z.object({ version: z.number().int().positive(), text, acceptance: z.array(text).min(1).max(1000) }).strict()
const block = z.object({ id: referenceId, title: text, description: text }).strict()
export const taskSchema = z.object({
  id, projectId: id, title: text, goal: text, version: z.number().int().positive(), agentId: id,
  specification: specificationSchema, specificationHistory: z.array(specificationSchema),
  breakdown: z.array(block), parent: taskRefSchema.optional(), children: z.array(taskRefSchema),
  sessions: z.array(z.object({ session: sessionRefSchema, purpose: z.enum(['related', 'review']) }).strict()),
  activity: z.array(z.object({ commandId: referenceId, type: referenceId, version: z.number().int().positive() }).strict()),
}).strict()
const command = { commandId: referenceId }
const content = { title: text, goal: text, specification: text, acceptance: z.array(text).min(1).max(1000) }
const change = { ...command, ref: taskRefSchema, expectedVersion: z.number().int().positive() }
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ ...command, type: z.literal('project.create'), name: text, resource: resourceRefSchema.optional() }).strict(),
  z.object({ ...command, type: z.literal('project.attach-resource'), projectId: id, expectedVersion: z.number().int().positive(), resource: resourceRefSchema }).strict(),
  z.object({ ...command, ...content, type: z.literal('task.create'), projectId: id }).strict(),
  z.object({ ...change, ...content, type: z.literal('task.create-child') }).strict(),
  z.object({ ...change, type: z.literal('task.update-spec'), goal: text, specification: text, acceptance: content.acceptance }).strict(),
  z.object({ ...change, type: z.literal('task.replace-breakdown'), blocks: z.array(block).max(1000) }).strict(),
  z.object({ ...change, type: z.literal('task.link-child'), child: taskRefSchema, childExpectedVersion: z.number().int().positive() }).strict(),
  z.object({ ...change, type: z.literal('task.associate-session'), session: sessionRefSchema, purpose: z.enum(['related', 'review']) }).strict(),
  z.object({ ...change, type: z.literal('legacy.map'), address: legacyAddressSchema }).strict(),
])
export const querySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('projects.list') }).strict(),
  z.object({ type: z.literal('resources.list') }).strict(),
  z.object({ type: z.literal('project.detail'), projectId: id }).strict(),
  z.object({ type: z.literal('task.detail'), ref: taskRefSchema }).strict(),
  z.object({ type: z.literal('session.candidates'), projectId: id }).strict(),
  z.object({ type: z.literal('session.work'), session: sessionRefSchema }).strict(),
  z.object({ type: z.literal('legacy.resolve'), address: legacyAddressSchema }).strict(),
])
const receiptSchema = z.object({ status: z.literal('completed'), project: projectSchema.optional(), task: taskSchema.optional(), ref: taskRefSchema.optional() }).strict()
export const snapshotSchema = z.object({
  schemaVersion: z.literal(3), projects: z.array(projectSchema), agents: z.array(agentSchema), tasks: z.array(taskSchema),
  commands: z.array(z.object({ commandId: referenceId, fingerprint: z.string(), result: receiptSchema }).strict()),
  legacyMappings: z.array(z.object({ address: legacyAddressSchema, ref: taskRefSchema }).strict()),
}).strict()
export type WorkSnapshot = z.infer<typeof snapshotSchema>
