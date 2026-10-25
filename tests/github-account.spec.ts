import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubLoginFlow } from '../src/work-sources/login.ts'
import { GitHubSource } from '../src/work-sources/github.ts'
import { SourceError } from '../src/work-sources/errors.ts'
import { WorkApplication } from '../src/work.ts'

class LoginChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}
const user = { node_id: 'U1', login: 'test-user', name: null }
const repository = (index: number) => ({ node_id: `R${index}`, name: `repo-${index}`, owner: { login: 'test-org' }, html_url: `https://github.com/test-org/repo-${index}`, description: 'Repository description', private: true, archived: false })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('GitHub browser login process', () => {
  it('reuses a pending flow, exposes only its code and ignores late events after cancellation', () => {
    const child = new LoginChild(), launch = vi.fn(() => child), flow = new GitHubLoginFlow(launch)
    expect(flow.start()).toMatchObject({ state: 'pending' })
    flow.start()
    expect(launch).toHaveBeenCalledOnce()
    child.stderr.emit('data', Buffer.from('private-token-do-not-expose\n! First copy your one-time co'))
    child.stderr.emit('data', Buffer.from('de: ABCD-1234\n'))
    expect(flow.status()).toEqual({ state: 'pending', code: 'ABCD-1234', url: 'https://github.com/login/device' })
    expect(JSON.stringify(flow.status())).not.toContain('private-token')
    flow.cancel()
    expect(child.kill).toHaveBeenCalledOnce()
    child.emit('close', 0)
    expect(flow.status()).toEqual({ state: 'idle' })
  })
  it('reports completion and failure without exposing process stderr, and expires abandoned flows', () => {
    vi.useFakeTimers()
    const child = new LoginChild(), flow = new GitHubLoginFlow(() => child)
    flow.start(); child.emit('close', 0)
    expect(flow.status()).toEqual({ state: 'complete' })
    flow.start(); child.emit('error', new Error('secret environment'))
    expect(flow.status().state).toBe('error')
    expect(JSON.stringify(flow.status())).not.toContain('secret environment')
    flow.start(); vi.advanceTimersByTime(10 * 60_000)
    expect(flow.status()).toMatchObject({ state: 'error', message: '登录已超时，请重新连接 GitHub。' })
    expect(child.kill).toHaveBeenCalledOnce()
  })
})

describe('authenticated GitHub repository discovery', () => {
  it('reads affiliated repositories with the same credential and reports incomplete pagination', async () => {
    const requests: URL[] = []
    const source = new GitHubSource({ credential: async () => 'private-token', fetch: async (input, init) => {
      const url = new URL(String(input)); requests.push(url)
      expect(init?.redirect).toBe('manual')
      return Response.json(url.pathname === '/user' ? user : Array.from({ length: 50 }, (_, index) => repository(index)))
    } })
    expect(await source.account()).toMatchObject({ status: 'connected', identity: { nodeId: 'U1', login: 'test-user' } })
    const page = await source.repositories(2)
    expect(page).toMatchObject({ identity: { nodeId: 'U1' }, nextPage: 3 })
    expect(page.items).toHaveLength(50)
    expect(page.items[0]).toMatchObject({ owner: 'test-org', private: true })
    expect(requests.at(-1)?.pathname).toBe('/user/repos')
    expect(requests.at(-1)?.searchParams.get('affiliation')).toBe('owner,collaborator,organization_member')
    expect(requests.at(-1)?.searchParams.get('page')).toBe('2')
  })
  it('rejects unsafe repository URLs and invalid pages before using credentials', async () => {
    const credential = vi.fn(async () => 'private-token')
    const source = new GitHubSource({ credential, fetch: async input => Response.json(new URL(String(input)).pathname === '/user' ? user : [{ ...repository(1), html_url: 'https://example.org/token' }]) })
    await expect(source.repositories(0)).rejects.toMatchObject({ code: 'github-invalid-scope' })
    expect(credential).not.toHaveBeenCalled()
    await expect(source.repositories(1)).rejects.toMatchObject({ code: 'github-invalid-response' })
  })
  it('distinguishes disconnected credentials from an unreachable account', async () => {
    const absent = new GitHubSource({ credential: async () => { throw new SourceError('github-credentials-unavailable', 'secret') } })
    expect(await absent.account()).toMatchObject({ status: 'disconnected' })
    const offline = new GitHubSource({ credential: async () => 'token', fetch: async () => { throw Error('secret network data') } })
    expect(await offline.account()).toMatchObject({ status: 'unavailable' })
    expect(JSON.stringify(await offline.account())).not.toContain('secret')
  })
  it('requires host operator authority before triggering login or reading an account', async () => {
    const source = { list: vi.fn(), detail: vi.fn(), login: vi.fn(() => ({ state: 'pending' as const })), account: vi.fn(async () => ({ status: 'disconnected' as const, login: { state: 'idle' as const } })) }
    const app = new WorkApplication('/private/tmp/a2d2-account-test', { resources: async () => [], sessions: async () => [] }, source)
    const command = { type: 'github.login', action: 'start', commandId: randomUUID() }
    expect(await app.execute(command, { operator: false, session: { runtimeId: 'host', sessionId: 'session' } })).toMatchObject({ status: 'failed', error: { code: 'forbidden' } })
    expect(await app.query({ type: 'github.account' }, { operator: false })).toMatchObject({ status: 'failed' })
    expect(source.login).not.toHaveBeenCalled(); expect(source.account).not.toHaveBeenCalled()
    expect(await app.execute(command, { operator: true })).toMatchObject({ status: 'completed', githubLogin: { state: 'pending' } })
    expect(await app.query({ type: 'github.account' }, { operator: true })).toMatchObject({ status: 'completed', githubAccount: { status: 'disconnected' } })
  })
})


describe('GitHub account logout', () => {
  it('removes only the explicitly confirmed current identity and returns the actual resulting account', async () => {
    vi.stubEnv('GH_TOKEN', ''); vi.stubEnv('GITHUB_TOKEN', '')
    let active = true
    const logout = vi.fn(async (_login: string) => { active = false })
    const source = new GitHubSource({ logout, credential: async () => {
      if (!active) throw new SourceError('github-credentials-unavailable', 'missing')
      return 'test-token'
    }, fetch: async () => Response.json(user) })
    expect(await source.account()).toMatchObject({ status: 'connected', canLogout: true })
    expect(await source.logout({ login: 'test-user', nodeId: 'U1' })).toMatchObject({ status: 'disconnected' })
    expect(logout).toHaveBeenCalledExactlyOnceWith('test-user')
  })
  it('rejects stale account confirmation and environment-managed credentials without mutating them', async () => {
    vi.stubEnv('GH_TOKEN', ''); vi.stubEnv('GITHUB_TOKEN', '')
    const logout = vi.fn(async () => {})
    const source = new GitHubSource({ logout, credential: async () => 'token', fetch: async () => Response.json(user) })
    await expect(source.logout({ login: 'another-user', nodeId: 'U2' })).rejects.toMatchObject({ code: 'github-identity-changed' })
    expect(logout).not.toHaveBeenCalled()
    vi.stubEnv('GH_TOKEN', 'environment-managed')
    expect(await source.account()).toMatchObject({ canLogout: false })
    await expect(source.logout({ login: 'test-user', nodeId: 'U1' })).rejects.toMatchObject({ code: 'github-logout-unavailable' })
    expect(logout).not.toHaveBeenCalled()
  })
  it('requires operator authority to log out and rejects incomplete account confirmation', async () => {
    const logout = vi.fn(async () => ({ status: 'disconnected' as const, login: { state: 'idle' as const } }))
    const app = new WorkApplication('/private/tmp/a2d2-account-test', { resources: async () => [], sessions: async () => [] }, { list: vi.fn(), detail: vi.fn(), logout })
    const command = { type: 'github.logout', commandId: randomUUID(), login: 'test-user', nodeId: 'U1' }
    expect(await app.execute(command, { operator: false, session: { runtimeId: 'host', sessionId: 'session' } })).toMatchObject({ status: 'failed', error: { code: 'forbidden' } })
    expect(await app.execute({ ...command, nodeId: '' }, { operator: true })).toMatchObject({ status: 'failed', error: { code: 'invalid-command' } })
    expect(logout).not.toHaveBeenCalled()
    expect(await app.execute(command, { operator: true })).toMatchObject({ status: 'completed', githubAccount: { status: 'disconnected' } })
  })
})
