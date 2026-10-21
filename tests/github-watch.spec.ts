/**
 * GitHub watch: the state comparison, the watch list, the hooks.a2d2.dev
 * client, the watcher that turns states into session messages, and the
 * mounted plugin.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import * as watchPlugin from '../src/github-watch.ts'
import { parseGitHubRemote } from '../src/github-watch.ts'
import { RepoConnection } from '../src/github-watch/relay.ts'
import type { RelayEvent, SocketLike } from '../src/github-watch/relay.ts'
import { describeChanges, noticeSummary, noticeText } from '../src/github-watch/state.ts'
import type { PrState } from '../src/github-watch/state.ts'
import { WATCHES_FILE, WatchStore } from '../src/github-watch/store.ts'
import { Watcher } from '../src/github-watch/watcher.ts'
import type { Inject } from '../src/github-watch/watcher.ts'
import { StubTools, stubAgent, toolRunContext } from './stubs.ts'

const pr = (patch: Partial<PrState> = {}): PrState => ({
  number: 7, state: 'open', draft: false, headSha: 'aaaaaaa1', mergedAt: null, checks: null, review: null, ...patch,
})

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'a2d2-watch-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('state wording', () => {
  it('names what changed, most consequential first', () => {
    expect(describeChanges(pr({ checks: 'pending' }), pr({ state: 'merged', checks: 'success', mergedAt: 't' })))
      .toEqual(['merged', 'CI passed'])
    expect(describeChanges(pr({ draft: true }), pr())).toEqual(['ready for review'])
    expect(describeChanges(pr(), pr({ headSha: 'bbbbbbb2', checks: 'pending' }))).toEqual(['CI running', 'new head bbbbbbb'])
    expect(describeChanges(pr(), pr({ review: 'changes_requested' }))).toEqual(['changes requested'])
  })

  it('writes a summary line and a message that says whether the watch goes on', () => {
    expect(noticeSummary('a/b', pr(), pr({ checks: 'failure' }))).toBe('a/b#7: CI failed')
    expect(noticeText('a/b', pr(), pr({ checks: 'failure' }))).toContain('The watch stays active')
    const merged = noticeText('a/b', pr(), pr({ state: 'merged', mergedAt: '2026-10-01T15:50:15Z' }))
    expect(merged).toContain('https://github.com/a/b/pull/7')
    expect(merged).toContain('The watch on this PR has ended')
  })
})

describe('parseGitHubRemote', () => {
  it('reads ssh, https, and ssh:// remotes', () => {
    expect(parseGitHubRemote('git@github.com:a2d2-dev/dsh-plugin.git')).toBe('a2d2-dev/dsh-plugin')
    expect(parseGitHubRemote('https://github.com/a2d2-dev/dsh-plugin')).toBe('a2d2-dev/dsh-plugin')
    expect(parseGitHubRemote('ssh://git@github.com/a2d2-dev/a2d2.services.git')).toBe('a2d2-dev/a2d2.services')
    expect(parseGitHubRemote('git@gitlab.com:a/b.git')).toBeUndefined()
  })
})

describe('WatchStore', () => {
  it('creates its directory on first write', async () => {
    const dir = join(await tempDir(), 'not', 'yet')
    await new WatchStore(dir).add({ repo: 'a/b', pr: 1, session: 's1', last: null, since: 't' })
    expect(await new WatchStore(dir).list()).toHaveLength(1)
  })

  it('persists watches and what each session was told', async () => {
    const dir = await tempDir()
    const store = new WatchStore(dir)
    await store.add({ repo: 'a/b', pr: 7, session: 's1', last: null, since: 't' })
    await store.add({ repo: 'A/B', pr: 7, session: 's1', last: null, since: 't2' })
    await store.told({ repo: 'a/b', pr: 7, session: 's1' }, pr({ checks: 'pending' }))
    const reread = await new WatchStore(dir).list()
    expect(reread).toEqual([{ repo: 'a/b', pr: 7, session: 's1', last: pr({ checks: 'pending' }), since: 't', revision: 1 }])
    await store.remove({ repo: 'a/b', pr: 7, session: 's1' })
    expect(JSON.parse(await readFile(join(dir, WATCHES_FILE), 'utf8'))).toEqual({ version: 1, watches: [] })
  })
})

/** A connection double: records registrations and lets the test push events. */
class FakeConnection {
  readonly watched = new Set<number>()
  readonly sent: { type: 'watch' | 'unwatch'; prs: readonly number[] }[] = []
  stopped = false
  constructor(readonly repo: string, readonly emit: (event: RelayEvent) => void) {}
  watch(prs: readonly number[]) {
    this.stopped = false
    for (const n of prs) this.watched.add(n)
    this.sent.push({ type: 'watch', prs })
  }
  unwatch(prs: readonly number[]) {
    for (const n of prs) this.watched.delete(n)
    this.sent.push({ type: 'unwatch', prs })
  }
  stop() { this.stopped = true }
  watching() { return [...this.watched] }
}

function harness(dir: string, options: { answerTimeoutMs?: number; gone?: Set<string> } = {}) {
  const connections: FakeConnection[] = []
  const injected: { session: string; text: string; summary: string }[] = []
  const inject: Inject = async (session, message) => {
    if (options.gone?.has(session)) return 'gone'
    injected.push({ session, text: message.text, summary: message.summary })
    return 'delivered'
  }
  const store = new WatchStore(dir)
  const watcher = new Watcher({
    store,
    relay: { baseUrl: 'https://relay.test', token: async () => 't' },
    inject,
    answerTimeoutMs: options.answerTimeoutMs ?? 1_000,
    connect: (repo, emit) => {
      const connection = new FakeConnection(repo, emit)
      connections.push(connection)
      return connection
    },
  })
  /** Push an event and let the watcher finish handling it. */
  const push = async (event: RelayEvent, connection = connections.at(-1)!) => {
    connection.emit(event)
    await vi.waitFor(async () => { await (watcher as unknown as { chain: Promise<unknown> }).chain })
    await (watcher as unknown as { chain: Promise<unknown> }).chain
  }
  return { watcher, store, connections, injected, push }
}

describe('Watcher', () => {
  it('preserves both states across a crash after enqueue but before the watch acknowledgement', async () => {
    const dir = await tempDir()
    const store = new WatchStore(dir)
    await store.add({ repo: 'a/b', pr: 7, session: 's1', last: pr(), since: 'stable-watch' })
    const inbox = new Map<string, string>()
    const ids: string[] = []
    let connection!: FakeConnection
    let failAfterEnqueue = true
    const options = {
      store, relay: { baseUrl: 'https://relay.test', token: async () => 't' },
      connect: (repo: string, emit: (event: RelayEvent) => void) => { connection = new FakeConnection(repo, emit); return connection },
      inject: async (_session: string, message: Parameters<Inject>[1]) => {
        if (!message.eventId) throw new Error('missing durable event identity')
        ids.push(message.eventId)
        inbox.set(message.eventId, message.text)
        if (failAfterEnqueue) throw new Error('crash after enqueue')
        return 'delivered' as const
      },
    }
    let watcher = new Watcher(options)
    await watcher.start()
    connection.emit({ type: 'states', prs: [pr({ checks: 'success' })] })
    await (watcher as unknown as { chain: Promise<unknown> }).chain
    expect((await store.list())[0]?.revision).toBeUndefined()
    watcher.stop()
    failAfterEnqueue = false
    watcher = new Watcher({ ...options, store: new WatchStore(dir) })
    await watcher.start()
    connection.emit({ type: 'states', prs: [pr({ state: 'merged', checks: 'success', mergedAt: 't' })] })
    await (watcher as unknown as { chain: Promise<unknown> }).chain
    expect(inbox.size).toBe(2)
    expect(ids[0]).not.toBe(ids[1])
    expect(await store.list()).toEqual([])
    watcher.stop()
  })

  it('answers the tool call with the first state, then reports only differences', async () => {
    const h = harness(await tempDir())
    const call = h.watcher.watch('a/b', 7, 's1')
    await vi.waitFor(() => expect(h.connections).toHaveLength(1))
    await h.push({ type: 'states', prs: [pr({ checks: 'pending' })] })
    expect(await call).toEqual({ status: 'watching', state: pr({ checks: 'pending' }) })
    expect(h.injected).toEqual([])

    await h.push({ type: 'states', prs: [pr({ checks: 'pending' })] })
    expect(h.injected).toEqual([])

    await h.push({ type: 'states', prs: [pr({ checks: 'success' })] })
    expect(h.injected.map(i => i.summary)).toEqual(['a/b#7: CI passed'])

    await h.push({ type: 'states', prs: [pr({ state: 'merged', checks: 'success', mergedAt: 't' })] })
    expect(h.injected.map(i => i.summary)).toEqual(['a/b#7: CI passed', 'a/b#7: merged'])
    expect(await h.store.list()).toEqual([])
    expect(h.connections[0]!.stopped).toBe(true)
  })

  it('tells each watching session separately', async () => {
    const h = harness(await tempDir())
    const one = h.watcher.watch('a/b', 7, 's1')
    await vi.waitFor(() => expect(h.connections).toHaveLength(1))
    await h.push({ type: 'states', prs: [pr()] })
    await one
    const two = h.watcher.watch('a/b', 7, 's2')
    await h.push({ type: 'states', prs: [pr()] })
    await two
    expect(h.connections).toHaveLength(1)

    await h.push({ type: 'states', prs: [pr({ review: 'approved' })] })
    expect(h.injected.map(i => i.session).sort()).toEqual(['s1', 's2'])
  })

  it('reports what changed while DSH was down exactly once after a restart', async () => {
    const dir = await tempDir()
    await new WatchStore(dir).add({ repo: 'a/b', pr: 7, session: 's1', last: pr({ checks: 'pending' }), since: 't' })
    const h = harness(dir)
    await h.watcher.start()
    expect(h.connections[0]!.watching()).toEqual([7])

    const snapshot = pr({ state: 'merged', checks: 'success', mergedAt: 't' })
    await h.push({ type: 'states', prs: [snapshot] })
    await h.push({ type: 'states', prs: [snapshot] })
    expect(h.injected.map(i => i.summary)).toEqual(['a/b#7: merged, CI passed'])
  })

  it('reports nothing after a restart when nothing changed', async () => {
    const dir = await tempDir()
    await new WatchStore(dir).add({ repo: 'a/b', pr: 7, session: 's1', last: pr(), since: 't' })
    const h = harness(dir)
    await h.watcher.start()
    await h.push({ type: 'states', prs: [pr()] })
    expect(h.injected).toEqual([])
    expect(await h.store.list()).toHaveLength(1)
  })

  it('ends at once on a PR that is already merged', async () => {
    const h = harness(await tempDir())
    const call = h.watcher.watch('a/b', 7, 's1')
    await vi.waitFor(() => expect(h.connections).toHaveLength(1))
    await h.push({ type: 'states', prs: [pr({ state: 'merged' })] })
    expect(await call).toMatchObject({ status: 'ended' })
    expect(await h.store.list()).toEqual([])
  })

  it('tells the session the first state as a message when the call timed out', async () => {
    const h = harness(await tempDir(), { answerTimeoutMs: 10 })
    expect(await h.watcher.watch('a/b', 7, 's1')).toMatchObject({ status: 'pending' })
    await h.push({ type: 'states', prs: [pr({ checks: 'failure' })] })
    expect(h.injected.map(i => i.summary)).toEqual(['a/b#7: open, CI failed'])
  })

  it('returns the install link when a2d2-bot is missing, and keeps no watch', async () => {
    const h = harness(await tempDir())
    const call = h.watcher.watch('a/b', 7, 's1')
    await vi.waitFor(() => expect(h.connections).toHaveLength(1))
    await h.push({ type: 'not_installed', message: 'not installed', installUrl: 'https://github.com/apps/a2d2-bot/installations/new' })
    expect(await call).toEqual({ status: 'not_installed', message: 'not installed', installUrl: 'https://github.com/apps/a2d2-bot/installations/new' })
    expect(await h.store.list()).toEqual([])
    expect(h.injected).toEqual([])
  })

  it('tells watching sessions when the app goes away later', async () => {
    const h = harness(await tempDir())
    const call = h.watcher.watch('a/b', 7, 's1')
    await vi.waitFor(() => expect(h.connections).toHaveLength(1))
    await h.push({ type: 'states', prs: [pr()] })
    await call
    await h.push({ type: 'not_installed', message: 'gone', installUrl: 'https://install' })
    expect(h.injected).toHaveLength(1)
    expect(h.injected[0]!.text).toContain('https://install')
    expect(await h.store.list()).toEqual([])
  })

  it('drops the watch of a session that no longer exists', async () => {
    const h = harness(await tempDir(), { gone: new Set(['s1']) })
    const call = h.watcher.watch('a/b', 7, 's1')
    await vi.waitFor(() => expect(h.connections).toHaveLength(1))
    await h.push({ type: 'states', prs: [pr()] })
    await call
    await h.push({ type: 'states', prs: [pr({ checks: 'success' })] })
    expect(await h.store.list()).toEqual([])
  })
})

/** A socket double the test drives by hand. */
class FakeSocket implements SocketLike {
  readyState = 0
  readonly sent: string[] = []
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  constructor(readonly url: string) {}
  send(data: string) { this.sent.push(data) }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.({ code, reason })
  }
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  message(value: unknown) { this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) }) }
  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code, reason: '' })
  }
}

function relayHarness(ticket: () => Response) {
  const sockets: FakeSocket[] = []
  const events: RelayEvent[] = []
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer gh-token')
    return ticket()
  })
  const connection = new RepoConnection('a/b', {
    baseUrl: 'https://relay.test',
    token: async () => 'gh-token',
    fetch: fetch as unknown as typeof globalThis.fetch,
    openSocket: url => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    minBackoffMs: 100,
  }, event => events.push(event))
  return { connection, sockets, events, fetch }
}

const okTicket = () => Response.json({ streamUrl: 'wss://relay.test/v1/stream?ticket=x' })

describe('RepoConnection', () => {
  it('registers its PRs on open and reports snapshots and pushes as states', async () => {
    const h = relayHarness(okTicket)
    h.connection.watch([7])
    await vi.waitFor(() => expect(h.sockets).toHaveLength(1))
    h.sockets[0]!.open()
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'watch', prs: [7] })])
    h.sockets[0]!.message({ type: 'hello', repo: { id: 1, fullName: 'a/b' } })
    h.sockets[0]!.message({ type: 'snapshot', prs: [pr()] })
    h.sockets[0]!.message({ type: 'pr', pr: pr({ checks: 'success' }) })
    h.sockets[0]!.message('pong')
    expect(h.events).toEqual([{ type: 'states', prs: [pr()] }, { type: 'states', prs: [pr({ checks: 'success' })] }])
    h.connection.watch([9])
    expect(h.sockets[0]!.sent.at(-1)).toBe(JSON.stringify({ type: 'watch', prs: [9] }))
    h.connection.stop()
  })

  it('reconnects with a fresh ticket and re-registers every PR', async () => {
    vi.useFakeTimers()
    const h = relayHarness(okTicket)
    h.connection.watch([7, 9])
    await vi.waitFor(() => expect(h.sockets).toHaveLength(1))
    h.sockets[0]!.open()
    h.sockets[0]!.drop()
    await vi.advanceTimersByTimeAsync(100)
    await vi.waitFor(() => expect(h.sockets).toHaveLength(2))
    h.sockets[1]!.open()
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(h.sockets[1]!.sent).toEqual([JSON.stringify({ type: 'watch', prs: [7, 9] })])
    h.connection.stop()
  })

  it('stops and says so when the app is not installed', async () => {
    const h = relayHarness(() => Response.json({ error: 'app_not_installed', message: 'install it', installUrl: 'https://install' }, { status: 409 }))
    h.connection.watch([7])
    await vi.waitFor(() => expect(h.events).toHaveLength(1))
    expect(h.events[0]).toEqual({ type: 'not_installed', message: 'install it', installUrl: 'https://install' })
    expect(h.sockets).toHaveLength(0)
  })

  it('backs off while the service is unreachable', async () => {
    vi.useFakeTimers()
    let up = false
    const h = relayHarness(() => (up ? okTicket() : new Response('down', { status: 503 })))
    h.connection.watch([7])
    await vi.waitFor(() => expect(h.events).toHaveLength(1))
    expect(h.events[0]).toMatchObject({ type: 'unavailable' })
    up = true
    await vi.advanceTimersByTimeAsync(100)
    await vi.waitFor(() => expect(h.sockets).toHaveLength(1))
    h.connection.stop()
  })

  it('closes once nothing is watched', async () => {
    const h = relayHarness(okTicket)
    h.connection.watch([7])
    await vi.waitFor(() => expect(h.sockets).toHaveLength(1))
    h.sockets[0]!.open()
    h.connection.unwatch([7])
    expect(h.sockets[0]!.sent.at(-1)).toBe(JSON.stringify({ type: 'unwatch', prs: [7] }))
    expect(h.sockets[0]!.readyState).toBe(3)
  })
})

class NamedStub extends Service {
  constructor(ctx: Context, config: { name: string; impl: object }) {
    super(ctx, config.name)
    Object.assign(this, config.impl)
  }
}

describe('github_watch plugin', () => {
  let sockets: FakeSocket[]
  beforeEach(() => {
    sockets = []
    vi.stubEnv('GH_TOKEN', 'gh-token')
    vi.stubGlobal('fetch', vi.fn(async () => okTicket()))
    vi.stubGlobal('WebSocket', class extends FakeSocket {
      constructor(url: string) {
        super(url)
        sockets.push(this)
      }
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('watches from a tool call and wakes the session with a notice when the PR merges', async () => {
    const home = await tempDir()
    const session = SessionId('session-main')
    const agent = stubAgent(home, session)
    const flush = vi.fn(async () => true)
    const ctx = new Context()
    await ctx.plugin(StubTools)
    await ctx.plugin(NamedStub, { name: 'agents', impl: { list: () => [agent] } })
    await ctx.plugin(NamedStub, { name: 'sessions', impl: { flush } })
    await ctx.plugin(NamedStub, { name: 'sessionController', impl: { resolveAgent: async () => ({ error: { code: 'session/not-found' } }) } })
    await ctx.plugin(watchPlugin, { homeDir: home, relayUrl: 'https://relay.test' })
    const tool = (ctx.get('tools') as unknown as StubTools).find('github_watch')
    if (tool === undefined) throw new Error('the tool did not register')

    const args = { repo: 'a2d2-dev/a2d2-services', pr: 7 }
    const call = tool.execute(args, toolRunContext(agent as unknown as Agent, tool.name, args))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.open()
    sockets[0]!.message({ type: 'snapshot', prs: [pr({ checks: 'pending' })] })
    expect(await call).toMatchObject({ repo: 'a2d2-dev/a2d2-services', pr: 7, status: 'watching', state: 'open', checks: 'pending' })
    expect(agent.followup).not.toHaveBeenCalled()

    sockets[0]!.message({ type: 'pr', pr: pr({ state: 'merged', checks: 'success', mergedAt: '2026-10-01T15:50:15Z' }) })
    await vi.waitFor(() => expect(agent.followup).toHaveBeenCalledTimes(1))
    const message = agent.followup.mock.calls[0]![0]
    expect(message.source).toEqual({
      kind: 'a2d2-github-watch', repo: 'a2d2-dev/a2d2-services', pr: 7, form: 'notice', summary: 'a2d2-dev/a2d2-services#7: merged, CI passed',
    })
    expect(message.content[0].text).toContain('The watch on this PR has ended')
    await vi.waitFor(() => expect(flush).toHaveBeenCalledWith(agent.session))
    // Delivery flush precedes durable watch removal and asynchronous pruning.
    await vi.waitFor(() => expect(sockets[0]!.readyState).toBe(3))
    await ctx.fiber.dispose()
  })

  it('closes its connections when the plugin unloads', async () => {
    const home = await tempDir()
    await new WatchStore(home).add({ repo: 'a/b', pr: 7, session: 'session-main', last: pr(), since: 't' })
    const ctx = new Context()
    await ctx.plugin(StubTools)
    await ctx.plugin(NamedStub, { name: 'agents', impl: { list: () => [] } })
    await ctx.plugin(NamedStub, { name: 'sessions', impl: { flush: async () => true } })
    await ctx.plugin(NamedStub, { name: 'sessionController', impl: { resolveAgent: async () => ({ error: { code: 'session/not-found' } }) } })
    await ctx.plugin(watchPlugin, { homeDir: home, relayUrl: 'https://relay.test' })
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.open()
    await ctx.fiber.dispose()
    expect(sockets[0]!.readyState).toBe(3)
  })
})
