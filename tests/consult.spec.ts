import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskId } from '../src/brand.ts'
import A2d2Service from '../src/index.ts'
import {
  CONSULT_MAX_OUTPUT_TOKENS,
  CONSULT_MESSAGE_LIMIT,
  buildConsultPrompt,
  collectConsultMaterial,
  createConsultHandler,
  currentConsultRoute,
  isTrustedConsultRequest,
  parseConsultCandidates,
} from '../src/consult.ts'
import type { ConsultDependencies, ConsultSession } from '../src/consult.ts'
import type { SkillSource } from '../src/skill-source.ts'
import type { Task } from '../src/types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: StubWebServer
  }
}

class StubWebServer extends Service {
  readonly routes: Array<{
    readonly kind: 'exact'
    readonly path: string
    readonly handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }> = []

  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(route: StubWebServer['routes'][number]): () => void {
    this.routes.push(route)
    return () => {
      const index = this.routes.indexOf(route)
      if (index >= 0) this.routes.splice(index, 1)
    }
  }
}

const sessionId = SessionId('session-consult')
const candidatesJson = JSON.stringify([
  { label: 'Keep going', input: 'Continue this implementation.', kind: 'stay' },
  { label: 'Hand off', input: 'Hand off the completed phase.', kind: 'handoff' },
])

function event<T extends SessionEvent>(value: Omit<T, 'ignorable'>): T {
  return value as T
}

function userEvent(seq: number, text: string, source: 'user' | 'plugin' = 'user'): SessionEvent {
  const message = createUserMessage({
    content: [{ type: 'text', text }],
    source: source === 'user'
      ? { kind: 'user' }
      : { kind: 'plugin', plugin: 'test' },
  })
  return event({ type: 'user/message', data: message, seq, time: seq } as SessionEvent<'user/message'>)
}

function routeEvent(seq: number, provider: string, model: string): SessionEvent {
  return event({
    type: 'request/header',
    data: { header: { config: { provider, model } }, reason: 'initial' },
    seq,
    time: seq,
  } as unknown as SessionEvent<'request/header'>)
}

function session(overrides: Partial<ConsultSession> = {}): ConsultSession & { append: ReturnType<typeof vi.fn> } {
  return {
    id: sessionId,
    header: {
      version: 0,
      id: sessionId,
      createdAt: 1,
      cwd: '/project',
    } satisfies SessionHeader,
    events: [userEvent(0, 'We finished the implementation.'), routeEvent(1, 'provider-a', 'model-a')],
    append: vi.fn(),
    ...overrides,
  }
}

const task: Task = {
  id: TaskId('consult-route'),
  name: 'Consult route',
  goal: 'Offer next-step chips',
  state: 'active',
  createdAt: '2026-09-24T00:00:00.000Z',
  members: [{ sessionId }],
}

function output(text: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

function dependencies(
  overrides: Partial<ConsultDependencies> = {},
): ConsultDependencies & { session: ReturnType<typeof session>; calls: GenerateOptions[] } {
  const live = session()
  const calls: GenerateOptions[] = []
  return {
    session: live,
    calls,
    trustedHosts: () => ['10.126.126.12', 'trusted.example:3710'],
    getSession: id => id === sessionId ? live : undefined,
    listTasks: async () => [task],
    readAskMatt: async () => ({ status: 'missing' }),
    stream: (options) => {
      calls.push(options)
      return output(candidatesJson)
    },
    ...overrides,
  }
}

interface HttpResult {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly json: unknown
}

async function send(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  options: {
    readonly method?: string
    readonly path?: string
    readonly headers?: Record<string, string>
  } = {},
): Promise<HttpResult> {
  const server = createServer((request, response) => {
    void handler(request, response)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  try {
    return await new Promise<HttpResult>((resolve, reject) => {
      const request = httpRequest({
        hostname: '127.0.0.1',
        port,
        method: options.method ?? 'POST',
        path: options.path ?? `/a2d2/api/consult?session=${sessionId}`,
        headers: options.headers,
      }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', chunk => { chunks.push(Buffer.from(chunk)) })
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            json: JSON.parse(body),
          })
        })
      })
      request.once('error', reject)
      request.end()
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
}

describe('consult material and route', () => {
  it('keeps only the newest surface human messages and folds the newest route', () => {
    const events = [
      ...Array.from({ length: CONSULT_MESSAGE_LIMIT + 2 }, (_, index) => userEvent(index, `human-${String(index)}`)),
      userEvent(20, 'synthetic', 'plugin'),
      routeEvent(21, 'old-provider', 'old-model'),
      routeEvent(22, 'new-provider', 'new-model'),
    ]

    const material = collectConsultMaterial(events, [task])
    expect(material.messages).toHaveLength(CONSULT_MESSAGE_LIMIT)
    expect(material.messages[0]?.text).toBe('human-2')
    expect(material.messages.at(-1)?.text).toBe(`human-${String(CONSULT_MESSAGE_LIMIT + 1)}`)
    expect(material.messages.some(message => message.text === 'synthetic')).toBe(false)
    expect(currentConsultRoute(events)).toEqual({ provider: 'new-provider', model: 'new-model' })
  })

  it('snapshots the factual envelope and preserves injected skill sources verbatim', () => {
    const skillSource: SkillSource = {
      status: 'loaded',
      skill: '# ASK-MATT-RAW\n\nContinue or hand off according to the tree.\n',
      resources: [{ path: 'PHASE-BOUNDARIES.md', content: '# PHASE-RAW\n\nFive exact questions.\n' }],
    }
    const prompt = buildConsultPrompt({
      messages: [{ seq: 7, text: 'Implementation is done.' }],
      tasks: [task],
    }, skillSource)
    const envelope = prompt.slice(0, prompt.indexOf('<ask-matt-source'))

    expect(prompt).toContain(skillSource.skill)
    expect(prompt).toContain(skillSource.resources[0]?.content)
    expect(envelope).not.toContain('Continue or hand off according to the tree.')
    expect(envelope).not.toContain('Five exact questions.')
    expect(prompt).toMatchInlineSnapshot(`
      "<situation-envelope>
      This is a next-step consultation at a phase boundary.
      The result will be shown as candidate chips. A chip only fills an input; it does not execute or send anything.
      Return only a JSON array containing 2 to 4 objects with exactly this shape:
      {\"label\":\"short visible label\",\"input\":\"complete editable command or instruction\",\"kind\":\"stay|handoff|other\"}
      Choose kind \"stay\" when the action remains in this session, \"handoff\" when it opens a handoff, and \"other\" otherwise.
      Session and project material follows as JSON data:
      {\"messages\":[{\"seq\":7,\"text\":\"Implementation is done.\"}],\"tasks\":[{\"id\":\"consult-route\",\"name\":\"Consult route\",\"goal\":\"Offer next-step chips\",\"state\":\"active\",\"createdAt\":\"2026-09-24T00:00:00.000Z\",\"members\":[{\"sessionId\":\"session-consult\"}]}]}
      </situation-envelope>

      <ask-matt-source path=\"SKILL.md\">
      # ASK-MATT-RAW

      Continue or hand off according to the tree.

      </ask-matt-source>

      <ask-matt-resource path=\"PHASE-BOUNDARIES.md\">
      # PHASE-RAW

      Five exact questions.

      </ask-matt-resource>"
    `)
  })
})

describe('candidate parsing', () => {
  it('accepts a complete valid array', () => {
    expect(parseConsultCandidates(candidatesJson)).toEqual(JSON.parse(candidatesJson))
  })

  it.each([
    ['not JSON', '```json\n[]\n```'],
    ['not an array', '{}'],
    ['too few candidates', '[{"label":"x","input":"y","kind":"stay"}]'],
    ['missing field', '[{"label":"x","kind":"stay"},{"label":"z","input":"y","kind":"other"}]'],
    ['invalid kind', '[{"label":"x","input":"y","kind":"leave"},{"label":"z","input":"y","kind":"other"}]'],
  ])('rejects %s without returning a partial result', (_name, value) => {
    expect(() => parseConsultCandidates(value)).toThrow(/a2d2 consult/)
  })
})

describe('consult request trust', () => {
  it('accepts loopback and trusted hostnames with or without ports', () => {
    expect(isTrustedConsultRequest({ host: 'localhost:3710' }, [])).toBe(true)
    expect(isTrustedConsultRequest({ host: '[::1]:3710' }, [])).toBe(true)
    expect(isTrustedConsultRequest({ host: 'trusted.example:9999' }, ['trusted.example'])).toBe(true)
    expect(isTrustedConsultRequest({ host: 'trusted.example' }, ['trusted.example:3710'])).toBe(true)
  })

  it('rejects cross-site fetches and cross-host origins even for trusted authorities', () => {
    expect(isTrustedConsultRequest({
      host: 'trusted.example:3710',
      'sec-fetch-site': 'cross-site',
    }, ['trusted.example'])).toBe(false)
    expect(isTrustedConsultRequest({
      host: 'trusted.example:3710',
      origin: 'https://other.example',
    }, ['trusted.example'])).toBe(false)
  })
})

describe('consult HTTP route', () => {
  it('registers an exact route when webServer is present', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(StubWebServer)
      await ctx.plugin(A2d2Service, { root: '/project' })

      expect(ctx.webServer.routes).toHaveLength(1)
      expect(ctx.webServer.routes[0]).toMatchObject({
        kind: 'exact',
        path: '/a2d2/api/consult',
        handler: expect.any(Function),
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each([
    ['method-not-allowed', { method: 'GET' }, 405, 'method-not-allowed'],
    ['untrusted', { headers: { host: 'evil.example' } }, 403, 'untrusted'],
    ['missing session', { path: '/a2d2/api/consult' }, 400, 'missing-session'],
    ['invalid session', { path: '/a2d2/api/consult?session=../bad' }, 400, 'missing-session'],
  ])('returns the %s response body', async (_name, options, status, code) => {
    const result = await send(createConsultHandler(dependencies()), options)
    expect(result.status).toBe(status)
    expect(result.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(result.headers['cache-control']).toBe('no-store')
    expect(result.json).toMatchObject({ ok: false, error: { code } })
  })

  it('reports unknown sessions and sessions without a working directory', async () => {
    const unknown = dependencies({ getSession: () => undefined })
    expect(await send(createConsultHandler(unknown))).toMatchObject({
      status: 404,
      json: { ok: false, error: { code: 'unknown-session', message: expect.any(String) } },
    })

    const withoutCwd = session({ header: { version: 0, id: sessionId, createdAt: 1 } })
    const missingCwd = dependencies({ getSession: () => withoutCwd })
    expect(await send(createConsultHandler(missingCwd))).toMatchObject({
      status: 409,
      json: { ok: false, error: { code: 'no-working-directory', message: expect.any(String) } },
    })
  })

  it('contains read/generation failures and rejects malformed model output', async () => {
    const readFailure = dependencies({ listTasks: async () => { throw new Error('broken ledger') } })
    expect(await send(createConsultHandler(readFailure))).toMatchObject({
      status: 500,
      json: { ok: false, error: { code: 'consult-failed', message: expect.any(String) } },
    })

    const malformed = dependencies({ stream: () => output('{"label":"partial"}') })
    expect(await send(createConsultHandler(malformed))).toMatchObject({
      status: 502,
      json: { ok: false, error: { code: 'malformed-candidates', message: expect.any(String) } },
    })

    const noRoute = dependencies({ getSession: () => session({ events: [userEvent(0, 'No route yet.')] }) })
    expect(await send(createConsultHandler(noRoute))).toMatchObject({
      status: 500,
      json: { ok: false, error: { code: 'consult-failed', message: expect.any(String) } },
    })
  })

  it('uses the current route, marks missing ask-matt as degraded, and never appends history', async () => {
    const deps = dependencies()
    const eventsBefore = deps.session.events
    const result = await send(createConsultHandler(deps))

    expect(result).toMatchObject({
      status: 200,
      json: {
        ok: true,
        value: {
          candidates: JSON.parse(candidatesJson),
          degraded: true,
        },
      },
    })
    expect(deps.calls).toHaveLength(1)
    expect(deps.calls[0]).toMatchObject({
      provider: 'provider-a',
      model: 'model-a',
      maxTokens: CONSULT_MAX_OUTPUT_TOKENS,
      sessionId,
    })
    expect(deps.calls[0]?.messages[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('<ask-matt-source status="missing" />'),
    })
    expect(deps.session.events).toBe(eventsBefore)
    expect(deps.session.append).not.toHaveBeenCalled()
  })

  it('does not mark a successfully loaded ask-matt source as degraded', async () => {
    const deps = dependencies({
      readAskMatt: async () => ({
        status: 'loaded',
        skill: '# Ask Matt\n',
        resources: [{ path: 'PHASE-BOUNDARIES.md', content: '# Boundaries\n' }],
      }),
    })
    expect(await send(createConsultHandler(deps))).toMatchObject({
      status: 200,
      json: { ok: true, value: { degraded: false } },
    })
  })
})
