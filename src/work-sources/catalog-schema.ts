import { z } from 'zod'
const repository = z.object({ owner: z.string(), repository: z.string() }).strict()
export const catalogSchema = z.object({
  identity: z.object({ nodeId:z.string(),login:z.string(),name:z.string().nullable() }).strict().optional(),
  observedAt: z.iso.datetime(), openIssueCount: z.number().int().nonnegative().optional(),
  pullRequests: z.array(z.object({ nodeId: z.string(), number: z.number().int().positive(), title: z.string(), url: z.string(), repository,
    state: z.enum(['open','closed','merged']), draft: z.boolean(), updatedAt: z.iso.datetime(),
    issues: z.array(z.object({ number: z.number().int().positive(), url: z.string(), title: z.string() }).strict()), issuesComplete: z.boolean(), checks: z.string().nullable(), review: z.string().nullable(), membership: z.enum(['repository','project','issue-reference']),
  }).strict()), pullRequestsComplete: z.boolean(),
  views: z.array(z.object({ id: z.string(), number: z.number(), name: z.string(), filter: z.string(), layout: z.string() }).strict()),
  fields: z.array(z.object({ id: z.string(), name: z.string(), dataType: z.string() }).strict()), viewsComplete: z.boolean(), limitations: z.array(z.string()),
}).strict()
