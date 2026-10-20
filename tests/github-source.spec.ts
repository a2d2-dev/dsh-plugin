import { describe, expect, it } from 'vitest'
import { GitHubSource, SourceError } from '../src/work-sources/github.ts'
const repository = { owner: 'a2d2-dev', repository: 'dsh-plugin' }
const issue = { node_id: 'I_112', number: 112, title: 'Existing work', body: 'Original issue body', html_url: 'https://github.com/a2d2-dev/dsh-plugin/issues/112', state: 'open', updated_at: '2026-10-19T12:00:00Z', assignees: [{ login: 'imneov' }], labels: [{ name: 'ready-for-agent' }] }
const user = { login: 'imneov', node_id: 'U_1', name: 'LiuFeng' }
describe('GitHub source boundary', () => {
  it('binds @me to credential identity and excludes PRs with explicit pagination', async () => {
    const urls: string[] = []
    const source = new GitHubSource({ credential: async () => 'secret', fetch: async (url, init) => {
      urls.push(String(url)); expect(init?.redirect).toBe('manual')
      if (String(url).endsWith('/user')) return Response.json(user)
      return Response.json([issue, { ...issue, number: 113, pull_request: {} }], { headers: { link: '<https://evil.test/steal>; rel="next"' } })
    } })
    const result = await source.list(repository, { page: 1, perPage: 2, assignee: '@me', state: 'open' })
    expect(result.identity).toEqual({ login: 'imneov', nodeId: 'U_1', name: 'LiuFeng' })
    expect(result.items).toMatchObject([{ nodeId: 'I_112', body: 'Original issue body', assignees: ['imneov'], labels: ['ready-for-agent'] }])
    expect(result.items).toHaveLength(1)
    expect(result.nextPage).toBe(2)
    expect(urls[1]).toContain('assignee=imneov')
    expect(urls.every(url => url.startsWith('https://api.github.com/'))).toBe(true)
  })
  it.each([[401, {}, 'github-unauthorized'], [403, {}, 'github-forbidden'], [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }, 'github-rate-limited'], [429, {}, 'github-rate-limited'], [503, {}, 'github-unavailable'], [302, { location: 'https://evil.test/token' }, 'github-source-moved']] as const)('distinguishes HTTP %s failures from empty pages without leaking credentials', async (status, headers, code) => {
    const source = new GitHubSource({ credential: async () => 'secret', fetch: async () => new Response('secret remote body', { status, headers }) })
    await expect(source.list(repository, { page: 1, perPage: 20, assignee: '@me', state: 'open' })).rejects.toMatchObject({ code })
    await expect(source.detail(repository, 112)).rejects.not.toHaveProperty('message', expect.stringContaining('secret'))
  })
  it('returns an actual empty page, rejects PR details, unsafe repository input, and reports offline transport', async () => {
    let calls = 0
    const source = new GitHubSource({ credential: async () => 'secret', fetch: async url => {
      calls++
      if (String(url).endsWith('/user')) return Response.json(user)
      if (String(url).includes('/issues/')) return Response.json({ ...issue, pull_request: {} })
      return Response.json([])
    } })
    expect(await source.list(repository, { page: 2, perPage: 20, assignee: '*', state: 'all' })).toMatchObject({ items: [] })
    await expect(source.detail(repository, 112)).rejects.toMatchObject({ code: 'github-not-issue' })
    const before = calls
    await expect(source.detail({ owner: '../evil', repository: 'x' }, 1)).rejects.toMatchObject({ code: 'github-invalid-scope' })
    expect(calls).toBe(before)
    await expect(new GitHubSource({ credential: async () => 'secret', fetch: async () => { throw new Error('DNS') } }).detail(repository, 112)).rejects.toBeInstanceOf(SourceError)
  })
})
