import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { foldSurface } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { TaskId } from '../src/brand.ts'
import A2d2Service from '../src/index.ts'
import { A2D2_MESSAGE_SOURCE } from '../src/message-source.ts'
import {
  CONSULT_MAX_OUTPUT_TOKENS,
  CONSULT_MESSAGE_LIMIT,
  buildConsultPrompt,
  checkProjectPreconditions,
  collectConsultMaterial,
  createConsultHandler,
  currentConsultRoute,
  generateConsultOutput,
  isTrustedConsultRequest,
  parseConsultOutput,
} from '../src/consult.ts'
import type { ConsultDependencies, ConsultSession } from '../src/consult.ts'
import { DEFAULT_STAGE_AGENTS } from '../src/stage-agents.ts'
import type { SkillSource } from '../src/skill-source.ts'
import type { Task } from '../src/types.ts'

const anthropicUsagePolicyRefusal = "This request triggered restrictions on violative cyber content and was blocked under Anthropic's Usage Policy. To learn more, see https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback."

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

class StubSessions extends Service {
  live: ConsultSession | undefined

  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  get(id: SessionId): ConsultSession | undefined {
    return id === sessionId ? this.live : undefined
  }
}

class StubLlm extends Service {
  readonly calls: GenerateOptions[] = []

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    return output(candidatesJson)
  }
}

const sessionId = SessionId('session-consult')
const candidates = [
  { label: 'Keep going', input: 'Continue this implementation.', move: 'continue', station: 'to-spec' },
  { label: 'Review elsewhere', input: 'Ask a reviewer subagent.', move: 'subagent', station: 'code-review' },
]
const position = 'Implementation is finished; verification has not started.'
const location = { zone: 'main', station: 'grill', phaseDone: true }
const next = { station: 'to-spec', move: 'continue', reason: 'the spec needs current context' }
const candidatesJson = JSON.stringify({ position, location, next, candidates })
const ceoValidation = { stageAgents: DEFAULT_STAGE_AGENTS, sessionAgent: 'ceo' as const }
if (false) {
  // @ts-expect-error parseConsultOutput callers must supply validation context.
  parseConsultOutput(candidatesJson)
}
const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-consult-'))
  roots.push(root)
  return root
}

async function writeProjectFile(root: string, path: string): Promise<void> {
  const filename = join(root, path)
  await mkdir(dirname(filename), { recursive: true })
  await writeFile(filename, 'ok\n')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function event<T extends SessionEvent>(value: Omit<T, 'ignorable'>): T {
  return value as T
}

function userEvent(seq: number, text: string, source: 'user' | 'plugin' = 'user'): SessionEvent {
  const message = createUserMessage({
    content: [{ type: 'text', text }],
    source: source === 'user' ? { kind: 'user' } : A2D2_MESSAGE_SOURCE,
  })
  return event({
    type: 'user/message',
    data: message,
    seq: SessionSeq(seq),
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
    seq: SessionSeq(seq),
    time: seq,
    surfaceOp: 'append',
  } as SessionEvent<'assistant/message'>)
}

function routeEvent(seq: number, provider: string, model: string): SessionEvent {
  return event({
    type: 'request/header',
    data: { header: { config: { provider, model } }, reason: 'initial' },
    seq: SessionSeq(seq),
    time: seq,
  } as unknown as SessionEvent<'request/header'>)
}

function header(fields: { readonly cwd?: string } = {}): SessionHeader {
  return { version: 4, id: sessionId, createdAt: 1, isSeeded: false, ...fields }
}

function session(overrides: Partial<ConsultSession> = {}): ConsultSession & { append: ReturnType<typeof vi.fn> } {
  const events = [userEvent(0, 'We finished the implementation.'), routeEvent(1, 'provider-a', 'model-a')]
  return {
    id: sessionId,
    header: header({ cwd: '/project' }),
    eventAt: seq => events[seq],
    surface: { nodes: [SessionSeq(0)] },
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
    projectRoot: async cwd => cwd,
    checkPreconditions: async () => ({ missing: [] }),
    readAskMatt: async () => ({ status: 'missing' }),
    getStageAgents: () => DEFAULT_STAGE_AGENTS,
    agentOfSession: async () => 'ceo',
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
    const material = collectConsultMaterial(seq => events[seq], surfaceNodes, [task])
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
      surfaceOp: { op: 'replace' as const, startSeq: SessionSeq(0), endSeq: SessionSeq(1) },
      sourceEventSeqs: [SessionSeq(0), SessionSeq(1)],
    } as SessionEvent
    const events = [oldUser, oldAssistant, summary]

    const material = collectConsultMaterial(seq => events[seq], foldSurface(events).nodes, [])

    expect(material.messages).toEqual([{ seq: 2, text: 'current compacted summary' }])
    expect(JSON.stringify(material)).not.toContain('private detail from the old user message')
    expect(JSON.stringify(material)).not.toContain('old assistant response')
  })

  it('includes assistant text that remains on the current surface', () => {
    const events = [userEvent(0, 'current user'), assistantEvent(1, 'current assistant')]

    expect(collectConsultMaterial(seq => events[seq], [SessionSeq(0), SessionSeq(1)], []).messages).toEqual([
      { seq: 0, text: 'current user' },
      { seq: 1, text: 'current assistant' },
    ])
  })

  it.each([
    ['both missing', false, false, ['context', 'issue-tracker']],
    ['only context present', true, false, ['issue-tracker']],
    ['only issue tracker present', false, true, ['context']],
    ['both present', true, true, []],
  ])('checks Matt setup preconditions for %s', async (_name, hasContext, hasIssueTracker, missing) => {
    const root = await tempRoot()
    if (hasContext) await writeProjectFile(root, 'CONTEXT.md')
    if (hasIssueTracker) await writeProjectFile(root, 'docs/agents/issue-tracker.md')

    expect((await checkProjectPreconditions(root)).missing.map(item => item.id)).toEqual(missing)
  })

  it('accepts CONTEXT-MAP.md as the context precondition', async () => {
    const root = await tempRoot()
    await writeProjectFile(root, 'CONTEXT-MAP.md')
    await writeProjectFile(root, 'docs/agents/issue-tracker.md')

    expect(await checkProjectPreconditions(root)).toEqual({ missing: [] })
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
      preconditions: {
        missing: [{
          id: 'context',
          label: 'CONTEXT.md or CONTEXT-MAP.md',
          paths: ['CONTEXT.md', 'CONTEXT-MAP.md'],
        }],
      },
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
      {"position":"one sentence: where this session's work stands now","location":{"zone":"main|service|ramp|standalone|roadbed|off-road","station":"station id except off-road","returnTo":"main station, required only for service","phaseDone":true},"next":{"station":"next station id","move":"continue|clear|handoff|subagent|compact","reason":"why this move fits"},"candidates":[2 to 4 candidates]}
      Each candidate has exactly this shape:
      {"label":"short visible label","input":"complete editable command or instruction","move":"continue|clear|handoff|subagent|compact","station":"optional target station id"}
      If location.phaseDone is false, next.move and every candidate.move must be continue or subagent.
      If location.phaseDone is true, a continue move is allowed only when the target station Agent equals this session Agent; when this session has no Agent, do not use continue across a phase boundary.
      Write "position" in the language the session uses; it is shown above the chips as the basis for them.
      Location values are closed except standalone station names. Use the highway catalog exactly as listed here:
      {"zones":["main","service","ramp","standalone","roadbed","off-road"],"main":["grill","to-spec","to-tickets","implement","code-review"],"service":["prototype","handoff"],"ramp":{"triage":"implement","diagnosing-bugs":"implement","wayfinder":"to-spec","improve-codebase-architecture":"grill"},"roadbed":["domain-modeling","codebase-design"]}
      Stage Agent table:
      {"stages":{"grill":"ceo","to-spec":"ceo","to-tickets":"ceo","prototype":"ceo","handoff":"ceo","triage":"ceo","diagnosing-bugs":"ceo","wayfinder":"ceo","improve-codebase-architecture":"ceo","domain-modeling":"ceo","codebase-design":"ceo","implement":"engineer","code-review":"reviewer"},"agents":{"ceo":["claude-bray/claude-fable-5-1","codex/gpt-6"],"engineer":["codex/gpt-5.5","claude-bray/claude-opus-5-5"],"reviewer":["claude-bray/claude-fable-5-1","codex/gpt-6"]}}
      This session Agent (null means no Agent is recorded for this session):
      null
      Current context and smart zone facts:
      {"status":"unavailable"}
      Project preconditions checked by the host:
      {"missing":[{"id":"context","label":"CONTEXT.md or CONTEXT-MAP.md","paths":["CONTEXT.md","CONTEXT-MAP.md"]}]}
      Session and project material follows as JSON data:
      {"messages":[{"seq":7,"text":"Implementation is done."}],"tasks":[{"id":"consult-route","name":"Consult route","goal":"Offer next-step chips","state":"active","createdAt":"2026-09-24T00:00:00.000Z","members":[{"sessionId":"session-consult"}]}],"preconditions":{"missing":[{"id":"context","label":"CONTEXT.md or CONTEXT-MAP.md","paths":["CONTEXT.md","CONTEXT-MAP.md"]}]}}
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

describe('next-step consult without orchestration skill coupling', () => {
  it('keeps the consult envelope and chips independent of installed a2d2-orchestrator content', async () => {
    const deps = dependencies()

    const result = await send(createConsultHandler(deps))

    expect(result).toMatchObject({ status: 200, json: { ok: true, value: { candidates } } })
    expect(deps.calls[0]?.messages[0]?.content[0]).toMatchObject({
      text: expect.not.stringContaining('a2d2-orchestrator'),
    })
    expect(deps.calls[0]?.messages[0]?.content[0]).toMatchObject({
      text: expect.not.stringContaining('编排实施全部工单'),
    })
  })
})

describe('candidate parsing', () => {
  it('accepts a complete valid answer', () => {
    expect(parseConsultOutput(candidatesJson, ceoValidation)).toEqual({ position, location, next, candidates })
  })

  it('trims the position line', () => {
    expect(parseConsultOutput(JSON.stringify({ position: `  ${position}\n`, location, next, candidates }), ceoValidation).position).toBe(position)
  })

  it.each([
    ['a json fence', `\`\`\`json\n${candidatesJson}\n\`\`\``],
    ['a bare fence with surrounding whitespace', `\n\`\`\`\n${candidatesJson}\n\`\`\`\n`],
  ])('unwraps %s around the whole answer', (_name, value) => {
    expect(parseConsultOutput(value, ceoValidation)).toEqual({ position, location, next, candidates })
  })

  it('maps legacy candidate kind values for one compatibility version', () => {
    expect(parseConsultOutput(JSON.stringify({
      position,
      location,
      next: { station: 'to-spec', move: 'continue', reason: 'continue in place' },
      candidates: [
        { label: 'Stay', input: 'Keep going.', kind: 'stay', station: 'to-spec' },
        { label: 'Other', input: 'Keep going differently.', kind: 'other', station: 'to-spec' },
      ],
    }), ceoValidation).candidates).toEqual([
      { label: 'Stay', input: 'Keep going.', move: 'continue', station: 'to-spec' },
      { label: 'Other', input: 'Keep going differently.', move: 'continue', station: 'to-spec' },
    ])
  })

  it.each([
    ['not JSON', 'Here you go.'],
    ['prose around a fence', `Sure:\n\`\`\`json\n${candidatesJson}\n\`\`\``],
    ['a bare candidate array', JSON.stringify(candidates)],
    ['no position', JSON.stringify({ candidates })],
    ['a blank position', JSON.stringify({ position: '  ', location, next, candidates })],
    ['no location', JSON.stringify({ position, next, candidates })],
    ['invalid zone', JSON.stringify({ position, location: { zone: 'space', station: 'grill', phaseDone: true }, next, candidates })],
    ['invalid main station', JSON.stringify({ position, location: { zone: 'main', station: 'prototype', phaseDone: true }, next, candidates })],
    ['service without returnTo', JSON.stringify({ position, location: { zone: 'service', station: 'prototype', phaseDone: true }, next, candidates })],
    ['invalid returnTo', JSON.stringify({ position, location: { zone: 'service', station: 'prototype', returnTo: 'prototype', phaseDone: true }, next, candidates })],
    ['invalid move', JSON.stringify({ position, location, next: { station: 'to-spec', move: 'teleport', reason: 'x' }, candidates })],
    ['phase not done with boundary next', JSON.stringify({ position, location: { ...location, phaseDone: false }, next: { station: 'to-spec', move: 'handoff', reason: 'x' }, candidates: [{ ...candidates[0], move: 'handoff' }, candidates[1]] })],
    ['phase not done with boundary candidate', JSON.stringify({ position, location: { ...location, phaseDone: false }, next: { station: 'to-spec', move: 'continue', reason: 'x' }, candidates: [candidates[0], { ...candidates[1], move: 'clear' }] })],
    ['first candidate disagrees with next move', JSON.stringify({ position, location, next: { station: 'to-spec', move: 'subagent', reason: 'x' }, candidates })],
    ['no candidates', JSON.stringify({ position, location, next })],
    ['too few candidates', JSON.stringify({ position, location, next, candidates: candidates.slice(0, 1) })],
    ['missing field', JSON.stringify({ position, location, next, candidates: [{ label: 'x', move: 'continue' }, candidates[1]] })],
  ])('rejects %s without returning a partial result', (_name, value) => {
    expect(() => parseConsultOutput(value, ceoValidation)).toThrow(/a2d2 consult/)
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
      validation: ceoValidation,
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

      expect(ctx.webServer.routes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'exact',
          path: '/a2d2/api/consult',
          handler: expect.any(Function),
        }),
        expect.objectContaining({
          kind: 'exact',
          path: '/a2d2/api/config',
          handler: expect.any(Function),
        }),
      ]))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('checks preconditions in the cwd project even when task storage has a fixed root', async () => {
    const fixedRoot = await tempRoot()
    const projectRoot = await tempRoot()
    await mkdir(join(projectRoot, '.git'), { recursive: true })
    await writeProjectFile(projectRoot, 'CONTEXT.md')
    await writeProjectFile(projectRoot, 'docs/agents/issue-tracker.md')
    const cwd = join(projectRoot, 'nested')
    await mkdir(cwd, { recursive: true })
    const ctx = new Context()
    try {
      await ctx.plugin(StubWebServer)
      await ctx.plugin(StubSessions)
      await ctx.plugin(StubLlm)
      ;(ctx.get('sessions') as unknown as StubSessions).live = session({ header: header({ cwd }) })
      await ctx.plugin(A2d2Service, { root: fixedRoot })
      await ctx.a2d2.bindMainSession({ cwd, issue: 74, mainSession: sessionId, now: new Date('2026-10-02T00:00:00.000Z') })

      const handler = ctx.webServer.routes[0]?.handler
      expect(handler).toBeDefined()
      const result = await send(handler as (request: IncomingMessage, response: ServerResponse) => Promise<void>)

      expect(result).toMatchObject({
        status: 200,
        json: {
          ok: true,
          value: {
            preconditions: { missing: [] },
            candidates,
          },
        },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not read a2d2-orchestrator or fall back to the former ceo-team skill when publishing the route', async () => {
    const fixedRoot = await tempRoot()
    const skillsRoot = await tempRoot()
    await writeProjectFile(skillsRoot, 'ask-matt/SKILL.md')
    await writeProjectFile(skillsRoot, 'a2d2-orchestrator/SKILL.md')
    await writeProjectFile(skillsRoot, 'ceo-team/SKILL.md')
    await writeFile(join(skillsRoot, 'ask-matt', 'SKILL.md'), '---\nname: ask-matt\ndescription: Matt workflow\n---\n\n# ask matt\n')
    await writeFile(join(skillsRoot, 'a2d2-orchestrator', 'SKILL.md'), '---\nname: a2d2-orchestrator\ndescription: active orchestration skill\n---\n\n# orchestration body\n')
    await writeFile(join(skillsRoot, 'ceo-team', 'SKILL.md'), '---\nname: ceo-team\ndescription: legacy orchestration skill\n---\n\n# legacy body\n')
    const ctx = new Context()
    try {
      await ctx.plugin(StubWebServer)
      await ctx.plugin(StubSessions)
      await ctx.plugin(StubLlm)
      ;(ctx.get('sessions') as unknown as StubSessions).live = session({ header: header({ cwd: fixedRoot }) })
      await ctx.plugin(A2d2Service, { root: fixedRoot, skillsRoot })
      await ctx.a2d2.bindMainSession({ cwd: fixedRoot, issue: 75, mainSession: sessionId, now: new Date('2026-10-02T00:00:00.000Z') })

      const handler = ctx.webServer.routes[0]?.handler
      expect(handler).toBeDefined()
      const result = await send(handler as (request: IncomingMessage, response: ServerResponse) => Promise<void>)
      const llm = ctx.get('llm') as unknown as StubLlm

      expect(result).toMatchObject({ status: 200, json: { ok: true } })
      expect(llm.calls[0]?.messages[0]?.content[0]).toMatchObject({
        text: expect.not.stringContaining('active orchestration skill'),
      })
      expect(llm.calls[0]?.messages[0]?.content[0]).toMatchObject({
        text: expect.not.stringContaining('legacy orchestration skill'),
      })
      expect(llm.calls[0]?.messages[0]?.content[0]).toMatchObject({
        text: expect.not.stringContaining('ceo-team'),
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

    const withoutCwd = session({ header: header() })
    const missingCwd = dependencies({ getSession: () => withoutCwd })
    expect(await send(createConsultHandler(missingCwd))).toMatchObject({
      status: 409,
      json: { ok: false, error: { code: 'no-working-directory', message: expect.any(String) } },
    })
  })

  it('contains read/generation failures and rejects malformed model output without trying the next candidate', async () => {
    const readFailure = dependencies({ listTasks: async () => { throw new Error('broken ledger') } })
    expect(await send(createConsultHandler(readFailure))).toMatchObject({
      status: 500,
      json: { ok: false, error: { code: 'consult-failed', message: 'The consultation could not be generated: broken ledger' } },
    })

    const malformed = dependencies({
      getStageAgents: () => ({
        ...DEFAULT_STAGE_AGENTS,
        consult: ['primary/model', 'backup/model'],
      }),
      stream: (options) => {
        malformed.calls.push(options)
        return options.model === 'backup/model' ? output(candidatesJson) : output('{"label":"partial"}')
      },
    })
    expect(await send(createConsultHandler(malformed))).toMatchObject({
      status: 502,
      json: { ok: false, error: { code: 'malformed-candidates', message: 'The model returned malformed candidates: model output has no non-empty position' } },
    })
    expect(malformed.calls.map(call => `${call.provider}/${call.model}`)).toEqual(['primary/model'])

    const rateLimited = dependencies({
      getStageAgents: () => ({
        ...DEFAULT_STAGE_AGENTS,
        consult: ['primary/model'],
      }),
      stream: () => output('', { kind: 'error', failure: { message: 'Concurrency limit exceeded for user, please retry later', code: 'RATE_LIMIT' } } as FinishReason),
    })
    expect(await send(createConsultHandler(rateLimited))).toMatchObject({
      status: 500,
      json: {
        ok: false,
        error: {
          code: 'consult-failed',
          message: 'The consultation could not be generated: every consult route failed (primary/model: Concurrency limit exceeded for user, please retry later)',
        },
      },
    })
  })

  it('uses the consult route list, marks missing ask-matt as degraded, and never appends history', async () => {
    const deps = dependencies()
    const result = await send(createConsultHandler(deps))

    expect(result).toMatchObject({
      status: 200,
      json: {
        ok: true,
        value: {
          position,
          candidates,
          preconditions: { missing: [] },
          degraded: true,
          answeredBy: 'claude-bray/claude-fable-5-1',
          fallbacks: [],
          sessionAgent: 'ceo',
          stageAgents: {
            stages: DEFAULT_STAGE_AGENTS.stages,
            agents: DEFAULT_STAGE_AGENTS.agents,
          },
        },
      },
    })
    expect((result.json as { value?: unknown }).value).not.toHaveProperty('stationModels')
    expect(deps.calls).toHaveLength(1)
    expect(deps.calls[0]).toMatchObject({
      provider: 'claude-bray',
      model: 'claude-fable-5-1',
      maxTokens: CONSULT_MAX_OUTPUT_TOKENS,
      sessionId,
    })
    expect(deps.calls[0]?.messages[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('<ask-matt-source status="missing" />'),
    })
    expect(deps.session.append).not.toHaveBeenCalled()
  })

  it('rejects a cross-phase continue when the session has no Agent', async () => {
    const deps = dependencies({ agentOfSession: async () => undefined })

    expect(await send(createConsultHandler(deps))).toMatchObject({
      status: 502,
      json: {
        ok: false,
        error: {
          code: 'malformed-candidates',
          message: expect.stringContaining('session has no Agent'),
        },
      },
    })
  })

  it('rejects a CEO session continuing into an engineer stage', async () => {
    const deps = dependencies({
      stream: () => output(JSON.stringify({
        position,
        location,
        next: { station: 'implement', move: 'continue', reason: 'start implementation' },
        candidates: [
          { label: '实现', input: '/implement #15', move: 'continue', station: 'implement' },
          { label: '派代理', input: '让工程师实现 #15', move: 'subagent', station: 'implement' },
        ],
      })),
    })

    expect(await send(createConsultHandler(deps))).toMatchObject({
      status: 502,
      json: {
        ok: false,
        error: {
          code: 'malformed-candidates',
          message: expect.stringContaining('target Agent engineer differs from this session Agent ceo'),
        },
      },
    })
  })

  it('checks a continuing candidate against its own station when present', async () => {
    const deps = dependencies({
      stream: () => output(JSON.stringify({
        position,
        location,
        next: { station: 'to-spec', move: 'clear', reason: 'open a clean spec session' },
        candidates: [
          { label: '开规格会话', input: '/to-spec', move: 'clear', station: 'to-spec' },
          { label: '直接实现', input: '/implement #15', move: 'continue', station: 'implement' },
        ],
      })),
    })

    expect(await send(createConsultHandler(deps))).toMatchObject({
      status: 502,
      json: {
        ok: false,
        error: {
          code: 'malformed-candidates',
          message: expect.stringContaining('candidate 1 move cannot continue to implement'),
        },
      },
    })
  })

  it('treats standalone skill targets as CEO stages for continue validation', async () => {
    const deps = dependencies({
      stream: () => output(JSON.stringify({
        position,
        location: { zone: 'standalone', station: 'research', phaseDone: true },
        next: { station: 'research', move: 'continue', reason: 'standalone skills stay with CEO' },
        candidates: [
          { label: '继续 research', input: '/research', move: 'continue', station: 'research' },
          { label: '开新会话', input: '/research fresh', move: 'clear', station: 'research' },
        ],
      })),
    })

    expect(await send(createConsultHandler(deps))).toMatchObject({
      status: 200,
      json: { ok: true, value: { sessionAgent: 'ceo' } },
    })
  })

  it.each([
    ['case variant of a closed station', 'Implement'],
    ['closed station with an invisible suffix', 'implement\u200b'],
    ['prototype-chain property name', 'constructor'],
  ])('rejects a continuing next station that is a %s', (_name, station) => {
    expect(() => parseConsultOutput(JSON.stringify({
      position,
      location,
      next: { station, move: 'continue', reason: 'start implementation' },
      candidates: [
        { label: '继续', input: `/${station}`, move: 'continue', station },
        { label: '派代理', input: 'delegate implementation', move: 'subagent', station },
      ],
    }), ceoValidation)).toThrow(/a2d2 consult/)
  })

  it('continues legal standalone skill targets as CEO stages', () => {
    expect(parseConsultOutput(JSON.stringify({
      position,
      location: { zone: 'standalone', station: 'research', phaseDone: true },
      next: { station: 'research', move: 'continue', reason: 'standalone skills stay with CEO' },
      candidates: [
        { label: '继续 research', input: '/research', move: 'continue', station: 'research' },
        { label: '开新会话', input: '/research fresh', move: 'clear', station: 'research' },
      ],
    }), ceoValidation)).toMatchObject({
      location: { zone: 'standalone', station: 'research', phaseDone: true },
      next: { station: 'research', move: 'continue' },
    })
  })

  it('rejects off-road continue candidates without next when the session has no Agent', async () => {
    const deps = dependencies({
      agentOfSession: async () => undefined,
      stream: () => output(JSON.stringify({
        position: 'This session is not on the Matt highway yet.',
        location: { zone: 'off-road', phaseDone: true },
        candidates: [
          { label: '继续当前会话', input: 'continue here', move: 'continue' },
          { label: '派代理整理', input: 'summarize context', move: 'subagent' },
        ],
      })),
    })

    expect(await send(createConsultHandler(deps))).toMatchObject({
      status: 502,
      json: {
        ok: false,
        error: {
          code: 'malformed-candidates',
          message: expect.stringContaining('session has no Agent'),
        },
      },
    })
  })

  it('allows continue while phaseDone is false even when the session has no Agent', async () => {
    const deps = dependencies({
      agentOfSession: async () => undefined,
      stream: () => output(JSON.stringify({
        position,
        location: { ...location, phaseDone: false },
        next: { station: 'implement', move: 'continue', reason: 'finish the current phase first' },
        candidates: [
          { label: '继续', input: 'finish the current phase', move: 'continue', station: 'implement' },
          { label: '派代理', input: 'delegate a side task', move: 'subagent', station: 'implement' },
        ],
      })),
    })

    const result = await send(createConsultHandler(deps))
    expect(result).toMatchObject({
      status: 200,
      json: { ok: true },
    })
    expect((result.json as { value?: unknown }).value).not.toHaveProperty('sessionAgent')
  })

  it('adds preconditions to the response and prompt, and forces the setup chip to the top when anything is missing', async () => {
    const deps = dependencies({
      projectRoot: async () => '/project-root',
      checkPreconditions: async () => ({
        missing: [{
          id: 'issue-tracker',
          label: 'docs/agents/issue-tracker.md',
          paths: ['docs/agents/issue-tracker.md'],
        }],
      }),
      stream: (options) => {
        deps.calls.push(options)
        return output(JSON.stringify({
          position,
          location,
          next: { station: 'to-spec', move: 'clear', reason: '需要干净会话' },
          candidates: [
            { label: '开 spec 会话', input: '/to-spec', move: 'clear', station: 'to-spec' },
            { label: '派代理', input: '整理验收', move: 'subagent', station: 'to-spec' },
            { label: '交接', input: 'handoff spec', move: 'handoff', station: 'handoff' },
            { label: '压缩', input: 'compact spec', move: 'compact', station: 'to-spec' },
          ],
        }))
      },
    })

    const result = await send(createConsultHandler(deps))

    expect(result).toMatchObject({
      status: 200,
      json: {
        ok: true,
        value: {
          preconditions: {
            missing: [{ id: 'issue-tracker', label: 'docs/agents/issue-tracker.md', paths: ['docs/agents/issue-tracker.md'] }],
          },
          candidates: [
            { label: '首次使用前：/setup-matt-pocock-skills', input: '/setup-matt-pocock-skills', move: 'continue' },
            { label: '开 spec 会话', input: '/to-spec', move: 'clear', station: 'to-spec' },
            { label: '派代理', input: '整理验收', move: 'subagent', station: 'to-spec' },
            { label: '交接', input: 'handoff spec', move: 'handoff', station: 'handoff' },
          ],
        },
      },
    })
    const prompt = deps.calls[0]?.messages[0]?.content[0]?.type === 'text'
      ? deps.calls[0].messages[0].content[0].text
      : ''
    expect(prompt).toContain('"preconditions":{"missing":[{"id":"issue-tracker","label":"docs/agents/issue-tracker.md","paths":["docs/agents/issue-tracker.md"]}]}')
  })

  it('moves an existing setup chip to the top and keeps the candidate cap', async () => {
    const deps = dependencies({
      checkPreconditions: async () => ({
        missing: [{
          id: 'context',
          label: 'CONTEXT.md or CONTEXT-MAP.md',
          paths: ['CONTEXT.md', 'CONTEXT-MAP.md'],
        }],
      }),
      stream: () => output(JSON.stringify({
        position,
        location,
        next,
        candidates: [
          { label: '继续', input: '/to-spec', move: 'continue', station: 'to-spec' },
          { label: '设置 skills', input: '/setup-matt-pocock-skills', move: 'clear', station: 'to-spec' },
          { label: '派代理', input: '整理验收', move: 'subagent', station: 'to-spec' },
          { label: '交接', input: 'handoff spec', move: 'handoff', station: 'handoff' },
        ],
      })),
    })

    const result = await send(createConsultHandler(deps))

    expect((result.json as { value?: { candidates?: unknown[] } }).value?.candidates).toEqual([
      { label: '设置 skills', input: '/setup-matt-pocock-skills', move: 'continue', station: 'to-spec' },
      { label: '继续', input: '/to-spec', move: 'continue', station: 'to-spec' },
      { label: '派代理', input: '整理验收', move: 'subagent', station: 'to-spec' },
      { label: '交接', input: 'handoff spec', move: 'handoff', station: 'handoff' },
    ])
  })

  it('puts injected context occupancy and configured smart-zone thresholds in the prompt', async () => {
    const deps = dependencies({
      contextFacts: () => ({
        status: 'available',
        usedTokens: 120_320,
        percent: 47,
        contextWindow: 256_000,
        smartZone: { warnTokens: 111_000, criticalTokens: 777_000 },
      }),
    })

    await send(createConsultHandler(deps))

    expect(deps.calls[0]?.messages[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining(
        '"context":{"status":"available","usedTokens":120320,"percent":47,"contextWindow":256000,"smartZone":{"warnTokens":111000,"criticalTokens":777000}}',
      ),
    })
  })

  it('reports unavailable context facts without hard-coded smart-zone thresholds when no dependency is injected', async () => {
    const deps = dependencies()

    await send(createConsultHandler(deps))

    const prompt = deps.calls[0]?.messages[0]?.content[0]?.type === 'text'
      ? deps.calls[0].messages[0].content[0].text
      : ''
    expect(prompt).toContain('Current context and smart zone facts:\n{"status":"unavailable"}')
    expect(prompt).not.toContain('"warnTokens":150000')
    expect(prompt).not.toContain('"criticalTokens":1000000')
  })

  it('falls back on call failure, refusal, and empty output, carrying every reason kind', async () => {
    const deps = dependencies({
      getStageAgents: () => ({
        ...DEFAULT_STAGE_AGENTS,
        consult: ['primary/model-a', 'primary/model-b', 'primary/model-c', 'primary/model-d', 'backup/model-ok'],
      }),
      stream: (options) => {
        deps.calls.push(options)
        if (options.model === 'model-a') {
          return output('', { kind: 'error', failure: { message: '429 rate limit', code: 'RATE_LIMIT' } } as FinishReason)
        }
        if (options.model === 'model-b') return output('', { kind: 'refusal' } as unknown as FinishReason)
        if (options.model === 'model-c') {
          return output('', { kind: 'error', failure: { message: anthropicUsagePolicyRefusal, code: 'PI_AI_ERROR' } } as FinishReason)
        }
        if (options.model === 'model-d') return output('   ')
        return output(candidatesJson)
      },
    })

    expect(await send(createConsultHandler(deps))).toMatchObject({
      status: 200,
      json: {
        ok: true,
        value: {
          answeredBy: 'backup/model-ok',
          fallbacks: [
            { route: 'primary/model-a', kind: 'rate-limited', reason: '429 rate limit' },
            { route: 'primary/model-b', kind: 'refusal', reason: 'model refused the consultation' },
            { route: 'primary/model-c', kind: 'refusal', reason: anthropicUsagePolicyRefusal },
            { route: 'primary/model-d', kind: 'empty', reason: 'model returned no text' },
          ],
        },
      },
    })
    expect(deps.calls.map(call => `${call.provider}/${call.model}`)).toEqual([
      'primary/model-a',
      'primary/model-b',
      'primary/model-c',
      'primary/model-d',
      'backup/model-ok',
    ])
  })

  it('lists each failed candidate when no consult route can answer', async () => {
    const deps = dependencies({
      getStageAgents: () => ({
        ...DEFAULT_STAGE_AGENTS,
        consult: ['primary/model-a', 'backup/model-b'],
      }),
      stream: (options) => {
        deps.calls.push(options)
        return output('', { kind: 'error', failure: { message: `${options.model} unavailable`, code: 'NO_ADAPTER' } } as FinishReason)
      },
    })

    expect(await send(createConsultHandler(deps))).toMatchObject({
      status: 500,
      json: {
        ok: false,
        error: {
          code: 'consult-failed',
          message: expect.stringContaining('primary/model-a: model-a unavailable; backup/model-b: model-b unavailable'),
        },
      },
    })
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
