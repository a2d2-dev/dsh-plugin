import { z } from 'zod'
import type { ContinuousWorkRule } from './work-types.ts'
import type { GitHubIssue, GitHubProjectItem, WorkSource } from './work-sources/types.ts'

export const screeningOutputSchema = z.object({ decisions: z.array(z.object({ nodeId: z.string().min(1).max(256), matches: z.boolean(), reason: z.string().trim().min(1).max(2000) }).strict()).max(1000) }).strict()
export interface ScreeningBasis {
  instruction: string
  candidates: (Pick<GitHubIssue, 'nodeId' | 'number' | 'title' | 'body' | 'repository' | 'labels' | 'assignees' | 'parent' | 'subIssues' | 'milestone'> & {
    projectItem?: Pick<GitHubProjectItem, 'fields' | 'fieldsPartial'>
  })[]
}
export type ScreeningOutput = z.infer<typeof screeningOutputSchema>
export const SCREENING_PENDING = '等待大模型筛选'

/** The complete mandatory-filter result is one semantic screening batch. */
export function screeningBasis(rule: ContinuousWorkRule, source: WorkSource): ScreeningBasis {
  const projectItems = new Map(source.projectSnapshot?.items.filter(item => item.kind === 'issue' && !item.archived).map(item => [item.issueNodeId, item]))
  const members = new Set(source.repository ? source.repositorySnapshot?.nodeIds : projectItems.keys())
  return { instruction: rule.queue!.filterPrompt!.trim(), candidates: source.observations.filter(({ issue }) =>
    members.has(issue.nodeId) && issue.state === 'open' && rule.scope.labels.every(label => issue.labels.includes(label))
    && (rule.scope.assignee === '*' || issue.assignees.some(login => login.toLowerCase() === rule.scope.identity!.login.toLowerCase()))
    && !rule.planning?.blocks.includes(issue.nodeId)
  ).map(({ issue: { nodeId, number, title, body, repository, labels, assignees, parent, subIssues, milestone } }) => {
    const item = source.githubProject ? projectItems.get(nodeId) : undefined
    return { nodeId, number, title, body, repository, labels, assignees, parent, subIssues, milestone,
      ...(item ? { projectItem: { fields: item.fields, fieldsPartial: item.fieldsPartial } } : {}) }
  }) }
}

/** A change detector for the whole batch; sibling changes can change semantic selection. */
export function screeningKey(rule: ContinuousWorkRule, source: WorkSource): string {
  const input = JSON.stringify([screeningBasis(rule, source), rule.model, rule.scope, source.id, source.version])
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < input.length; index++) {
    const unit = input.charCodeAt(index)
    hash = BigInt.asUintN(64, (hash ^ BigInt(unit & 0xff)) * 0x100000001b3n)
    hash = BigInt.asUintN(64, (hash ^ BigInt(unit >>> 8)) * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
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
