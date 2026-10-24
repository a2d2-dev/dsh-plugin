import type { GitHubIssue, GitHubProjectItem } from '../work-sources/types.ts'

/** One rendered Project table cell; parts keep real GitHub targets clickable inside the cell text. */
export interface ProjectFieldCell { text: string; parts?: { label: string; url?: string }[] }
export const UNKNOWN_FIELD_VALUE = '（未观察到字段值）'
const customTypes = new Set(['MILESTONE','SINGLE_SELECT','STATUS','ITERATION','TEXT','NUMBER','DATE'])
/** Query keys retain full dates and literal text; partial/restricted observations stay unknown. */
export function projectFieldValues(field: { id: string; dataType: string }, issue: GitHubIssue | undefined, item: GitHubProjectItem): string[] {
  const stored=item.fields.find(entry=>entry.id===field.id)
  if(customTypes.has(field.dataType))return stored?[stored.value]:item.fieldsPartial?[UNKNOWN_FIELD_VALUE]:[]
  if(item.kind==='restricted')return [UNKNOWN_FIELD_VALUE]
  const facts=item.facts
  const one=(value:string|null|undefined)=>value?[value]:[]
  switch(field.dataType){
    case 'TITLE':return one(issue?.title??item.title)
    case 'ASSIGNEES':return issue?.assignees??facts?.assignees??[UNKNOWN_FIELD_VALUE]
    case 'LABELS':return issue?.labels??facts?.labels??[UNKNOWN_FIELD_VALUE]
    case 'REVIEWERS':return facts?.reviewers??[UNKNOWN_FIELD_VALUE]
    case 'REPOSITORY':{const repo=issue?.repository??facts?.repository;return repo?[`${repo.owner}/${repo.repository}`]:[UNKNOWN_FIELD_VALUE]}
    case 'CREATED':{const value=issue?.createdAt??facts?.createdAt;return value===undefined?[UNKNOWN_FIELD_VALUE]:one(value)}
    case 'UPDATED':{const value=issue?.updatedAt??facts?.updatedAt;return value===undefined?[UNKNOWN_FIELD_VALUE]:one(value)}
    case 'CLOSED':{const value=issue?.closedAt!==undefined?issue.closedAt:facts?.closedAt;return value===undefined?[UNKNOWN_FIELD_VALUE]:one(value)}
    case 'PARENT_ISSUE':return issue?issue.parent?[`${issue.parent.repository.owner}/${issue.parent.repository.repository} #${issue.parent.number} ${issue.parent.title}`]:[]:[UNKNOWN_FIELD_VALUE]
    case 'LINKED_PULL_REQUESTS':return issue?.linkedPullRequests?issue.linkedPullRequests.map(pr=>pr.url):[UNKNOWN_FIELD_VALUE]
    case 'SUB_ISSUES_PROGRESS':{const total=issue?.subIssuesSummary?.total??issue?.subIssues?.totalCount;if(total===undefined)return [UNKNOWN_FIELD_VALUE];if(!total)return [];const complete=issue?.subIssuesSummary?.completed??issue?.subIssues?.items.filter(child=>child.state==='closed').length??0;return [`${complete}/${total}`]}
    default:return [UNKNOWN_FIELD_VALUE]
  }
}
const date = (value?: string | null) => value ? value.slice(5, 10) : undefined

/**
 * Project a GitHub Project field value for one item.
 *
 * Built-in fields (assignees, labels, parent, sub-issue progress, reviewers,
 * dates, linked pull requests) are not Project field values: GitHub derives
 * them from the item content, so they come from the observed Issue or the
 * item facts. Only genuinely unsupported field types stay explicitly unread.
 */
export function projectFieldCell(field: { id: string; name: string; dataType: string }, issue: GitHubIssue | undefined, item: GitHubProjectItem): ProjectFieldCell {
  const value = item.fields.find(entry => entry.id === field.id)?.value
  const fallback = item.facts
  switch (field.dataType) {
    case 'TITLE': return { text: issue?.title ?? item.title ?? '—' }
    case 'ASSIGNEES': return { text: (issue?.assignees ?? fallback?.assignees)?.join(', ') || '—' }
    case 'LABELS': return { text: (issue?.labels ?? fallback?.labels)?.join(', ') || '—' }
    case 'REPOSITORY': {
      const repository = issue?.repository ?? fallback?.repository
      return { text: repository ? `${repository.owner}/${repository.repository}` : '—' }
    }
    case 'PARENT_ISSUE': {
      const parent = issue?.parent
      return parent ? { text: `#${parent.number} ${parent.title}`, parts: [{ label: `#${parent.number}`, url: parent.url }, { label: ` ${parent.title}` }] } : { text: '—' }
    }
    case 'SUB_ISSUES_PROGRESS': {
      const summary = issue?.subIssuesSummary, children = issue?.subIssues
      const total = summary?.total ?? children?.totalCount
      if (total === undefined || total === 0) return { text: '—' }
      const completed = summary?.completed ?? children?.items.filter(child => child.state === 'closed').length ?? 0
      const partial = summary === undefined && children?.hasNextPage === true
      return { text: `${completed}/${total} · ${Math.floor((completed / total) * 100)}%${partial ? ' · 部分观察' : ''}` }
    }
    case 'LINKED_PULL_REQUESTS': {
      const pulls = issue?.linkedPullRequests ?? []
      if (!pulls.length) return { text: '—' }
      return { text: pulls.map(pull => `#${pull.number}${pull.draft ? '（草稿）' : ''}`).join(', '),
        parts: pulls.flatMap((pull, index) => [...(index === 0 ? [] : [{ label: ', ' }]), { label: `#${pull.number}${pull.draft ? '（草稿）' : ''}`, url: pull.url }]) }
    }
    case 'REVIEWERS': return { text: fallback?.reviewers?.join(', ') || '—' }
    case 'CREATED': return { text: date(issue?.createdAt ?? fallback?.createdAt) ?? '—' }
    case 'UPDATED': return { text: date(issue?.updatedAt ?? fallback?.updatedAt) ?? '—' }
    case 'CLOSED': return { text: date(issue?.closedAt ?? fallback?.closedAt) ?? '—' }
    case 'MILESTONE':
    case 'STATUS':
    case 'SINGLE_SELECT':
    case 'ITERATION':
    case 'TEXT':
    case 'NUMBER':
    case 'DATE': return { text: value ?? '—' }
    default: return { text: '未读取此类字段值' }
  }
}
