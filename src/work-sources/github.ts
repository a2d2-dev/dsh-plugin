import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { repositorySchema } from './schema.ts'
import type { GitHubIdentity, GitHubIssue, GitHubRepository, GitHubSourcePort, IssuePageRequest, SourceFailure } from './types.ts'
export type * from './types.ts'
const exec = promisify(execFile)
export function validRepository(value: GitHubRepository): boolean { return repositorySchema.safeParse(value).success }
export class SourceError extends Error implements SourceFailure {
  constructor(readonly code: string, message: string, readonly retryAt?: string) { super(message) }
}
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
interface Options { credential?: () => Promise<string>; fetch?: typeof globalThis.fetch; timeoutMs?: number }
/** GET-only GitHub.com port, with generated paths and no redirect following. */
export class GitHubSource implements GitHubSourcePort {
  private readonly token: () => Promise<string>
  private readonly fetcher: typeof globalThis.fetch
  private readonly timeoutMs: number
  constructor(options: Options = {}) { this.token = options.credential ?? credential; this.fetcher = options.fetch ?? globalThis.fetch; this.timeoutMs = options.timeoutMs ?? 15_000 }
  private async get(path: string, token: string): Promise<unknown> {
    if (!(path === '/user' || /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues(?:\/[1-9][0-9]*)?(?:\?.*)?$/.test(path))) throw new SourceError('github-invalid-scope', 'Unsupported GitHub source path')
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
  async list(repository: GitHubRepository, request: IssuePageRequest) {
    if (!validRepository(repository) || !Number.isSafeInteger(request.page) || request.page < 1 || request.page > 100_000 || !Number.isSafeInteger(request.perPage) || request.perPage < 1 || request.perPage > 100 || !['@me', '*'].includes(request.assignee) || !['open', 'closed', 'all'].includes(request.state)) throw new SourceError('github-invalid-scope', 'Invalid source query scope')
    const token = await this.token(), identity = await this.identity(token)
    const parameters = new URLSearchParams({ state: request.state, page: String(request.page), per_page: String(request.perPage), sort: 'updated', direction: 'desc' })
    if (request.assignee === '@me') parameters.set('assignee', identity.login)
    const raw = await this.get(`/repos/${repository.owner}/${repository.repository}/issues?${parameters}`, token)
    if (!Array.isArray(raw)) throw new SourceError('github-invalid-response', 'GitHub returned an invalid Issue page')
    const items = raw.filter(item => !(item && typeof item === 'object' && 'pull_request' in item)).map(item => this.issue(item))
    return { identity, items, ...(raw.length === request.perPage ? { nextPage: request.page + 1 } : {}), observedAt: new Date().toISOString() }
  }
  async detail(repository: GitHubRepository, number: number) {
    if (!validRepository(repository) || !Number.isSafeInteger(number) || number < 1) throw new SourceError('github-invalid-scope', 'Invalid source Issue reference')
    const token = await this.token(), identity = await this.identity(token)
    const raw = await this.get(`/repos/${repository.owner}/${repository.repository}/issues/${number}`, token)
    if (raw && typeof raw === 'object' && 'pull_request' in raw) throw new SourceError('github-not-issue', 'This object is a Pull Request, not an Issue')
    const issue = this.issue(raw)
    if (issue.number !== number) throw new SourceError('github-invalid-response', 'GitHub returned a different Issue')
    return { identity, issue }
  }
}
