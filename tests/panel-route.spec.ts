import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service from '../src/index.ts'
import { PANEL_ROUTE_PATH } from '../src/panel.ts'

const roots: string[] = []
const sessionA = SessionId('session-a')

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-panel-'))
  roots.push(root)
  await mkdir(join(root, '.git'), { recursive: true })
  return root
}

interface RegisteredRoute {
  readonly kind: 'exact'
  readonly path: string
  readonly handler: (request: {
    readonly method?: string
    readonly url?: string
    readonly headers: Record<string, string | string[] | undefined>
  }, response: {
    writeHead(status: number, headers?: Record<string, string>): void
    end(body?: string): void
  }) => void | Promise<void>
}

class StubWebServer extends Service {
  readonly routes: RegisteredRoute[] = []

  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(route: RegisteredRoute): () => void {
    this.routes.push(route)
    return () => {
      const index = this.routes.indexOf(route)
      if (index >= 0) this.routes.splice(index, 1)
    }
  }

  handler(path: string): RegisteredRoute['handler'] | undefined {
    return this.routes.find(route => route.path === path)?.handler
  }
}

class StubSessions extends Service {
  private readonly byId = new Map<SessionId, { readonly header: { readonly cwd?: string } }>()

  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  add(id: SessionId, cwd: string | undefined): void {
    this.byId.set(id, { header: cwd === undefined ? {} : { cwd } })
  }

  get(id: SessionId): { readonly header: { readonly cwd?: string } } | undefined {
    return this.byId.get(id)
  }
}

class StubWebRuntime extends Service {
  readonly trustedHosts: readonly string[]

  constructor(ctx: Context, trustedHosts: readonly string[] = []) {
    super(ctx, 'webRuntime')
    this.trustedHosts = trustedHosts
  }
}

function record() {
  const captured: { status?: number; body?: string; response: { writeHead(status: number): void; end(body?: string): void } } = {
    response: undefined as never,
  }
  captured.response = {
    writeHead(status) { captured.status = status },
    end(body) { captured.body = body },
  }
  return captured
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function mount(): Promise<{ ctx: Context; server: StubWebServer; sessions: StubSessions; service: A2d2Service }> {
  const ctx = new Context()
  await ctx.plugin(StubSessions)
  await ctx.plugin(StubWebServer)
  await ctx.plugin(StubWebRuntime, ['10.126.126.12:3710'])
  await ctx.plugin(A2d2Service, {})
  await settle()
  return {
    ctx,
    server: ctx.get('webServer') as unknown as StubWebServer,
    sessions: ctx.get('sessions') as unknown as StubSessions,
    service: ctx.a2d2,
  }
}

describe('panel route wiring', () => {
  it('registers the read-only tasks route when a web server is composed', async () => {
    const { server } = await mount()
    expect(server.handler(PANEL_ROUTE_PATH)).toBeTypeOf('function')
  })

  it('serves tasks from the session cwd project and ignores browser-supplied paths', async () => {
    const root = await tempRoot()
    const otherRoot = await tempRoot()
    const cwd = join(root, 'src')
    await mkdir(cwd, { recursive: true })
    const { server, sessions, service } = await mount()
    sessions.add(sessionA, cwd)
    const task = await service.create(cwd, { name: 'Panel task' })
    await service.create(otherRoot, { name: 'Other task' })

    const captured = record()
    await server.handler(PANEL_ROUTE_PATH)?.({
      method: 'GET',
      url: `${PANEL_ROUTE_PATH}?session=${sessionA}&cwd=${encodeURIComponent(otherRoot)}`,
      headers: { host: '10.126.126.12:3710' },
    }, captured.response)

    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body ?? 'null')).toMatchObject({
      ok: true,
      value: { root, tasks: [{ id: task.id, name: 'Panel task' }] },
    })
  })

  it('still loads without a web server', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSessions)
    await ctx.plugin(A2d2Service, {})
    await settle()

    expect(ctx.get('webServer')).toBeUndefined()
    expect(ctx.a2d2).toBeInstanceOf(A2d2Service)
  })
})
