import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import type { IncomingHttpHeaders } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service from '../src/index.ts'
import { CONFIG_ROUTE_PATH } from '../src/config-page.ts'
import { CONSULT_ROUTE_PATH } from '../src/consult.ts'
import { PANEL_ROUTE_PATH } from '../src/panel.ts'
import { SESSION_AGENT_ROUTE_PATH } from '../src/session-agent-route.ts'

/**
 * Every A2D2 browser route sits behind DSH's own browser authentication: the
 * composition's `connection` service decides, from the request headers, whether
 * the caller is a logged-in browser on a trusted authority. A Host or Origin
 * header alone is forgeable by any non-browser client, so it must never be
 * enough.
 */

const TRUSTED_HOST = '10.126.126.12:3710'
const TRUSTED_ORIGIN = `http://${TRUSTED_HOST}`
const LOGIN_COOKIE = 'dsh-test-login=ok'
const sessionA = SessionId('session-a')

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-route-auth-'))
  roots.push(root)
  await mkdir(join(root, '.git'), { recursive: true })
  return root
}

type RouteHandler = (request: unknown, response: unknown) => void | Promise<void>

class StubWebServer extends Service {
  readonly routes = new Map<string, RouteHandler>()

  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(route: { readonly path: string; readonly handler: RouteHandler }): () => void {
    this.routes.set(route.path, route.handler)
    return () => { this.routes.delete(route.path) }
  }
}

/** DSH's runtime is configured with the public domain as a trusted host. */
class StubWebRuntime extends Service {
  readonly trustedHosts = [TRUSTED_HOST]

  constructor(ctx: Context) {
    super(ctx, 'webRuntime')
  }
}

/**
 * Stands in for DSH's connection service: a trusted Host without the login
 * cookie is 401, an untrusted Host is 403.
 */
class StubConnection extends Service {
  readonly requestRejection = vi.fn((request: { readonly headers: IncomingHttpHeaders }): 401 | 403 | undefined => {
    if (request.headers.host !== TRUSTED_HOST) return 403
    return request.headers.cookie === LOGIN_COOKIE ? undefined : 401
  })

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }
}

class StubSessions extends Service {
  private readonly byId = new Map<SessionId, { readonly id: SessionId; readonly header: { readonly cwd?: string } }>()
  readonly lookups = vi.fn()

  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  add(id: SessionId, cwd: string): void {
    this.byId.set(id, { id, header: { cwd } })
  }

  get(id: SessionId): { readonly id: SessionId; readonly header: { readonly cwd?: string } } | undefined {
    this.lookups(id)
    return this.byId.get(id)
  }
}

class StubLlm extends Service {
  readonly stream = vi.fn(() => { throw new Error('consult reached the model') })

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  listProviders(): readonly { readonly id: string }[] {
    return []
  }

  async listModels(): Promise<readonly { readonly id: string }[]> {
    return []
  }
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function mount(options: { readonly connection: boolean }) {
  const ctx = new Context()
  await ctx.plugin(StubSessions)
  await ctx.plugin(StubLlm)
  await ctx.plugin(StubWebServer)
  await ctx.plugin(StubWebRuntime)
  if (options.connection) await ctx.plugin(StubConnection)
  await ctx.plugin(A2d2Service, {})
  await settle()
  return {
    server: ctx.get('webServer') as unknown as StubWebServer,
    sessions: ctx.get('sessions') as unknown as StubSessions,
    llm: ctx.get('llm') as unknown as StubLlm,
    service: ctx.a2d2,
  }
}

/** A Node-shaped request whose body records whether anything read it. */
function request(method: string, url: string, headers: IncomingHttpHeaders, body?: unknown) {
  let bodyRead = false
  const stream = new Readable({
    read() {
      bodyRead = true
      this.push(body === undefined ? null : JSON.stringify(body))
      if (body !== undefined) this.push(null)
    },
  })
  return {
    request: Object.assign(stream, { method, url, headers }),
    bodyRead: () => bodyRead,
  }
}

function response() {
  const captured: { status?: number; body?: string } = {}
  return {
    captured,
    response: {
      setHeader() {},
      writeHead(status: number) { captured.status = status },
      end(body?: string) { captured.body = body },
    },
  }
}

const forgedBrowserHeaders = { host: TRUSTED_HOST, origin: TRUSTED_ORIGIN, 'sec-fetch-site': 'same-origin' }
const loggedInHeaders = { ...forgedBrowserHeaders, cookie: LOGIN_COOKIE }
const loggedInJsonHeaders = { ...loggedInHeaders, 'content-type': 'application/json' }

const routeCalls = [
  { path: CONFIG_ROUTE_PATH, method: 'POST', url: CONFIG_ROUTE_PATH, body: { method: 'settings.get', payload: {} } },
  { path: CONSULT_ROUTE_PATH, method: 'POST', url: `${CONSULT_ROUTE_PATH}?session=${sessionA}` },
  { path: PANEL_ROUTE_PATH, method: 'GET', url: `${PANEL_ROUTE_PATH}?session=${sessionA}` },
  { path: SESSION_AGENT_ROUTE_PATH, method: 'POST', url: SESSION_AGENT_ROUTE_PATH, body: { session: sessionA, agent: 'engineer' } },
] as const

describe('A2D2 route authentication', () => {
  it('registers no A2D2 route when the composition has no connection service to authenticate with', async () => {
    const { server } = await mount({ connection: false })

    expect([...server.routes.keys()]).toEqual([])
  })

  it.each(routeCalls)('rejects an unauthenticated $path request carrying a trusted Host and Origin before any side effect', async (call) => {
    const root = await tempRoot()
    const { server, sessions, llm, service } = await mount({ connection: true })
    sessions.add(sessionA, root)
    const sent = request(call.method, call.url, forgedBrowserHeaders, 'body' in call ? call.body : undefined)
    const answer = response()

    await server.routes.get(call.path)?.(sent.request, answer.response)

    expect(answer.captured.status).toBe(401)
    expect(JSON.parse(answer.captured.body ?? 'null')).toMatchObject({ ok: false, error: { code: 'unauthenticated' } })
    expect(sent.bodyRead()).toBe(false)
    expect(sessions.lookups).not.toHaveBeenCalled()
    expect(llm.stream).not.toHaveBeenCalled()
    expect(await service.agentOfSession(root, sessionA)).toBeUndefined()
  })

  it.each(routeCalls)('rejects a $path request the connection refuses as untrusted with 403', async (call) => {
    const { server } = await mount({ connection: true })
    const sent = request(call.method, call.url, { host: 'evil.example', cookie: LOGIN_COOKIE }, 'body' in call ? call.body : undefined)
    const answer = response()

    await server.routes.get(call.path)?.(sent.request, answer.response)

    expect(answer.captured.status).toBe(403)
    expect(JSON.parse(answer.captured.body ?? 'null')).toMatchObject({ ok: false, error: { code: 'untrusted' } })
    expect(sent.bodyRead()).toBe(false)
  })

  it('serves the panel to a logged-in browser', async () => {
    const root = await tempRoot()
    const { server, sessions, service } = await mount({ connection: true })
    sessions.add(sessionA, root)
    const task = await service.create(root, { name: 'Authenticated task' })
    const sent = request('GET', `${PANEL_ROUTE_PATH}?session=${sessionA}`, loggedInHeaders)
    const answer = response()

    await server.routes.get(PANEL_ROUTE_PATH)?.(sent.request, answer.response)

    expect(answer.captured.status).toBe(200)
    expect(JSON.parse(answer.captured.body ?? 'null')).toMatchObject({
      ok: true,
      value: { root, tasks: [{ id: task.id, name: 'Authenticated task' }] },
    })
  })

  it('records a session Agent for a logged-in browser', async () => {
    const root = await tempRoot()
    const { server, sessions, service } = await mount({ connection: true })
    sessions.add(sessionA, root)
    const sent = request('POST', SESSION_AGENT_ROUTE_PATH, loggedInJsonHeaders, { session: sessionA, agent: 'engineer' })
    const answer = response()

    await server.routes.get(SESSION_AGENT_ROUTE_PATH)?.(sent.request, answer.response)

    expect(answer.captured.status).toBe(200)
    expect(await service.agentOfSession(root, sessionA)).toBe('engineer')
  })

  it('answers settings.get for a logged-in browser', async () => {
    const { server } = await mount({ connection: true })
    const sent = request('POST', CONFIG_ROUTE_PATH, loggedInJsonHeaders, { method: 'settings.get', payload: {} })
    const answer = response()

    await server.routes.get(CONFIG_ROUTE_PATH)?.(sent.request, answer.response)

    expect(answer.captured.status).toBe(200)
    expect(JSON.parse(answer.captured.body ?? 'null')).toMatchObject({ ok: true, value: { settings: { stages: {} } } })
  })
})

/**
 * DSH's login cookie is same-site, so a page on another port of the same host
 * can still make the browser send it with a simple POST that skips the CORS
 * preflight (`text/plain`, or no body at all). Requiring `application/json`
 * forces a preflight that such a page cannot pass; every write route refuses
 * anything else with 415 before any side effect.
 */
const writeRouteCalls = [
  { path: CONFIG_ROUTE_PATH, url: CONFIG_ROUTE_PATH, body: { method: 'settings.get', payload: {} } },
] as const

describe('A2D2 write route content type', () => {
  it.each(writeRouteCalls)('refuses a logged-in text/plain $path POST with 415 before any side effect', async (call) => {
    const root = await tempRoot()
    const { server, sessions, llm, service } = await mount({ connection: true })
    sessions.add(sessionA, root)
    const sent = request('POST', call.url, { ...loggedInHeaders, 'content-type': 'text/plain' }, 'body' in call ? call.body : undefined)
    const answer = response()

    await server.routes.get(call.path)?.(sent.request, answer.response)

    expect(answer.captured.status).toBe(415)
    expect(JSON.parse(answer.captured.body ?? 'null')).toMatchObject({ ok: false, error: { code: 'unsupported-media-type' } })
    expect(sent.bodyRead()).toBe(false)
    expect(sessions.lookups).not.toHaveBeenCalled()
    expect(llm.stream).not.toHaveBeenCalled()
    expect(await service.agentOfSession(root, sessionA)).toBeUndefined()
  })

  it('accepts application/json with a charset parameter', async () => {
    const { server } = await mount({ connection: true })
    const sent = request('POST', CONFIG_ROUTE_PATH, { ...loggedInHeaders, 'content-type': 'application/json; charset=utf-8' }, { method: 'settings.get', payload: {} })
    const answer = response()

    await server.routes.get(CONFIG_ROUTE_PATH)?.(sent.request, answer.response)

    expect(answer.captured.status).toBe(200)
  })
})
