import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { SourceError } from './errors.ts'
import { githubProjectSchema, projectPageSchema } from './schema.ts'
import type { GitHubIssue, GitHubIssueReference, GitHubProjectField, GitHubProjectPage, GitHubProjectRef, ProjectPageRequest } from './types.ts'

const exec = promisify(execFile)
export type ProjectGraphQL = (query: string, variables: { owner: string; number: number; first: number; cursor?: string }) => Promise<unknown>
const referenceFields = 'id number title url state repository { name owner { login } }'
/** Fixed query text: callers can select scope and a cursor, never supply GraphQL. */
export function projectQuery(type: GitHubProjectRef['type']): string {
  const owner = type === 'org' ? 'organization' : 'user'
  return `query($owner:String!,$number:Int!,$first:Int!,$cursor:String) {
    viewer { id login name }
    ${owner}(login:$owner) { projectV2(number:$number) {
      id title url closed
      items(first:$first,after:$cursor) { totalCount pageInfo { hasNextPage endCursor } nodes {
        id type isArchived
        fieldValues(first:50) { pageInfo { hasNextPage } nodes {
          __typename
          ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { id name } } }
          ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { id name } } }
          ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id name } } }
          ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id name } } }
          ... on ProjectV2ItemFieldMilestoneValue { milestone { title } field { ... on ProjectV2FieldCommon { id name } } }
          ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id name } } }
        } }
        content { __typename
          ... on Issue { ${referenceFields} body updatedAt createdAt closedAt
            assignees(first:100) { nodes { login } }
            labels(first:100) { nodes { name } }
            parent { ${referenceFields} }
            subIssues(first:50) { totalCount pageInfo { hasNextPage } nodes { ${referenceFields} } }
            subIssuesSummary { total completed }
            closedByPullRequestsReferences(first:20) { nodes { number title url state isDraft } }
          }
          ... on PullRequest { title url state isDraft repository { name owner { login } } createdAt updatedAt closedAt assignees(first:100) { nodes { login } } labels(first:100) { nodes { name } }
            reviewRequests(first:20) { nodes { requestedReviewer { __typename ... on User { login } } } }
          }
          ... on DraftIssue { title }
        }
      } }
    } }
  }`
}

function failure(headers: string, stderr = ''): SourceError {
  const status = Number(/HTTP\/[^ ]+\s+(\d+)/i.exec(headers)?.[1] ?? /HTTP (\d+)/i.exec(stderr)?.[1])
  if (status === 401) return new SourceError('github-unauthorized', 'GitHub credentials were rejected (401)')
  if (status === 429 || (status === 403 && /(?:x-ratelimit-remaining:\s*0|retry-after:)/i.test(headers))) {
    const reset = Number(/^x-ratelimit-reset:\s*(\d+)/im.exec(headers)?.[1])
    const delay = Number(/^retry-after:\s*(\d+)/im.exec(headers)?.[1])
    return new SourceError('github-rate-limited', 'GitHub Project read is rate limited', reset > 0 ? new Date(reset * 1000).toISOString() : delay > 0 ? new Date(Date.now() + delay * 1000).toISOString() : undefined)
  }
  if (status === 403) return new SourceError('github-forbidden', 'GitHub Project permission denied (403)')
  if (status === 404) return new SourceError('github-not-found', 'GitHub Project is missing or not visible to this credential')
  if (/auth login|GH_TOKEN|not logged|authentication/i.test(stderr)) return new SourceError('github-credentials-unavailable', 'GitHub credentials are unavailable to this server')
  return new SourceError('github-unavailable', 'GitHub Project could not be read within the request timeout')
}
function response(output: string): { headers: string; body: unknown } {
  const start = output.indexOf('{')
  if (start < 0) throw new SourceError('github-invalid-response', 'GitHub returned an invalid Project response')
  try { return { headers: output.slice(0, start), body: JSON.parse(output.slice(start)) as unknown } }
  catch { throw new SourceError('github-invalid-response', 'GitHub returned an invalid Project response') }
}
/** gh uses only the host's explicit environment; arguments are never shell evaluated. */
const graphql: ProjectGraphQL = async (query, variables) => {
  const args = ['api', '--hostname', 'github.com', 'graphql', '--include', '-f', `query=${query}`, '-f', `owner=${variables.owner}`, '-F', `number=${variables.number}`, '-F', `first=${variables.first}`]
  if (variables.cursor) args.push('-f', `cursor=${variables.cursor}`)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await exec('gh', args, { timeout: 45_000, maxBuffer: 16_000_000, env: process.env })
      return response(result.stdout).body
    } catch (error) {
      if (error instanceof SourceError) throw error
      const caught = error as { stdout?: string; stderr?: string; code?: string }
      const output = caught.stdout ?? ''
      if (/HTTP\/[^ ]+\s+200\b/.test(output)) return response(output).body // GraphQL errors are classified below, never accepted as partial success.
      if (caught.code === 'ENOENT') throw new SourceError('github-credentials-unavailable', 'GitHub CLI is unavailable to this server')
      // Transient read failures (timeout, reset connection) are retried; the
      // discovery checkpoint keeps every page that already merged.
      if (attempt < 3) { await new Promise(resolve => setTimeout(resolve, 1_000 * attempt)); continue }
      throw failure(output.slice(0, output.indexOf('{') < 0 ? output.length : output.indexOf('{')), caught.stderr)
    }
  }
  throw new SourceError('github-unavailable', 'GitHub Project could not be read within the request timeout')
}
const refSchema = z.object({ id: z.string().min(1), number: z.number().int().positive(), title: z.string().min(1), url: z.string(), state: z.enum(['OPEN', 'CLOSED']), repository: z.object({ name: z.string(), owner: z.object({ login: z.string() }) }) })
const linkedPullRequest = z.object({ number: z.number().int().positive(), title: z.string().min(1), url: z.string(), state: z.enum(['OPEN', 'CLOSED', 'MERGED']), isDraft: z.boolean() })
const issue = refSchema.extend({ __typename: z.literal('Issue'), body: z.string().nullable(), updatedAt: z.iso.datetime(), createdAt: z.iso.datetime(), closedAt: z.iso.datetime().nullable(),
  assignees: z.object({ nodes: z.array(z.object({ login: z.string() })) }), labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
  parent: refSchema.nullable(), subIssues: z.object({ totalCount: z.number().int().nonnegative(), pageInfo: z.object({ hasNextPage: z.boolean() }), nodes: z.array(refSchema) }),
  subIssuesSummary: z.object({ total: z.number().int().nonnegative(), completed: z.number().int().nonnegative() }),
  closedByPullRequestsReferences: z.object({ nodes: z.array(linkedPullRequest) }),
})
const content = z.discriminatedUnion('__typename', [issue, z.object({ __typename: z.literal('PullRequest'), title: z.string(), url: z.string(), state: z.enum(['OPEN','CLOSED','MERGED']).optional(), isDraft: z.boolean().optional(), repository: z.object({ name: z.string(), owner: z.object({ login: z.string() }) }).optional(), assignees: z.object({ nodes: z.array(z.object({ login: z.string() })) }).optional(), labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }).optional(),
  createdAt: z.iso.datetime().optional(), updatedAt: z.iso.datetime().optional(), closedAt: z.iso.datetime().nullable().optional(),
  reviewRequests: z.object({ nodes: z.array(z.object({ requestedReviewer: z.object({ login: z.string().optional() }).passthrough().nullable().optional() })) }).optional() }), z.object({ __typename: z.literal('DraftIssue'), title: z.string() })])
const rawField = z.object({ __typename: z.string(), milestone: z.object({ title: z.string() }).nullable().optional(), field: z.object({ id: z.string(), name: z.string() }).optional(), name: z.string().nullable().optional(), title: z.string().nullable().optional(), text: z.string().nullable().optional(), number: z.number().nullable().optional(), date: z.string().nullable().optional() })
const rawProject = z.object({ id: z.string().min(1), title: z.string(), url: z.string(), closed: z.boolean(), items: z.object({
  totalCount: z.number().int().nonnegative().optional(),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  nodes: z.array(z.object({ id: z.string().min(1), type: z.string(), isArchived: z.boolean(), content: content.nullable(), fieldValues: z.object({ pageInfo: z.object({ hasNextPage: z.boolean() }), nodes: z.array(rawField) }) })),
}) })
const envelope = z.object({ errors: z.array(z.object({ type: z.string().optional(), extensions: z.object({ code: z.string().optional() }).passthrough().optional() }).passthrough()).optional(), data: z.object({ viewer: z.object({ id: z.string(), login: z.string(), name: z.string().nullable() }), organization: z.object({ projectV2: rawProject.nullable() }).nullable().optional(), user: z.object({ projectV2: rawProject.nullable() }).nullable().optional() }).nullable().optional() })
function reference(value: z.infer<typeof refSchema>): GitHubIssueReference {
  const repository = { owner: value.repository.owner.login, repository: value.repository.name }
  const url = `https://github.com/${repository.owner.toLowerCase()}/${repository.repository.toLowerCase()}/issues/${value.number}`
  if (value.url.toLowerCase().replace(/\/$/, '') !== url) throw new SourceError('github-invalid-response', 'GitHub returned an inconsistent Issue reference')
  return { nodeId: value.id, number: value.number, title: value.title, url, repository, state: value.state === 'OPEN' ? 'open' : 'closed' }
}
function field(value: z.infer<typeof rawField>): GitHubProjectField[] {
  if (!value.field) return []
  const mapping = {
    ProjectV2ItemFieldSingleSelectValue: ['single-select', value.name], ProjectV2ItemFieldIterationValue: ['iteration', value.title],
    ProjectV2ItemFieldTextValue: ['text', value.text], ProjectV2ItemFieldNumberValue: ['number', value.number], ProjectV2ItemFieldDateValue: ['date', value.date], ProjectV2ItemFieldMilestoneValue: ['text', value.milestone?.title],
  } as const
  const match = mapping[value.__typename as keyof typeof mapping]
  return match && match[1] !== null && match[1] !== undefined ? [{ id: value.field.id, name: value.field.name, type: match[0], value: String(match[1]) }] : []
}
export async function readGitHubProject(project: GitHubProjectRef, request: ProjectPageRequest, read: ProjectGraphQL = graphql): Promise<GitHubProjectPage> {
  if (!githubProjectSchema.safeParse(project).success || !Number.isSafeInteger(request.perPage) || request.perPage < 1 || request.perPage > 100 || (request.cursor !== undefined && (!request.cursor || request.cursor.length > 2048))) throw new SourceError('github-invalid-scope', 'Invalid GitHub Project scope or cursor')
  const raw = await read(projectQuery(project.type), { owner: project.owner, number: project.number, first: request.perPage, ...(request.cursor ? { cursor: request.cursor } : {}) })
  // Classify API errors before validating data: GraphQL may return partial objects.
  const errors = z.object({ errors: z.array(z.object({ type: z.string().optional(), extensions: z.object({ code: z.string().optional() }).passthrough().optional() }).passthrough()).optional() }).safeParse(raw)
  if (errors.success && errors.data.errors?.length) {
    const types = errors.data.errors.map(item => item.type ?? item.extensions?.code)
    if (types.includes('INVALID_CURSOR_ARGUMENTS') || types.includes('INVALID_CURSOR')) throw new SourceError('github-cursor-invalid', 'GitHub Project cursor expired; discovery will restart from the first page')
    if (types.includes('RATE_LIMITED')) throw new SourceError('github-rate-limited', 'GitHub Project read is rate limited')
    if (types.includes('FORBIDDEN')) throw new SourceError('github-forbidden', 'GitHub Project is not visible to this credential')
    if (types.includes('NOT_FOUND')) throw new SourceError('github-not-found', 'GitHub Project is missing or not visible to this credential')
    throw new SourceError('github-invalid-response', 'GitHub could not return a complete Project page')
  }
  const parsed = envelope.safeParse(raw)
  if (!parsed.success || !parsed.data.data) throw new SourceError('github-invalid-response', 'GitHub returned incomplete Project content')
  const data = parsed.data.data, value = (project.type === 'org' ? data.organization : data.user)?.projectV2
  if (!value) throw new SourceError('github-not-found', 'GitHub Project is missing or not visible to this credential')
  const expectedUrl = `https://github.com/${project.type === 'org' ? 'orgs' : 'users'}/${project.owner}/projects/${project.number}`
  if (value.url.toLowerCase() !== expectedUrl.toLowerCase()) throw new SourceError('github-invalid-response', 'GitHub returned a different Project')
  if (value.items.pageInfo.hasNextPage && (!value.items.pageInfo.endCursor || value.items.pageInfo.endCursor === request.cursor)) throw new SourceError('github-invalid-response', 'GitHub Project pagination did not advance')
  const observedAt = new Date().toISOString(), issues: GitHubIssue[] = []
  const items = value.items.nodes.map(item => {
    const shared = { id: item.id, archived: item.isArchived, fields: item.fieldValues.nodes.flatMap(field), fieldsPartial: item.fieldValues.pageInfo.hasNextPage }
    const content = item.content
    if (!content) return { ...shared, kind: 'restricted' as const }
    if (content.__typename === 'Issue') {
      issues.push({ ...reference(content), body: content.body, updatedAt: content.updatedAt, observedAt, createdAt: content.createdAt, closedAt: content.closedAt, assignees: content.assignees.nodes.map(item => item.login), labels: content.labels.nodes.map(item => item.name), parent: content.parent ? reference(content.parent) : null,
        subIssues: { items: content.subIssues.nodes.map(reference), totalCount: content.subIssues.totalCount, hasNextPage: content.subIssues.pageInfo.hasNextPage },
        subIssuesSummary: content.subIssuesSummary,
        linkedPullRequests: content.closedByPullRequestsReferences.nodes.map(pull => ({ number: pull.number, title: pull.title, url: pull.url, state: pull.state.toLowerCase() as 'open' | 'closed' | 'merged', draft: pull.isDraft })) })
      return { ...shared, kind: 'issue' as const, issueNodeId: content.id, title: content.title, url: content.url }
    }
    return content.__typename === 'PullRequest' ? { ...shared, kind: 'pull-request' as const, title: content.title, url: content.url, ...(content.repository && content.state && content.assignees && content.labels ? { facts: { ...(content.isDraft===undefined?{}:{draft:content.isDraft}), repository: { owner: content.repository.owner.login, repository: content.repository.name }, state: content.state.toLowerCase(), assignees: content.assignees.nodes.map(item=>item.login), labels: content.labels.nodes.map(item=>item.name),
      ...(content.createdAt===undefined?{}:{ createdAt: content.createdAt }), ...(content.updatedAt===undefined?{}:{ updatedAt: content.updatedAt }), ...(content.closedAt===undefined?{}:{ closedAt: content.closedAt }),
      ...(content.reviewRequests===undefined?{}:{ reviewers: content.reviewRequests.nodes.flatMap(node => node.requestedReviewer?.login ? [node.requestedReviewer.login] : []) }) } } : {}) } : { ...shared, kind: 'draft' as const, title: content.title }
  })
  const result = projectPageSchema.safeParse({ identity: { nodeId: data.viewer.id, login: data.viewer.login, name: data.viewer.name }, project: { nodeId: value.id, title: value.title, url: value.url, closed: value.closed }, items, issues, observedAt, ...(value.items.totalCount === undefined ? {} : { total: value.items.totalCount }), ...(value.items.pageInfo.hasNextPage ? { nextCursor: value.items.pageInfo.endCursor! } : {}) })
  if (!result.success) throw new SourceError('github-invalid-response', 'GitHub returned invalid Project observations')
  return result.data
}
