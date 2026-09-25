import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { foldSurface } from '@deepseek-ai/dsh-session'
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
  generateConsultOutput,
  isTrustedConsultRequest,
  parseConsultOutput,
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
const candidates = [
  { label: 'Keep going', input: 'Continue this implementation.', kind: 'stay' },
  { label: 'Hand off', input: 'Hand off the completed phase.', kind: 'handoff' },
]
const position = 'Implementation is finished; verification has not started.'
const candidatesJson = JSON.stringify({ position, candidates })

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
  return event({
    type: 'user/message',
    data: message,
    seq,
    time: seq,
    surfaceOp: 'append',
  } as SessionEvent<'user/message'>)
}

function assistantEvent(seq: number, text: string): SessionEvent {
  return event({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'provider-a', model: 'model-a' },
      }),
    },
    seq,
    time: seq,
    surfaceOp: 'append',
  } as SessionEvent<'assistant/message'>)
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
    surface: { nodes: [0] },
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

function output(text: string, reason: FinishReason = { kind: 'stop' }): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason }
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
  it('keeps only the newest current-surface messages and folds the newest route', () => {
    const events = [
      ...Array.from({ length: CONSULT_MESSAGE_LIMIT + 2 }, (_, index) => userEvent(index, `human-${String(index)}`)),
      userEvent(20, 'synthetic', 'plugin'),
      routeEvent(21, 'old-provider', 'old-model'),
      routeEvent(22, 'new-provider', 'new-model'),
    ]

    const surfaceNodes = events
      .filter(item => item.type === 'user/message' && item.data.source.kind === 'user')
      .map(item => item.seq)
    const material = collectConsultMaterial(events, surfaceNodes, [task])
    expect(material.messages).toHaveLength(CONSULT_MESSAGE_LIMIT)
    expect(material.messages[0]?.text).toBe('human-2')
    expect(material.messages.at(-1)?.text).toBe(`human-${String(CONSULT_MESSAGE_LIMIT + 1)}`)
    expect(material.messages.some(message => message.text === 'synthetic')).toBe(false)
    expect(currentConsultRoute(events)).toEqual({ provider: 'new-provider', model: 'new-model' })
  })

  it('uses the folded surface after compaction and excludes shadowed messages', () => {
    const oldUser = userEvent(0, 'private detail from the old user message')
    const oldAssistant = assistantEvent(1, 'old assistant response')
    const summary = {
      ...userEvent(2, 'current compacted summary', 'plugin'),
      surfaceOp: { op: 'replace' as const, start: 0, end: 1 },
      sourceEventSeqs: [0, 1],
    } as SessionEvent
    const events = [oldUser, oldAssistant, summary]

    const material = collectConsultMaterial(events, foldSurface(events).nodes, [])

    expect(material.messages).toEqual([{ seq: 2, text: 'current compacted summary' }])
    expect(JSON.stringify(material)).not.toContain('private detail from the old user message')
    expect(JSON.stringify(material)).not.toContain('old assistant response')
  })

  it('includes assistant text that remains on the current surface', () => {
    const events = [userEvent(0, 'current user'), assistantEvent(1, 'current assistant')]

    expect(collectConsultMaterial(events, [0, 1], []).messages).toEqual([
      { seq: 0, text: 'current user' },
      { seq: 1, text: 'current assistant' },
    ])
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
      Return only a JSON object with exactly this shape:
      {"position":"one sentence: where this session's work stands now","candidates":[2 to 4 candidates]}
      Each candidate has exactly this shape:
      {"label":"short visible label","input":"complete editable command or instruction","kind":"stay|handoff|other"}
      Write "position" in the language the session uses; it is shown above the chips as the basis for them.
      Choose kind "stay" when the action remains in this session, "handoff" when it opens a handoff, and "other" otherwise.
      Session and project material follows as JSON data:
      {"messages":[{"seq":7,"text":"Implementation is done."}],"tasks":[{"id":"consult-route","name":"Consult route","goal":"Offer next-step chips","state":"active","createdAt":"2026-09-24T00:00:00.000Z","members":[{"sessionId":"session-consult"}]}]}
      </situation-envelope>

      <ask-matt-source path="SKILL.md">
      # ASK-MATT-RAW

      Continue or hand off according to the tree.

      </ask-matt-source>

      <ask-matt-resource path="PHASE-BOUNDARIES.md">
      # PHASE-RAW

      Five exact questions.

      </ask-matt-resource>"
    `)
  })
})

describe('candidate parsing', () => {
  it('accepts a complete valid answer', () => {
    expect(parseConsultOutput(candidatesJson)).toEqual({ position, candidates })
  })

  it('trims the position line', () => {
    expect(parseConsultOutput(JSON.stringify({ position: `  ${position}\n`, candidates })).position).toBe(position)
  })

  it.each([
    ['a json fence', `\`\`\`json\n${candidatesJson}\n\`\`\``],
    ['a bare fence with surrounding whitespace', `\n\`\`\`\n${candidatesJson}\n\`\`\`\n`],
  ])('unwraps %s around the whole answer', (_name, value) => {
    expect(parseConsultOutput(value)).toEqual({ position, candidates })
  })

  it.each([
    ['not JSON', 'Here you go.'],
    ['prose around a fence', `Sure:\n\`\`\`json\n${candidatesJson}\n\`\`\``],
    ['a bare candidate array', JSON.stringify(candidates)],
    ['no position', JSON.stringify({ candidates })],
    ['a blank position', JSON.stringify({ position: '  ', candidates })],
    ['no candidates', JSON.stringify({ position })],
    ['too few candidates', JSON.stringify({ position, candidates: candidates.slice(0, 1) })],
    ['missing field', JSON.stringify({ position, candidates: [{ label: 'x', kind: 'stay' }, candidates[1]] })],
    ['invalid kind', JSON.stringify({ position, candidates: [{ label: 'x', input: 'y', kind: 'leave' }, candidates[1]] })],
  ])('rejects %s without returning a partial result', (_name, value) => {
    expect(() => parseConsultOutput(value)).toThrow(/a2d2 consult/)
  })
})

describe('consult generation finishes', () => {
  it.each([
    ['error', { kind: 'error', failure: { message: 'provider failed', code: 'PROVIDER' } }, /provider failed/u],
    ['aborted', { kind: 'aborted', failure: { message: 'request aborted', code: 'ABORTED' } }, /request aborted/u],
    ['max-tokens', { kind: 'max-tokens' }, /token limit/u],
    ['tool-calls', { kind: 'tool-calls' }, /requested a tool/u],
  ] satisfies ReadonlyArray<readonly [string, FinishReason, RegExp]>)('rejects a %s finish', async (_name, reason, message) => {
    await expect(generateConsultOutput({
      stream: () => output(candidatesJson, reason),
      route: { provider: 'provider-a', model: 'model-a' },
      sessionId,
      prompt: 'consult',
      signal: new AbortController().signal,
    })).rejects.toThrow(message)
  })
})

describe('consult request trust', () => {
  it('accepts only strict loopback authorities without a trusted-host entry', () => {
    expect(isTrustedConsultRequest({ host: '127.0.0.1' }, [])).toBe(true)
    expect(isTrustedConsultRequest({ host: '127.1.2.3:3710' }, [])).toBe(true)
    expect(isTrustedConsultRequest({ host: 'localhost:3710' }, [])).toBe(true)
    expect(isTrustedConsultRequest({ host: '::1' }, [])).toBe(true)
    expect(isTrustedConsultRequest({ host: '[::1]' }, [])).toBe(true)
    expect(isTrustedConsultRequest({ host: '[::1]:3710' }, [])).toBe(true)
  })

  it.each([
    '127.evil.example',
    '127x.example',
    '0127.0.0.1',
    '127.1',
    '127.0.0.256',
  ])('rejects the loopback lookalike %s', (host) => {
    expect(isTrustedConsultRequest({ host }, [])).toBe(false)
  })

  it('honors explicit trusted ports and lets portless entries match any port', () => {
    expect(isTrustedConsultRequest({ host: 'trusted.example:3710' }, ['trusted.example:3710'])).toBe(true)
    expect(isTrustedConsultRequest({ host: 'trusted.example:9999' }, ['trusted.example:3710'])).toBe(false)
    expect(isTrustedConsultRequest({ host: 'trusted.example' }, ['trusted.example:3710'])).toBe(false)
    expect(isTrustedConsultRequest({ host: 'trusted.example:80' }, ['trusted.example:80'])).toBe(true)
    expect(isTrustedConsultRequest({ host: 'trusted.example' }, ['trusted.example:80'])).toBe(false)
    expect(isTrustedConsultRequest({ host: 'trusted.example:9999' }, ['trusted.example'])).toBe(true)
    expect(isTrustedConsultRequest({ host: 'trusted.example' }, ['trusted.example'])).toBe(true)
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
      json: { ok: false, error: { code: 'consult-failed', message: 'The consultation could not be generated: broken ledger' } },
    })

    const malformed = dependencies({ stream: () => output('{"label":"partial"}') })
    expect(await send(createConsultHandler(malformed))).toMatchObject({
      status: 502,
      json: { ok: false, error: { code: 'malformed-candidates', message: 'The model returned malformed candidates: model output has no non-empty position' } },
    })

    const rateLimited = dependencies({
      stream: () => output('', { kind: 'error', failure: { message: 'Concurrency limit exceeded for user, please retry later', code: 'RATE_LIMIT' } } as FinishReason),
    })
    expect(await send(createConsultHandler(rateLimited))).toMatchObject({
      status: 500,
      json: { ok: false, error: { code: 'consult-failed', message: 'The consultation could not be generated: Concurrency limit exceeded for user, please retry later' } },
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
          position,
          candidates,
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
