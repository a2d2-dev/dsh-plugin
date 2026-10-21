import { SourceError } from './errors.ts'
import { githubProjectSchema, repositorySchema } from './schema.ts'
import type { GitHubProjectRef, GitHubRepository } from './types.ts'

/** Parse a scope, never a URL to fetch. The adapter constructs all API endpoints. */
export function parseSourceURL(input: string): { kind: 'project'; githubProject: GitHubProjectRef; entryUrl: string } | { kind: 'repository'; repository: GitHubRepository; entryUrl: string } {
  let url: URL
  try { url = new URL(input.trim()) } catch { throw new SourceError('github-invalid-url', '请输入 GitHub.com Project 或仓库的 HTTPS 链接') }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || /%|\\/.test(url.pathname)) throw new SourceError('github-invalid-url', '仅支持可信 GitHub.com HTTPS 来源链接')
  const path = url.pathname.replace(/\/$/, '')
  const project = /^\/(orgs|users)\/([^/]+)\/projects\/([1-9]\d*)(?:\/views\/([1-9]\d*))?$/.exec(path)
  if (project) {
    const ref = { owner: project[2]!.toLowerCase(), type: project[1] === 'orgs' ? 'org' as const : 'user' as const, number: Number(project[3]) }
    if (!githubProjectSchema.safeParse(ref).success) throw new SourceError('github-invalid-url', 'Project 身份无效')
    return { kind: 'project', githubProject: ref, entryUrl: `https://github.com${path}${url.search}${url.hash}` }
  }
  const repo = /^\/([^/]+)\/([^/]+)$/.exec(path)
  if (repo && !url.search && !url.hash) {
    const repository = { owner: repo[1]!.toLowerCase(), repository: repo[2]!.replace(/\.git$/i, '').toLowerCase() }
    if (repositorySchema.safeParse(repository).success && !['orgs','users','settings','marketplace','features'].includes(repository.owner)) return { kind: 'repository', repository, entryUrl: `https://github.com/${repository.owner}/${repository.repository}` }
  }
  throw new SourceError('github-invalid-url', '请使用仓库根链接或组织／个人 Project 链接（可含 view 和切片参数）')
}
