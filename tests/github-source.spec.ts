import { describe, expect, it } from 'vitest'
import { GitHubSource, SourceError } from '../src/work-sources/github.ts'
const repository = { owner: 'a2d2-dev', repository: 'dsh-plugin' }
const issue = { node_id: 'I_112', number: 112, title: 'Existing work', body: 'Original issue body', milestone: null, html_url: 'https://github.com/a2d2-dev/dsh-plugin/issues/112', state: 'open', updated_at: '2026-10-19T12:00:00Z', assignees: [{ login: 'imneov' }], labels: [{ name: 'ready-for-agent' }] }
const user = { login: 'imneov', node_id: 'U_1', name: 'LiuFeng' }
describe('GitHub source boundary', () => {
  it.each(['.github', '_work', '-work', 'work.'])('reads legal repository %s with generated GitHub-only GETs', async name => {
    const scope = { owner: repository.owner, repository: name }
    const content = { ...issue, html_url: `https://github.com/a2d2-dev/${name}/issues/112` }
    const source = new GitHubSource({ credential: async () => 'secret', fetch: async (url, init) => {
      expect(init?.method).toBe('GET')
      expect(init?.redirect).toBe('manual')
      if (String(url) === 'https://api.github.com/user') return Response.json(user)
      const path = new URL(String(url))
      expect(path.origin).toBe('https://api.github.com')
      expect(path.pathname).toBe(`/repos/a2d2-dev/${name}/issues${path.search ? '' : '/112'}`)
      return Response.json(path.search ? [content] : content)
    } })
    expect(await source.list(scope, { page: 1, perPage: 20, assignee: '*', state: 'open' })).toMatchObject({ items: [{ repository: scope, body: issue.body }] })
    expect(await source.detail(scope, 112)).toMatchObject({ issue: { repository: scope, body: issue.body } })
  })
  it.each([null, { number: 3, title: '3.0' }])('preserves milestone %j in repository list and detail observations', async milestone => {
    const source = new GitHubSource({ credential: async () => 'secret', fetch: async url => {
      if (String(url).endsWith('/user')) return Response.json(user)
      return Response.json(new URL(String(url)).search ? [{ ...issue, milestone }] : { ...issue, milestone })
    } })
    expect((await source.list(repository, { page: 1, perPage: 20, assignee: '*', state: 'open' })).items[0]!.milestone).toEqual(milestone)
    expect((await source.detail(repository, 112)).issue.milestone).toEqual(milestone)
  })
  it.each([undefined, { title: '3.0' }, { number: -1, title: '3.0' }])('rejects incomplete or invalid milestone %j at the API boundary', async milestone => {
    const source = new GitHubSource({ credential: async () => 'secret', fetch: async url => Response.json(String(url).endsWith('/user') ? user : { ...issue, milestone }) })
    await expect(source.detail(repository, 112)).rejects.toMatchObject({ code: 'github-invalid-response' })
  })
  it.each(['.', '..', '../repo', 'repo/child', 'repo\\child', '%2e%2e', '%252f', 'repo?x=1', 'repo#x', 'repo@evil.test', 'repo\n', ''])('rejects unsafe owner or repository component %j before credential or network access', async component => {
    let calls = 0
    const source = new GitHubSource({ credential: async () => { calls++; return 'secret' }, fetch: async () => { calls++; return Response.json(user) } })
    for (const scope of [{ ...repository, owner: component }, { ...repository, repository: component }]) {
      await expect(source.list(scope, { page: 1, perPage: 20, assignee: '*', state: 'open' })).rejects.toMatchObject({ code: 'github-invalid-scope' })
      await expect(source.detail(scope, 112)).rejects.toMatchObject({ code: 'github-invalid-scope' })
    }
    expect(calls).toBe(0)
  })
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
