import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { SourceError } from './errors.ts'
import { githubProjectSchema, repositorySchema } from './schema.ts'
import type { GitHubPullRequest, GitHubProjectRef, GitHubRepository, SourceCatalog } from './types.ts'

export type CatalogGraphQL = (query: string, variables: Record<string, string | number>) => Promise<unknown>
const exec = promisify(execFile)
const read: CatalogGraphQL = async (query, variables) => {
  const args = ['api', '--hostname', 'github.com', 'graphql', '-f', `query=${query}`]
  for (const [name, value] of Object.entries(variables)) args.push(typeof value === 'number' ? '-F' : '-f', `${name}=${value}`)
  try { return JSON.parse((await exec('gh', args, { timeout: 20_000, maxBuffer: 8_000_000, env: process.env })).stdout) as unknown }
  catch (error) {
    const caught=error as {stderr?:string;stdout?:string}
    if(caught.stdout){try{const body=JSON.parse(caught.stdout) as {errors?:unknown[]};if(body.errors?.length)return body}catch{}}
    const stderr = caught.stderr ?? ''
    if (/403|FORBIDDEN/.test(stderr)) throw new SourceError('github-forbidden', 'GitHub 目录读取权限不足')
    if (/401|auth login|GH_TOKEN/i.test(stderr)) throw new SourceError('github-unauthorized', 'GitHub 凭据不可用')
    if (/404|NOT_FOUND/.test(stderr)) throw new SourceError('github-not-found', 'GitHub 来源不存在或当前账号不可见')
    if (/rate limit|RATE_LIMITED/i.test(stderr)) throw new SourceError('github-rate-limited', 'GitHub 目录读取达到速率限制')
    throw new SourceError('github-unavailable', 'GitHub 目录未能在请求期限内返回')
  }
}
const viewerSchema=z.object({id:z.string(),login:z.string(),name:z.string().nullable()})
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
const issueRef = z.object({ number: z.number().int().positive(), url: z.string().url(), title: z.string() })
const rawPR = z.object({ id: z.string(), number: z.number().int().positive(), title: z.string(), url: z.string().url(), state: z.enum(['OPEN','CLOSED','MERGED']), isDraft: z.boolean(), updatedAt: z.iso.datetime(), repository: z.object({ name: z.string(), owner: z.object({ login: z.string() }) }),
  closingIssuesReferences: z.object({ nodes: z.array(issueRef), pageInfo: z.object({ hasNextPage: z.boolean() }) }), reviewDecision: z.string().nullable(), commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({ state: z.string() }).nullable() }) })) }) })
const prFields = `id number title url state isDraft updatedAt repository { name owner { login } }
  closingIssuesReferences(first:100) { nodes { number url title } pageInfo { hasNextPage } }
  reviewDecision commits(last:1) { nodes { commit { statusCheckRollup { state } } } }`
function pr(value: z.infer<typeof rawPR>, membership: GitHubPullRequest['membership']): GitHubPullRequest {
  const repository = { owner: value.repository.owner.login, repository: value.repository.name }
  if (!repositorySchema.safeParse(repository).success || value.url.toLowerCase() !== `https://github.com/${repository.owner}/${repository.repository}/pull/${value.number}`.toLowerCase() || value.closingIssuesReferences.nodes.some(issue => !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*$/.test(issue.url))) throw new SourceError('github-invalid-response', 'GitHub PR 身份不一致')
  return { nodeId: value.id, number: value.number, title: value.title, url: value.url, repository, state: value.state.toLowerCase() as GitHubPullRequest['state'], draft: value.isDraft, updatedAt: value.updatedAt, issues: value.closingIssuesReferences.nodes, issuesComplete: !value.closingIssuesReferences.pageInfo.hasNextPage, checks: value.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null, review: value.reviewDecision, membership }
}
async function request(query: string, variables: Record<string,string|number>, reader: CatalogGraphQL): Promise<unknown> {
  const raw = await reader(query, variables)
  const errors = z.object({ errors: z.array(z.object({ type: z.string().optional() }).passthrough()).optional() }).safeParse(raw)
  if (errors.success && errors.data.errors?.length) {
    const type = errors.data.errors[0]?.type
    throw new SourceError(type === 'FORBIDDEN' ? 'github-forbidden' : type === 'NOT_FOUND' ? 'github-not-found' : type === 'RATE_LIMITED' ? 'github-rate-limited' : 'github-invalid-response', 'GitHub 无法返回完整目录；未将部分响应作为成功')
  }
  return raw
}
function advance(info: z.infer<typeof pageInfo>, previous?: string): string | undefined {
  if (!info.hasNextPage) return undefined
  if (!info.endCursor || info.endCursor === previous) throw new SourceError('github-invalid-response', 'GitHub 目录分页未向前推进')
  return info.endCursor
}
export async function readSourceCatalog(scope: { repository?: GitHubRepository; githubProject?: GitHubProjectRef }, reader: CatalogGraphQL = read): Promise<SourceCatalog> {
  const result: SourceCatalog = { observedAt: new Date().toISOString(), pullRequests: [], pullRequestsComplete: true, views: [], fields: [], viewsComplete: true, limitations: [] }
  const observeViewer=(value:z.infer<typeof viewerSchema>)=>{
    if(result.identity&&result.identity.nodeId!==value.id)throw new SourceError('github-identity-changed','目录分页期间 GitHub 账号发生变化，请重新读取')
    result.identity={nodeId:value.id,login:value.login,name:value.name}
  }
  let repositoryPRCount:number|undefined
  if (scope.repository) {
    if (!repositorySchema.safeParse(scope.repository).success) throw new SourceError('github-invalid-scope', 'Invalid repository')
    const query = `query($owner:String!,$name:String!,$cursor:String) { viewer { id login name } repository(owner:$owner,name:$name) { issues(states:OPEN) { totalCount } pullRequests(first:50,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}) { totalCount pageInfo { hasNextPage endCursor } nodes { ${prFields} } } } }`
    const schema = z.object({ data: z.object({ viewer:viewerSchema, repository: z.object({ issues: z.object({ totalCount: z.number().int().nonnegative() }), pullRequests: z.object({ totalCount: z.number(), pageInfo, nodes: z.array(rawPR) }) }).nullable() }) })
    let cursor: string | undefined
    for (let page = 0; page < 200; page++) {
      const raw = schema.safeParse(await request(query, { owner: scope.repository.owner, name: scope.repository.repository, ...(cursor ? { cursor } : {}) }, reader))
      if (!raw.success || !raw.data.data.repository) throw new SourceError('github-invalid-response', 'GitHub 未返回完整仓库 PR 目录')
      observeViewer(raw.data.data.viewer)
      const repository = raw.data.data.repository
      if(repositoryPRCount!==undefined&&repositoryPRCount!==repository.pullRequests.totalCount)result.pullRequestsComplete=false
      repositoryPRCount=repository.pullRequests.totalCount
      result.openIssueCount = repository.issues.totalCount
      result.pullRequests.push(...repository.pullRequests.nodes.map(value => pr(value, 'repository')))
      cursor = advance(repository.pullRequests.pageInfo, cursor)
      if (!cursor) break
      if (page === 199) { result.pullRequestsComplete = false; result.limitations.push('仓库 PR 超过本次 10000 项观察上限，当前为部分目录') }
    }
  } else {
    const ref = scope.githubProject
    if (!githubProjectSchema.safeParse(ref).success || !ref) throw new SourceError('github-invalid-scope', 'Invalid Project')
    const ownerType = ref.type === 'org' ? 'organization' : 'user'
    const wrap = (body: string, vars = '$cursor:String') => `query($owner:String!,$number:Int!,${vars}) { viewer { id login name } ${ownerType}(login:$owner) { projectV2(number:$number) { ${body} } } }`
    const extract = (raw: unknown): Record<string,unknown> => {
      const parsed = z.object({ data: z.object({viewer:viewerSchema}).passthrough() }).safeParse(raw)
      if(!parsed.success)throw new SourceError('github-invalid-response','GitHub 未返回读取账号')
      observeViewer(parsed.data.data.viewer)
      const owner=z.object({projectV2:z.record(z.string(),z.unknown()).nullable()}).safeParse(parsed.data.data[ownerType])
      const project = owner.success ? owner.data.projectV2 : undefined
      if (!project) throw new SourceError('github-invalid-response', 'GitHub 未返回完整 Project 目录')
      return project
    }
    const variables = { owner: ref.owner, number: ref.number }
    for (const name of ['views','fields'] as const) {
      let cursor: string | undefined
      const body = name === 'views' ? 'nodes { id number name filter layout }' : 'nodes { ... on ProjectV2FieldCommon { id name dataType } }'
      const query = wrap(`${name}(first:100,after:$cursor) { pageInfo { hasNextPage endCursor } ${body} }`)
      for (let page = 0; page < 100; page++) {
        const project = extract(await request(query, { ...variables, ...(cursor ? { cursor } : {}) }, reader))
        const schema = z.object({ pageInfo, nodes: z.array(name === 'views' ? z.object({ id: z.string(), number: z.number(), name: z.string(), filter: z.string(), layout: z.string() }) : z.object({ id: z.string(), name: z.string(), dataType: z.string() })) })
        const connection = schema.safeParse(project[name])
        if (!connection.success) throw new SourceError('github-invalid-response', `GitHub 未返回完整 Project ${name}`)
        if (name === 'views') result.views.push(...connection.data.nodes as SourceCatalog['views'])
        else result.fields.push(...connection.data.nodes as SourceCatalog['fields'])
        cursor = advance(connection.data.pageInfo, cursor)
        if (!cursor) break
        if (page === 99) { result.viewsComplete = false; result.limitations.push(`${name} 超过本次读取上限`) }
      }
    }
    const query = wrap(`items(first:50,after:$cursor) { pageInfo { hasNextPage endCursor } nodes { isArchived content { __typename ... on PullRequest { ${prFields} } ... on Issue { number url title timelineItems(last:50,itemTypes:CROSS_REFERENCED_EVENT) { pageInfo { hasPreviousPage } nodes { ... on CrossReferencedEvent { source { __typename ... on PullRequest { ${prFields} } } } } } } } } }`)
    const rawIssue = z.object({ __typename: z.literal('Issue'), number: z.number(), url: z.string(), title: z.string(), timelineItems: z.object({ pageInfo: z.object({ hasPreviousPage: z.boolean() }), nodes: z.array(z.object({ source: z.object({ __typename: z.string() }).passthrough().optional() })) }) })
    const connectionSchema = z.object({ pageInfo, nodes: z.array(z.object({ isArchived: z.boolean(), content: z.object({ __typename: z.string() }).passthrough().nullable() })) })
    let cursor: string | undefined
    for (let page = 0; page < 200; page++) {
      const project = extract(await request(query, { ...variables, ...(cursor ? { cursor } : {}) }, reader))
      const parsed = connectionSchema.safeParse(project.items)
      if (!parsed.success) throw new SourceError('github-invalid-response', 'GitHub 未返回完整 Project PR 收录')
      for (const item of parsed.data.nodes) {
        if (item.isArchived) continue
        if (!item.content) {result.pullRequestsComplete=false;continue}
        if (item.content.__typename === 'PullRequest') result.pullRequests.push(pr(rawPR.parse(item.content), 'project'))
        if (item.content.__typename === 'Issue') {
          const issue = rawIssue.parse(item.content)
          if (issue.timelineItems.pageInfo.hasPreviousPage) result.pullRequestsComplete = false
          for (const event of issue.timelineItems.nodes) if (event.source?.__typename === 'PullRequest') {
            const value = pr(rawPR.parse(event.source), 'issue-reference')
            if (!value.issues.some(ref => ref.url === issue.url)) value.issues.push({ number: issue.number, url: issue.url, title: issue.title })
            result.pullRequests.push(value)
          }
        }
      }
      cursor = advance(parsed.data.pageInfo, cursor)
      if (!cursor) break
      if (page === 199) result.pullRequestsComplete = false
    }
    if (!result.pullRequestsComplete) result.limitations.push('Project PR 目录含真实收录和每个 Issue 最近 50 条交叉引用；部分历史引用尚未完整观察')
  }
  const unique = new Map<string,GitHubPullRequest>()
  for (const value of result.pullRequests) {
    const previous = unique.get(value.nodeId)
    if (previous) {
      value.issues = [...new Map([...previous.issues,...value.issues].map(issue => [issue.url,issue])).values()]
      if (previous.membership === 'project') value.membership = 'project'
    }
    unique.set(value.nodeId,value)
  }
  if(repositoryPRCount!==undefined&&unique.size!==repositoryPRCount){result.pullRequestsComplete=false;result.limitations.push('PR 分页期间目录计数变化或读取不完整，请刷新核对')}
  result.pullRequests = [...unique.values()].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))
  if (result.pullRequests.some(pr => !pr.issuesComplete)) result.limitations.push('部分 PR 的关闭 Issue 关联超过 100 项，关联列表为部分观察')
  return result
}
