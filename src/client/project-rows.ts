import type { GitHubIssue, GitHubProjectItem, SourceCatalog } from '../work-sources/types.ts'
import { projectFieldCell } from './project-fields.ts'

type Field = { id: string; name: string; dataType: string; options?: { id: string; name: string; color: string }[] }
export interface ProjectRow { item: GitHubProjectItem; issue: GitHubIssue | undefined; depth: number }
const issueOf = (items: Map<string, GitHubIssue>) => (item: GitHubProjectItem) => item.issueNodeId ? items.get(item.issueNodeId) : undefined

/**
 * Order Project rows the way the GitHub board renders native sub-issues:
 * a parent row followed by its indented children. Only relations where both
 * ends are visible in this slice become nesting, so a filtered view never
 * invents a hierarchy. Collapsed parents keep their row and hide descendants.
 */
export function orderProjectRows(items: GitHubProjectItem[], issues: GitHubIssue[], collapsed: ReadonlySet<string>): ProjectRow[] {
  const byNode = new Map(issues.map(issue => [issue.nodeId, issue]))
  const visible = new Set(items.map(item => item.issueNodeId).filter((nodeId): nodeId is string => Boolean(nodeId)))
  const children = new Map<string, GitHubProjectItem[]>()
  const roots: GitHubProjectItem[] = []
  for (const item of items) {
    const parent = item.issueNodeId ? byNode.get(item.issueNodeId)?.parent?.nodeId : undefined
    if (parent && visible.has(parent) && parent !== item.issueNodeId) children.set(parent, [...(children.get(parent) ?? []), item])
    else roots.push(item)
  }
  const rows: ProjectRow[] = []
  const place = (item: GitHubProjectItem, depth: number) => {
    const issue = issueOf(byNode)(item)
    rows.push({ item, issue, depth })
    if (item.issueNodeId && collapsed.has(item.issueNodeId)) return
    for (const child of children.get(item.issueNodeId ?? '') ?? []) place(child, depth + 1)
  }
  for (const root of roots) place(root, 0)
  return rows
}

/** The Project field option that renders this value, when the field is a colored single select. */
export function fieldOption(fields: Field[], fieldId: string, value: string): { name: string; color: string } | undefined {
  return fields.find(field => field.id === fieldId)?.options?.find(option => option.name === value)
}

/**
 * Hide a Project column only when every visible row is empty. Unread field
 * types stay visible so an unsupported field is never silently presented as
 * a clean board column.
 */
export function isEmptyColumn(field: Field, rows: ProjectRow[]): boolean {
  if (!rows.length) return false
  return rows.every(row => {
    const cell = projectFieldCell(field, row.issue, row.item)
    return !cell.parts?.length && (cell.text === '—' || cell.text.trim() === '')
  })
}

/** Columns hidden by default because they duplicate the header or only add width. */
const optionalTypes = new Set(['REPOSITORY', 'CREATED', 'UPDATED', 'CLOSED', 'MILESTONE', 'REVIEWERS'])
/** Catalogue columns in GitHub order, without the title column (rendered as the row header). */
export function projectColumns(fields: Field[], rows: ProjectRow[], extras = false): Field[] {
  return fields.filter(field => field.dataType !== 'TITLE' && (extras || !optionalTypes.has(field.dataType)) && !isEmptyColumn(field, rows))
}

/** The local session column shares the Issue and Project tables; it is not a Project field. */
export const SESSION_SLOT = 'session' as const
export type ProjectColumnSlot = Field | typeof SESSION_SLOT

/**
 * Keep GitHub's own field order and place the local session column right after
 * STATUS, so identity fields such as Assignees keep their familiar position and
 * width. Views without a Status column still show the session column first.
 * GitHub's built-in Status field is a single select named "Status"; the STATUS
 * data type is only what fixtures use.
 */
export function projectColumnSlots(columns: Field[]): ProjectColumnSlot[] {
  const status = columns.findIndex(field => field.dataType === 'STATUS' || field.name.trim().toLowerCase() === 'status')
  const at = status < 0 ? 0 : status + 1
  return [...columns.slice(0, at), SESSION_SLOT, ...columns.slice(at)]
}

export type { Field as ProjectField, SourceCatalog }
