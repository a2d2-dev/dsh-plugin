import type { GitHubIssue, GitHubProjectItem } from '../work-sources/types.ts'

/** One rendered Project table cell; parts keep real GitHub targets clickable inside the cell text. */
export interface ProjectFieldCell { text: string; parts?: { label: string; url?: string }[] }
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
    case 'SINGLE_SELECT':
    case 'ITERATION':
    case 'TEXT':
    case 'NUMBER':
    case 'DATE': return { text: value ?? '—' }
    default: return { text: '未读取此类字段值' }
  }
}
