import { z } from 'zod'

/** Audit material only: execution still rechecks current scope and canonical facts. */
export const screeningReviewSchema = z.object({
  version: z.number().int().positive(), key: z.string().min(1), generatedAt: z.string().datetime(),
  ruleVersion: z.number().int().positive(), sourceId: z.string().uuid(), sourceVersion: z.number().int().positive(),
  basis: z.json(), authorization: z.json(),
  decisions: z.array(z.object({ nodeId: z.string().min(1), matches: z.boolean(), reason: z.string().min(1).max(2000) }).strict()),
}).strict()
export type ScreeningReview = z.infer<typeof screeningReviewSchema>
