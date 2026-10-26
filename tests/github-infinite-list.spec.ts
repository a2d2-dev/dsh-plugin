import { describe, expect, it } from 'vitest'
import { GitHubSource } from '../src/work-sources/github.ts'
const rawIssue = (n: number) => ({ node_id: `I${n}`, number: n, title: `Issue ${n}`, body: '', html_url: `https://github.com/o/r/issues/${n}`, state: 'open', milestone: null, updated_at: '2026-10-24T00:00:00Z', assignees: [], labels: [] })
const scope = { owner: 'o', repository: 'r' }
const request = { page: 1, perPage: 100, assignee: '*' as const, state: 'all' as const }
function adapter(rows: unknown[]) {
  const urls: string[] = []
  return { urls, source: new GitHubSource({ credential: async () => 'test', fetch: async url => {
    urls.push(String(url))
    if (String(url).endsWith('/user')) return Response.json({ login: 'reader', node_id: 'U1', name: null })
    const at = Number(new URL(String(url)).searchParams.get('page'))
    return Response.json(rows.slice((at - 1) * 100, at * 100), { headers: { link: '<https://evil.invalid/credential>; rel="next"' } })
  } }) }
}
describe('repository Issue continuation', () => {
  it.each([0, 99, 100, 101, 200, 201])('traverses %i Issues in batches of at most 100 with an accurate terminal batch', async total => {
    const { source, urls } = adapter(Array.from({ length: total }, (_, n) => rawIssue(n + 1)))
    const seen: string[] = []
    let next: number | undefined = 1
    do {
      const result = await source.list(scope, { ...request, page: next })
      expect(result.items.length).toBeLessThanOrEqual(100)
      seen.push(...result.items.map(row => row.nodeId))
      next = 'nextPage' in result ? result.nextPage : undefined
      if (seen.length === total) expect(next).toBeUndefined()
    } while (next)
    expect(seen).toEqual(Array.from({ length: total }, (_, n) => `I${n + 1}`))
    expect(urls.every(url => url.startsWith('https://api.github.com/'))).toBe(true)
  })
  it('traverses PR-only middle pages, and does not count a PR-only tail as more Issues', async () => {
    const prs = Array.from({ length: 200 }, (_, n) => ({ ...rawIssue(n + 2000), pull_request: {} }))
    const { source } = adapter([...Array.from({ length: 100 }, (_, n) => rawIssue(n + 1)), ...prs, rawIssue(101)])
    const first = await source.list(scope, request)
    expect(first).toMatchObject({ nextPage: 2 })
    expect(await source.list(scope, { ...request, page: 2 })).toMatchObject({ items: [], nextPage: 3 })
    expect(await source.list(scope, { ...request, page: 3 })).toMatchObject({ items: [], nextPage: 4 })
    expect(await source.list(scope, { ...request, page: 4 })).toMatchObject({ items: [{ number: 101 }] })
    const tail = adapter([...Array.from({ length: 100 }, (_, n) => rawIssue(n + 1)), ...prs])
    expect(await tail.source.list(scope, request)).not.toHaveProperty('nextPage')
  })
})
