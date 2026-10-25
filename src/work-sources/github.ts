import { GitHubLoginFlow } from './login.ts'
import { readSourceCatalog } from './catalog.ts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { repositorySchema } from './schema.ts'
import type { GitHubIdentity, GitHubIssue, GitHubRepository, GitHubSourcePort, IssuePageRequest, GitHubProjectRef, ProjectPageRequest } from './types.ts'
import { SourceError } from './errors.ts'
import { parseSourceURL } from './url.ts'
import { readGitHubProject, type ProjectGraphQL } from './project.ts'
export { SourceError } from './errors.ts'
export type * from './types.ts'
const exec = promisify(execFile)
export function validRepository(value: GitHubRepository): boolean { return repositorySchema.safeParse(value).success }
const identitySchema = z.object({ login: z.string().min(1), node_id: z.string().min(1), name: z.string().nullable().optional() })
const issueSchema = z.object({ node_id: z.string().min(1), number: z.number().int().positive(), title: z.string().min(1), body: z.string().nullable(), html_url: z.string(), state: z.enum(['open', 'closed']), updated_at: z.iso.datetime(), assignees: z.array(z.object({ login: z.string() })), labels: z.array(z.object({ name: z.string() })) })
/** Respect the host's explicit GH/XDG config; never search another account directory. */
async function credential(): Promise<string> {
  try {
    const { stdout } = await exec('gh', ['auth', 'token', '--hostname', 'github.com'], { timeout: 10_000, maxBuffer: 16_384, env: process.env })
    const token = stdout.trim()
    if (!token) throw new Error('missing')
    return token
  } catch { throw new SourceError('github-credentials-unavailable', 'GitHub.com credentials are unavailable to this server') }
}
interface Options { credential?: () => Promise<string>; fetch?: typeof globalThis.fetch; timeoutMs?: number; graphql?: ProjectGraphQL; logout?: (login: string) => Promise<void> }
/** Host GitHub.com adapter: reads plus a fixed canonical Issue close mutation. */
export class GitHubSource implements GitHubSourcePort {
  private loggingOut = false
  private readonly loginFlow = new GitHubLoginFlow()
  private readonly options: Options
  private readonly token: () => Promise<string>
  private readonly fetcher: typeof globalThis.fetch
  private readonly timeoutMs: number
  constructor(options: Options = {}) { this.options = options; this.token = options.credential ?? credential; this.fetcher = options.fetch ?? globalThis.fetch; this.timeoutMs = options.timeoutMs ?? 15_000 }
  login(action: 'start' | 'cancel') { if (this.loggingOut) return { state: 'error' as const, message: '正在退出账号，请稍候。' }; return action === 'start' ? this.loginFlow.start() : this.loginFlow.cancel() }
  dispose() { this.loginFlow.cancel() }
  async account(): Promise<import('./types.ts').GitHubAccount> {
    try { return { status: 'connected', identity: await this.identity(await this.token()), canLogout: this.canLogout(), login: this.loginFlow.status() } }
    catch (error) {
      const disconnected = error instanceof SourceError && ['github-credentials-unavailable', 'github-unauthorized'].includes(error.code)
      return { status: disconnected ? 'disconnected' : 'unavailable', message: disconnected ? '尚未连接 GitHub，或凭据已失效。' : '暂时无法确认 GitHub 账号，请检查网络后重试。', login: this.loginFlow.status() }
    }
  }
  private canLogout(): boolean {
    return !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN && (!this.options.credential || !!this.options.logout)
  }
  async logout(expected: { login: string; nodeId: string }): Promise<import('./types.ts').GitHubAccount> {
    if (!this.canLogout()) throw new SourceError('github-logout-unavailable', '凭据由宿主环境管理，无法从面板退出；请在宿主配置中移除或更换凭据。')
    if (this.loggingOut) throw new SourceError('github-auth-busy', '正在退出账号，请稍候。')
    this.loggingOut = true
    try {
      const identity = await this.identity(await this.token())
      if (identity.login !== expected.login || identity.nodeId !== expected.nodeId) throw new SourceError('github-identity-changed', '账号已变化，请刷新状态后重新确认退出。')
      this.loginFlow.cancel()
      try {
        if (this.options.logout) await this.options.logout(identity.login)
        else await exec('gh', ['auth', 'logout', '--hostname', 'github.com', '--user', identity.login], { timeout: 10_000, maxBuffer: 16_384, env: process.env })
      } catch { throw new SourceError('github-logout-failed', '退出 GitHub 账号失败，请刷新状态后重试。') }
      return await this.account()
    } finally { this.loggingOut = false }
  }
  async repositories(page: number): Promise<import('./types.ts').GitHubRepositoryPage> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new SourceError('github-invalid-scope', 'Invalid repository page')
    const token = await this.token(), identity = await this.identity(token)
    const raw = await this.get(`/user/repos?per_page=50&page=${page}&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member`, token)
    const parsed = z.array(z.object({ node_id: z.string().min(1), name: z.string(), owner: z.object({ login: z.string() }), html_url: z.string(), description: z.string().nullable(), private: z.boolean(), archived: z.boolean() })).safeParse(raw)
    if (!parsed.success) throw new SourceError('github-invalid-response', 'GitHub 未返回完整仓库目录')
    const items = parsed.data.map(value => {
      if (!validRepository({ owner: value.owner.login, repository: value.name }) || value.html_url.toLowerCase() !== `https://github.com/${value.owner.login}/${value.name}`.toLowerCase()) throw new SourceError('github-invalid-response', 'GitHub 返回的仓库身份不一致')
      return { nodeId: value.node_id, owner: value.owner.login, name: value.name, url: value.html_url, description: value.description, private: value.private, archived: value.archived }
    })
    return { identity, items, ...(items.length === 50 ? { nextPage: page + 1 } : {}) }
  }
  catalog(source: { repository?: GitHubRepository; githubProject?: GitHubProjectRef }) { return readSourceCatalog(source) }
  async identify(url: string) {
    const scope = parseSourceURL(url)
    if (scope.kind === 'project') {
      const page = await this.project(scope.githubProject, { perPage: 1 })
      return { ...scope, nodeId: page.project.nodeId, title: page.project.title, url: page.project.url, identity: page.identity }
    }
    const token = await this.token(), identity = await this.identity(token)
    const parsed = z.object({ node_id: z.string().min(1), name: z.string(), full_name: z.string(), html_url: z.string(), owner: z.object({ login: z.string() }) }).safeParse(await this.get(`/repos/${scope.repository.owner}/${scope.repository.repository}`, token))
    if (!parsed.success) throw new SourceError('github-invalid-response', 'GitHub 未返回完整仓库身份')
    const value = parsed.data, repository = { owner: value.owner.login.toLowerCase(), repository: value.name.toLowerCase() }
    if (!validRepository(repository) || value.html_url.toLowerCase() !== `https://github.com/${repository.owner}/${repository.repository}`) throw new SourceError('github-invalid-response', 'GitHub 返回的仓库身份不一致')
    return { ...scope, repository, nodeId: value.node_id, title: value.full_name, url: value.html_url, identity }
  }
  project(project: GitHubProjectRef, request: ProjectPageRequest) { return readGitHubProject(project, request, this.options.graphql) }
  private async get(path: string, token: string): Promise<unknown> {
    if (!(path === '/user' || /^\/user\/repos\?per_page=50&page=[1-9][0-9]{0,4}&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member$/.test(path) || /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/issues(?:\/[1-9][0-9]*(?:\/sub_issues)?)?(?:\?.*)?)?$/.test(path))) throw new SourceError('github-invalid-scope', 'Unsupported GitHub source path')
    try {
      const response = await this.fetcher(`https://api.github.com${path}`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs), headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'dsh-a2d2-issue-source' } })
      if (!response.ok) {
        if (response.status === 401) throw new SourceError('github-unauthorized', 'GitHub credentials were rejected (401)')
        if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
          const reset = Number(response.headers.get('x-ratelimit-reset')), delay = Number(response.headers.get('retry-after'))
          throw new SourceError('github-rate-limited', 'GitHub rate limit exceeded', reset > 0 ? new Date(reset * 1000).toISOString() : delay > 0 ? new Date(Date.now() + delay * 1000).toISOString() : undefined)
        }
        if (response.status === 403) throw new SourceError('github-forbidden', 'GitHub source permission denied (403)')
        if (response.status === 404) throw new SourceError('github-not-found', 'GitHub source is missing or not visible to this credential (404)')
        if (response.status >= 300 && response.status < 400) throw new SourceError('github-source-moved', 'GitHub source moved; configure its canonical repository before refreshing')
        throw new SourceError('github-unavailable', `GitHub source temporarily unavailable (${response.status})`)
      }
      return await response.json()
    } catch (error) {
      if (error instanceof SourceError) throw error
      throw new SourceError('github-offline', 'GitHub source could not be reached within the request timeout')
    }
  }
  private async identity(token: string): Promise<GitHubIdentity> {
    const result = identitySchema.safeParse(await this.get('/user', token))
    if (!result.success) throw new SourceError('github-invalid-response', 'GitHub returned an invalid user identity')
    return { login: result.data.login, nodeId: result.data.node_id, name: result.data.name ?? null }
  }
  private issue(raw: unknown): GitHubIssue {
    const result = issueSchema.safeParse(raw)
    if (!result.success) throw new SourceError('github-invalid-response', 'GitHub returned incomplete Issue content')
    const value = result.data
    const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9][0-9]*)\/?$/i.exec(value.html_url)
    if (!match || Number(match[3]) !== value.number) throw new SourceError('github-invalid-response', 'GitHub returned an out-of-scope Issue URL')
    return { nodeId: value.node_id, url: `https://github.com/${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}/issues/${value.number}`, number: value.number, repository: { owner: match[1]!, repository: match[2]! }, title: value.title, body: value.body, state: value.state, assignees: value.assignees.map(item => item.login), labels: value.labels.map(item => item.name), updatedAt: value.updated_at, observedAt: new Date().toISOString() }
  }
  /** Fixed Issue mutation; no external URL, credential, or repository path is accepted from a browser. */
  async close(input: import('../work-completion/index.ts').CloseTarget, operationId: string): Promise<import('../work-completion/index.ts').CloseReceipt> {
    const { closeTargetSchema } = await import('../work-completion/index.ts')
    const parsed = closeTargetSchema.safeParse(input)
    if (!parsed.success || !operationId.trim()) return { status: 'error', message: 'invalid-close-target' }
    const target = parsed.data
    let token: string
    try {
      token = await this.token()
      const { issue } = await this.detail(target.repository, target.number)
      if (issue.nodeId !== target.nodeId || issue.repository.owner.toLowerCase() !== target.repository.owner.toLowerCase() || issue.repository.repository.toLowerCase() !== target.repository.repository.toLowerCase()) return { status: 'conflict', message: 'canonical-binding-changed' }
      const names = (values: string[]) => JSON.stringify(values.map(value => value.toLowerCase()).sort())
      if (names(issue.assignees) !== names(target.expectedAssignees)) return { status: 'conflict', message: 'remote-assignees-changed' }
      if (issue.state === 'closed') return { status: 'closed' }
      if (issue.updatedAt !== target.expectedUpdatedAt) return { status: 'conflict', message: 'remote-version-changed' }
    } catch { return { status: 'error', message: 'github-close-preflight-unavailable' } }
    try {
      const response = await this.fetcher('https://api.github.com/graphql', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28', 'user-agent': 'dsh-a2d2-completion' },
        body: JSON.stringify({ query: 'mutation CompleteTask($input: CloseIssueInput!) { closeIssue(input: $input) { issue { id closed } clientMutationId } }', variables: { input: { issueId: target.nodeId, clientMutationId: operationId } } }),
      })
      if ([401, 403, 404, 422].includes(response.status)) return { status: 'error', message: `github-close-rejected-${response.status}` }
      if (!response.ok) return { status: 'unknown', message: `github-close-response-${response.status}` }
      const result = z.object({ data: z.object({ closeIssue: z.object({ issue: z.object({ id: z.string(), closed: z.boolean() }), clientMutationId: z.string() }) }) }).safeParse(await response.json())
      if (result.success && result.data.data.closeIssue.issue.id === target.nodeId && result.data.data.closeIssue.issue.closed && result.data.data.closeIssue.clientMutationId === operationId) return { status: 'closed' }
      return { status: 'unknown', message: 'github-close-receipt-unconfirmed' }
    } catch { return { status: 'unknown', message: 'github-close-receipt-lost' } }
  }
  async list(repository: GitHubRepository, request: IssuePageRequest) {
    if (!validRepository(repository) || !Number.isSafeInteger(request.page) || request.page < 1 || request.page > 100_000 || !Number.isSafeInteger(request.perPage) || request.perPage < 1 || request.perPage > 100 || !['@me', '*'].includes(request.assignee) || !['open', 'closed', 'all'].includes(request.state)) throw new SourceError('github-invalid-scope', 'Invalid source query scope')
    const token = await this.token(), identity = await this.identity(token)
    const parameters = new URLSearchParams({ state: request.state, page: String(request.page), per_page: String(request.perPage), sort: 'updated', direction: 'desc' })
    if (request.assignee === '@me') parameters.set('assignee', identity.login)
    if (request.labels?.length) parameters.set('labels', request.labels.join(','))
    if (request.search?.trim()) {
      const matches: GitHubIssue[] = [], search = request.search.trim().toLowerCase()
      parameters.set('per_page', '100')
      for (let page = 1; page <= 200; page++) {
        parameters.set('page', String(page))
        const raw = await this.get(`/repos/${repository.owner}/${repository.repository}/issues?${parameters}`, token)
        if (!Array.isArray(raw)) throw new SourceError('github-invalid-response', 'GitHub returned an invalid Issue page')
        matches.push(...raw.filter(item => !(item && typeof item === 'object' && 'pull_request' in item)).map(item => this.issue(item)).filter(issue => `${issue.title} ${issue.body ?? ''} #${issue.number}`.toLowerCase().includes(search)))
        const end = request.page * request.perPage
        if (matches.length > end || raw.length < 100) return { identity, items: matches.slice(end - request.perPage, end), ...(matches.length > end ? { nextPage: request.page + 1 } : {}), observedAt: new Date().toISOString() }
        if (page === 200) throw new SourceError('github-search-incomplete', '搜索超过本次 20000 条扫描上限，请收窄状态、负责人或标签；未将部分观察冒充完整结果')
      }
    }
    const raw = await this.get(`/repos/${repository.owner}/${repository.repository}/issues?${parameters}`, token)
    if (!Array.isArray(raw) || raw.length > request.perPage) throw new SourceError('github-invalid-response', 'GitHub returned an invalid Issue page')
    const isIssue = (item: unknown) => !(item && typeof item === 'object' && 'pull_request' in item)
    const items = raw.filter(isIssue).map(item => this.issue(item))
    // REST /issues also includes PRs. A full raw page proves neither that an
    // Issue follows nor that this is a terminal page. Probe generated paths,
    // never a remote Link URL, retaining the existing sequential page contract.
    if (raw.length === request.perPage) {
      for (let offset = 1; ; offset++) {
        parameters.set('page', String(request.page + offset))
        const following = await this.get(`/repos/${repository.owner}/${repository.repository}/issues?${parameters}`, token)
        if (!Array.isArray(following) || following.length > request.perPage) throw new SourceError('github-invalid-response', 'GitHub returned an invalid Issue page')
        if (following.some(isIssue)) return { identity, items, nextPage: request.page + 1, observedAt: new Date().toISOString() }
        if (following.length < request.perPage) break
      }
    }
    return { identity, items, observedAt: new Date().toISOString() }
  }
  async detail(repository: GitHubRepository, number: number, options?: { nativeChildren: true }) {
    if (!validRepository(repository) || !Number.isSafeInteger(number) || number < 1) throw new SourceError('github-invalid-scope', 'Invalid source Issue reference')
    const token = await this.token(), identity = await this.identity(token)
    const raw = await this.get(`/repos/${repository.owner}/${repository.repository}/issues/${number}`, token)
    if (raw && typeof raw === 'object' && 'pull_request' in raw) throw new SourceError('github-not-issue', 'This object is a Pull Request, not an Issue')
    const issue = this.issue(raw)
    if (issue.number !== number) throw new SourceError('github-invalid-response', 'GitHub returned a different Issue')
    if (options?.nativeChildren) {
      const items: NonNullable<GitHubIssue['subIssues']>['items'] = []
      const seen = new Set<string>()
      const summary = z.object({ sub_issues_summary: z.object({ total: z.number().int().nonnegative() }) }).safeParse(raw)
      let complete = false
      for (let page = 1; page <= 10; page++) {
        const rows = await this.get(`/repos/${repository.owner}/${repository.repository}/issues/${number}/sub_issues?per_page=100&page=${page}`, token)
        if (!Array.isArray(rows) || rows.length > 100) throw new SourceError('github-invalid-response', 'Invalid native child Issue page')
        for (const row of rows) {
          const child = this.issue(row)
          if (seen.has(child.nodeId) || child.nodeId === issue.nodeId) throw new SourceError('github-native-children-incomplete', 'Native child pagination repeated an identity')
          seen.add(child.nodeId)
          items.push({ nodeId: child.nodeId, url: child.url, number: child.number, title: child.title, repository: child.repository, state: child.state })
        }
        if (rows.length < 100) { complete = true; break }
      }
      const totalCount = summary.success ? summary.data.sub_issues_summary.total : items.length
      issue.subIssues = { items, totalCount, hasNextPage: !complete || totalCount !== items.length }
    }
    return { identity, issue }
  }
}
