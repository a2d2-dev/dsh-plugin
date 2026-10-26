import { z } from 'zod'
import type { ContinuousWorkRule } from './work-types.ts'
import type { GitHubIssue, WorkSource } from './work-sources/types.ts'

export const screeningOutputSchema = z.object({ decisions: z.array(z.object({ nodeId: z.string().min(1).max(256), matches: z.boolean(), reason: z.string().trim().min(1).max(2000) }).strict()).max(20) }).strict()
export interface ScreeningBasis {
  instruction: string
  candidates: Pick<GitHubIssue, 'nodeId' | 'number' | 'title' | 'body' | 'repository' | 'labels' | 'assignees' | 'parent' | 'subIssues'>[]
}
export type ScreeningOutput = z.infer<typeof screeningOutputSchema>
export const SCREENING_PENDING = '等待大模型筛选'

/** A content change detector, not an authority token. Observation timestamps do not change it. */
export function screeningKey(rule: ContinuousWorkRule, source: WorkSource, issue: GitHubIssue): string {
  const input = JSON.stringify([rule.queue?.filterPrompt?.trim(), rule.model, rule.scope, source.id, source.version,
    issue.nodeId, issue.title, issue.body, issue.state, issue.updatedAt, issue.labels, issue.assignees, issue.parent, issue.subIssues])
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < input.length; index++) {
    const unit = input.charCodeAt(index)
    hash = BigInt.asUintN(64, (hash ^ BigInt(unit & 0xff)) * 0x100000001b3n)
    hash = BigInt.asUintN(64, (hash ^ BigInt(unit >>> 8)) * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function screeningBasis(rule: ContinuousWorkRule, source: WorkSource): ScreeningBasis {
  return { instruction: rule.queue!.filterPrompt!.trim(), candidates: source.observations.filter(({ issue }) => {
    const item = rule.items.find(item => item.nodeId === issue.nodeId)
    return item && !item.ref && item.state === 'waiting' && item.reason === SCREENING_PENDING
  }).map(({ issue: { nodeId, number, title, body, repository, labels, assignees, parent, subIssues } }) =>
    ({ nodeId, number, title, body, repository, labels, assignees, parent, subIssues })) }
}

export function validateScreening(output: unknown, basis: ScreeningBasis): ScreeningOutput {
  const parsed = screeningOutputSchema.parse(output)
  const expected = new Set(basis.candidates.map(issue => issue.nodeId))
  for (const decision of parsed.decisions) {
    if (!expected.delete(decision.nodeId)) throw new Error('模型筛选返回了重复或范围外的 Issue')
  }
  if (expected.size) throw new Error('模型筛选缺少部分候选的判断，请刷新重试')
  return parsed
}
