import type { IncomingHttpHeaders } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import A2d2Service from '../src/index.ts'
import { CONFIG_ROUTE_PATH } from '../src/config-page.ts'
import { DEFAULT_STAGE_AGENTS } from '../src/stage-agents.ts'

/**
 * DSH settings key a plugin's form by its profile entry's `options.id`
 * (`describe()` reports `ns: entry.options.id`, `write()` looks entries up by
 * `options.id`). When a bundle include loads the plugin, the loader entry's own
 * `id` is the include-scoped `include:a2d2` while `options.id` stays `a2d2`, so
 * the A2D2 config page must use `options.id` as its settings namespace.
 */

const ENTRY = { id: 'include:a2d2', options: { id: 'a2d2' } }

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

class StubConnection extends Service {
  constructor(ctx: Context) {
    super(ctx, 'connection')
  }

  requestRejection(): undefined {
    return undefined
  }
}

class StubLlm extends Service {
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

/** Stands in for DSH settings: one form, registered under the entry's options.id. */
class StubSettings extends Service {
  revision = 4
  value: object = { stageAgents: DEFAULT_STAGE_AGENTS }
  readonly replace = vi.fn(async (ns: string, section: object, expectedRevision?: number) => {
    if (ns !== ENTRY.options.id) throw new Error(`No configurable plugin entry "${ns}"`)
    if (expectedRevision !== undefined && expectedRevision !== this.revision) throw new Error('conflict')
    this.value = section
    this.revision += 1
  })

  constructor(ctx: Context) {
    super(ctx, 'settings')
  }

  describe(): readonly { readonly ns: string; readonly value: unknown; readonly revision: number }[] {
    return [{ ns: ENTRY.options.id, value: this.value, revision: this.revision }]
  }

  configure(): () => void {
    return () => {}
  }
}

/** The plugin as a bundle include mounts it: the loader has stamped its entry on the fiber. */
class IncludedA2d2 extends A2d2Service {
  constructor(ctx: Context, config: ConstructorParameters<typeof A2d2Service>[1]) {
    Object.assign(ctx.fiber, { entry: ENTRY })
    super(ctx, config)
  }
}

async function mount() {
  const ctx = new Context()
  await ctx.plugin(StubLlm)
  await ctx.plugin(StubWebServer)
  await ctx.plugin(StubConnection)
  await ctx.plugin(StubSettings)
  await ctx.plugin(IncludedA2d2, {})
  await new Promise(resolve => setTimeout(resolve, 0))
  return {
    server: ctx.get('webServer') as unknown as StubWebServer,
    settings: ctx.get('settings') as unknown as StubSettings,
  }
}

async function call(handler: RouteHandler | undefined, body: unknown) {
  const headers: IncomingHttpHeaders = { host: '10.126.126.12:3710' }
  const stream = new Readable({
    read() {
      this.push(JSON.stringify(body))
      this.push(null)
    },
  })
  const captured: { status?: number; body?: string } = {}
  await handler?.(Object.assign(stream, { method: 'POST', url: CONFIG_ROUTE_PATH, headers }), {
    setHeader() {},
    writeHead(status: number) { captured.status = status },
    end(text?: string) { captured.body = text },
  })
  return { status: captured.status, json: JSON.parse(captured.body ?? 'null') as unknown }
}

describe('A2D2 settings namespace under a bundle include', () => {
  it('reads the revision from the namespace keyed by entry.options.id', async () => {
    const { server } = await mount()

    const result = await call(server.routes.get(CONFIG_ROUTE_PATH), { method: 'settings.get', payload: {} })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, value: { revision: 4 } })
  })

  it('writes through the namespace keyed by entry.options.id', async () => {
    const { server, settings } = await mount()
    const next = { ...DEFAULT_STAGE_AGENTS, consult: ['codex/gpt-6'] }

    const result = await call(server.routes.get(CONFIG_ROUTE_PATH), {
      method: 'settings.update',
      payload: { settings: next, expectedRevision: 4 },
    })

    expect(settings.replace).toHaveBeenCalledWith('a2d2', { stageAgents: next }, 4)
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, value: { revision: 5, settings: next } })
  })
})
