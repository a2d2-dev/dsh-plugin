import { z } from 'zod'
export const repositorySchema = z.object({ owner: z.string().regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/), repository: z.string().regex(/^(?!\.{1,2}$)[a-zA-Z0-9_.-]{1,100}$/) }).strict()
const identity = z.object({ login: z.string(), nodeId: z.string(), name: z.string().nullable() }).strict()
export const issueSchema = z.object({ nodeId: z.string().min(1).max(256), url: z.string().regex(/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/issues\/[1-9][0-9]*$/), number: z.number().int().positive(), title: z.string().min(1).max(100_000), body: z.string().max(1_000_000).nullable(), repository: repositorySchema, assignees: z.array(z.string()), labels: z.array(z.string()), state: z.enum(['open', 'closed']), updatedAt: z.iso.datetime(), observedAt: z.iso.datetime() }).strict()
export const sourceSchema = z.object({ id: z.string().uuid(), projectId: z.string().uuid(), provider: z.literal('github'), repository: repositorySchema,
  enabled: z.boolean(), version: z.number().int().positive(), sequence: z.number().int().nonnegative(), requests: z.record(z.string(), z.number().int().positive()),
  observations: z.array(z.object({ issue: issueSchema, sequence: z.number().int().positive() }).strict()),
  pages: z.array(z.object({ key: z.string(), nodeIds: z.array(z.string()), nextPage: z.number().int().positive().optional(), identity, observedAt: z.iso.datetime() }).strict()),
  identity: identity.optional(), lastError: z.object({ code: z.string(), message: z.string(), retryAt: z.string().optional() }).strict().optional(),
}).strict()
export const bindingSchema = z.object({ provider: z.literal('github'), nodeId: z.string(), urls: z.array(z.string()), ref: z.object({ projectId: z.string().uuid(), taskId: z.string().uuid() }).strict(), sourceIds: z.array(z.string().uuid()), accepted: issueSchema, lastObserved: issueSchema }).strict()
