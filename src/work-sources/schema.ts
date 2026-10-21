import { z } from 'zod'
const owner = z.string().regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/)
const nodeId = z.string().min(1).max(256)
export const repositorySchema = z.object({ owner, repository: z.string().regex(/^(?!\.{1,2}$)[a-zA-Z0-9_.-]{1,100}$/) }).strict()
export const githubProjectSchema = z.object({ owner, type: z.enum(['org', 'user']), number: z.number().int().positive() }).strict()
const identity = z.object({ login: z.string().min(1), nodeId, name: z.string().nullable() }).strict()
const issueReference = z.object({ nodeId, url: z.string().regex(/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/issues\/[1-9][0-9]*$/), number: z.number().int().positive(), title: z.string().min(1).max(100_000), repository: repositorySchema, state: z.enum(['open', 'closed']) }).strict()
export const issueSchema = issueReference.extend({ body: z.string().max(1_000_000).nullable(), assignees: z.array(z.string()), labels: z.array(z.string()), updatedAt: z.iso.datetime(), observedAt: z.iso.datetime(),
  parent: issueReference.nullable().optional(), subIssues: z.object({ items: z.array(issueReference), totalCount: z.number().int().nonnegative(), hasNextPage: z.boolean() }).strict().optional(),
}).strict()
const projectMetadata = z.object({ nodeId, title: z.string(), url: z.string().regex(/^https:\/\/github\.com\/(?:orgs|users)\/[a-zA-Z0-9-]+\/projects\/[1-9][0-9]*$/), closed: z.boolean() }).strict()
const projectItem = z.object({ id: nodeId, kind: z.enum(['issue', 'pull-request', 'draft', 'restricted']), archived: z.boolean(), issueNodeId: nodeId.optional(), title: z.string().optional(), url: z.string().regex(/^https:\/\/github\.com\//).optional(),
  fields: z.array(z.object({ id: nodeId, name: z.string(), type: z.enum(['single-select', 'iteration', 'text', 'number', 'date']), value: z.string() }).strict()), fieldsPartial: z.boolean(),
}).strict()
export const projectPageSchema = z.object({ identity, project: projectMetadata, items: z.array(projectItem), issues: z.array(issueSchema), observedAt: z.iso.datetime(), nextCursor: z.string().min(1).max(2048).optional() }).strict()
const discovery = z.object({ state: z.enum(['idle', 'syncing', 'error']), nextAttemptAt: z.iso.datetime(), lastAttemptAt: z.iso.datetime().optional(), lastSuccessAt: z.iso.datetime().optional(), failures: z.number().int().nonnegative(),
  inFlight: z.object({ id: z.string().uuid(), expiresAt: z.iso.datetime() }).strict().optional(),
  checkpoint: z.object({ sourceVersion: z.number().int().positive(), startedAt: z.iso.datetime(), cursor: z.string().min(1).max(2048).optional(), pages: z.number().int().nonnegative(), identity: identity.optional(), project: projectMetadata.optional(), items: z.array(projectItem), issues: z.array(issueSchema) }).strict().optional(),
}).strict()
export const sourceSchema = z.object({ id: z.string().uuid(), projectId: z.string().uuid(), provider: z.literal('github'), repository: repositorySchema.optional(), githubProject: githubProjectSchema.optional(),
  enabled: z.boolean(), version: z.number().int().positive(), sequence: z.number().int().nonnegative(), requests: z.record(z.string(), z.number().int().positive()),
  observations: z.array(z.object({ issue: issueSchema, sequence: z.number().int().positive() }).strict()),
  pages: z.array(z.object({ key: z.string(), nodeIds: z.array(z.string()), nextPage: z.number().int().positive().optional(), identity, observedAt: z.iso.datetime() }).strict()),
  identity: identity.optional(), lastError: z.object({ code: z.string(), message: z.string(), retryAt: z.string().optional() }).strict().optional(),
  projectSnapshot: z.object({ identity, project: projectMetadata, items: z.array(projectItem), observedAt: z.iso.datetime() }).strict().optional(), discovery: discovery.optional(),
}).strict().refine(value => Boolean(value.repository) !== Boolean(value.githubProject), 'A source must name exactly one repository or GitHub Project')
export const bindingSchema = z.object({ provider: z.literal('github'), nodeId: z.string(), urls: z.array(z.string()), ref: z.object({ projectId: z.string().uuid(), taskId: z.string().uuid() }).strict(), sourceIds: z.array(z.string().uuid()), accepted: issueSchema, lastObserved: issueSchema }).strict()
