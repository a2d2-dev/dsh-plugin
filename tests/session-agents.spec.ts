import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service from '../src/index.ts'
import {
  SESSION_AGENT_ROUTE_PATH,
  createSessionAgentHandler,
} from '../src/session-agent-route.ts'
import { parseSessionAgentsDocument } from '../src/session-agents.ts'

interface HttpResult {
  readonly status: number
  readonly json: unknown
}

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-session-agent-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function send(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  body: unknown,
  headers: Record<string, string> = { host: '10.126.126.12:30710' },
  method = 'POST',
): Promise<HttpResult> {
  return sendRaw(handler, JSON.stringify(body), headers, method)
}

async function sendRaw(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  body: string,
  headers: Record<string, string> = { host: '10.126.126.12:30710' },
  method = 'POST',
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
        method,
        path: SESSION_AGENT_ROUTE_PATH,
        headers: {
          ...headers,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body).toString(),
        },
      }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', chunk => { chunks.push(Buffer.from(chunk)) })
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          })
        })
      })
      request.once('error', reject)
      request.end(body)
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
}

describe('session Agent service queries', () => {
  it('returns ceo for a task issue main session and undefined for an unrecorded session', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.bindMainSession({
      cwd: root,
      issue: 73,
      mainSession: SessionId('session-main'),
      now: new Date('2026-10-02T10:00:00.000Z'),
    })

    await expect(ctx.a2d2.agentOfSession(root, SessionId('session-main'))).resolves.toBe('ceo')
    await expect(ctx.a2d2.agentOfSession(root, SessionId('session-unrecorded'))).resolves.toBeUndefined()
  })

  it('rejects recording a task main session as a non-CEO Agent', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.bindMainSession({
      cwd: root,
      issue: 73,
      mainSession: SessionId('session-main'),
      now: new Date('2026-10-02T10:00:00.000Z'),
    })

    await expect(ctx.a2d2.recordSessionAgent(root, SessionId('session-main'), 'engineer')).rejects.toThrow(/main session/)
    await expect(ctx.a2d2.agentOfSession(root, SessionId('session-main'))).resolves.toBe('ceo')
  })

  it('treats repeated same-Agent records as idempotent and rejects different-Agent rewrites', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(A2d2Service, { root })

    await ctx.a2d2.recordSessionAgent(root, SessionId('session-worker'), 'engineer')
    await ctx.a2d2.recordSessionAgent(root, SessionId('session-worker'), 'engineer')

    await expect(ctx.a2d2.agentOfSession(root, SessionId('session-worker'))).resolves.toBe('engineer')
    await expect(ctx.a2d2.recordSessionAgent(root, SessionId('session-worker'), 'reviewer')).rejects.toThrow(/already recorded/)
    await expect(ctx.a2d2.agentOfSession(root, SessionId('session-worker'))).resolves.toBe('engineer')
  })
})

describe('session Agent ledger document validation', () => {
  it('rejects malformed documents', () => {
    expect(() => parseSessionAgentsDocument('[]')).toThrow(/must be a mapping/)
  })

  it('rejects unknown document versions', () => {
    expect(() => parseSessionAgentsDocument('version: 2\nsessions: []\n')).toThrow(/reads version 1/)
  })
})

describe('session Agent registration route', () => {
  it('records a trusted browser-created session Agent', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(A2d2Service, { root })
    const handler = createSessionAgentHandler({
      requestRejection: () => undefined,
      getSession: id => ({ id, header: { cwd: root } }),
      recordSessionAgent: (cwd, sessionId, agent) => ctx.a2d2.recordSessionAgent(cwd, sessionId, agent),
    })

    const result = await send(handler, { session: 'session-chip', agent: 'reviewer' })

    expect(result).toMatchObject({ status: 200, json: { ok: true, value: { session: 'session-chip', agent: 'reviewer' } } })
    await expect(ctx.a2d2.agentOfSession(root, SessionId('session-chip'))).resolves.toBe('reviewer')
  })

  it('rejects a request DSH refuses before recording', async () => {
    let writes = 0
    const handler = createSessionAgentHandler({
      requestRejection: () => 403,
      getSession: id => ({ id, header: { cwd: '/tmp/project' } }),
      recordSessionAgent: async () => { writes += 1 },
    })

    const result = await send(handler, { session: 'session-chip', agent: 'engineer' }, { host: 'evil.example' })

    expect(result).toMatchObject({ status: 403, json: { ok: false, error: { code: 'untrusted' } } })
    expect(writes).toBe(0)
  })

  it('rejects illegal Agent values before recording', async () => {
    let writes = 0
    const handler = createSessionAgentHandler({
      requestRejection: () => undefined,
      getSession: id => ({ id, header: { cwd: '/tmp/project' } }),
      recordSessionAgent: async () => { writes += 1 },
    })

    const result = await send(handler, { session: 'session-chip', agent: 'checklist' })

    expect(result).toMatchObject({ status: 400, json: { ok: false, error: { code: 'bad-agent' } } })
    expect(writes).toBe(0)
  })

  it('rejects non-POST requests', async () => {
    let writes = 0
    const handler = createSessionAgentHandler({
      requestRejection: () => undefined,
      getSession: id => ({ id, header: { cwd: '/tmp/project' } }),
      recordSessionAgent: async () => { writes += 1 },
    })

    const result = await send(handler, { session: 'session-chip', agent: 'engineer' }, { host: '10.126.126.12:30710' }, 'GET')

    expect(result).toMatchObject({ status: 405, json: { ok: false, error: { code: 'method-not-allowed' } } })
    expect(writes).toBe(0)
  })

  it('rejects malformed JSON before recording', async () => {
    let writes = 0
    const handler = createSessionAgentHandler({
      requestRejection: () => undefined,
      getSession: id => ({ id, header: { cwd: '/tmp/project' } }),
      recordSessionAgent: async () => { writes += 1 },
    })

    const result = await sendRaw(handler, '{bad json')

    expect(result).toMatchObject({ status: 400, json: { ok: false, error: { code: 'bad-json' } } })
    expect(writes).toBe(0)
  })

  it('maps a main-session record rejection to a 4xx response', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.bindMainSession({ cwd: root, issue: 73, mainSession: SessionId('session-main'), now: new Date() })
    const handler = createSessionAgentHandler({
      requestRejection: () => undefined,
      getSession: id => ({ id, header: { cwd: root } }),
      recordSessionAgent: (cwd, sessionId, agent) => ctx.a2d2.recordSessionAgent(cwd, sessionId, agent),
    })

    const result = await send(handler, { session: 'session-main', agent: 'engineer' })

    expect(result).toMatchObject({ status: 409, json: { ok: false, error: { code: 'record-rejected' } } })
  })

  it('maps a different-Agent duplicate rejection to a 4xx response', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.recordSessionAgent(root, SessionId('session-chip'), 'engineer')
    const handler = createSessionAgentHandler({
      requestRejection: () => undefined,
      getSession: id => ({ id, header: { cwd: root } }),
      recordSessionAgent: (cwd, sessionId, agent) => ctx.a2d2.recordSessionAgent(cwd, sessionId, agent),
    })

    const result = await send(handler, { session: 'session-chip', agent: 'reviewer' })

    expect(result).toMatchObject({ status: 409, json: { ok: false, error: { code: 'record-rejected' } } })
    await expect(ctx.a2d2.agentOfSession(root, SessionId('session-chip'))).resolves.toBe('engineer')
  })
})
