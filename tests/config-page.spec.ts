import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { FinishReason, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  CONFIG_ROUTE_PATH,
  classifyModelProbe,
  createConfigHandler,
} from '../src/config-page.ts'
import { DEFAULT_STAGE_AGENTS } from '../src/stage-agents.ts'
import type { StageAgentsSettings } from '../src/stage-agents.ts'

const anthropicUsagePolicyRefusal = "This request triggered restrictions on violative cyber content and was blocked under Anthropic's Usage Policy. To learn more, see https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback."

function output(text: string, reason: FinishReason = { kind: 'stop' }): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason }
  })()
}

interface HttpResult {
  readonly status: number
  readonly json: unknown
}

async function send(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  body: unknown,
  headers: Record<string, string> = { host: '10.126.126.12:30710' },
): Promise<HttpResult> {
  const server = createServer((request, response) => {
    void handler(request, response)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  try {
    return await new Promise<HttpResult>((resolve, reject) => {
      const encoded = JSON.stringify(body)
      const request = httpRequest({
        hostname: '127.0.0.1',
        port,
        method: 'POST',
        path: CONFIG_ROUTE_PATH,
        headers: {
          ...headers,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(encoded).toString(),
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
      request.end(encoded)
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
}

async function sendRaw(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  body: string,
  headers: Record<string, string> = { host: '10.126.126.12:30710' },
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
        method: 'POST',
        path: CONFIG_ROUTE_PATH,
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

function handler(options: {
  value?: StageAgentsSettings
  revision?: number
  update?: (value: StageAgentsSettings, expectedRevision: number | undefined) => Promise<{ value: StageAgentsSettings; revision: number }>
  modelRoutes?: readonly string[]
  stream?: (options: GenerateOptions) => AsyncIterable<StreamChunk>
} = {}) {
  let value = options.value ?? DEFAULT_STAGE_AGENTS
  let revision = options.revision ?? 7
  return createConfigHandler({
    trustedHosts: () => ['10.126.126.12:30710'],
    getSettings: () => ({ value, revision }),
    updateSettings: options.update ?? (async (next, expectedRevision) => {
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw new SettingsConflictError('a2d2' as SettingsNamespace, expectedRevision, revision)
      }
      value = next
      revision += 1
      return { value, revision }
    }),
    modelRoutes: async () => options.modelRoutes ?? ['claude-bray/claude-fable-5-1', 'codex/gpt-6', 'codex/gpt-5.5'],
    stream: options.stream ?? (() => output('OK')),
  })
}

describe('A2D2 config settings route', () => {
  it('rejects untrusted browser requests before reading settings', async () => {
    const result = await send(handler(), { method: 'settings.get', payload: {} }, { host: 'evil.example' })
    expect(result).toMatchObject({
      status: 403,
      json: { ok: false, error: { code: 'untrusted' } },
    })
  })

  it('reads the whitelisted stage-agent settings with warnings', async () => {
    const result = await send(handler({
      value: {
        ...DEFAULT_STAGE_AGENTS,
        agents: {
          ...DEFAULT_STAGE_AGENTS.agents,
          engineer: ['codex/gpt-6'],
          reviewer: ['codex/gpt-6'],
        },
      },
    }), { method: 'settings.get', payload: {} })

    expect(result).toMatchObject({
      status: 200,
      json: {
        ok: true,
        value: {
          revision: 7,
          settings: {
            stages: expect.objectContaining({ implement: 'engineer', 'code-review': 'reviewer' }),
            agents: expect.objectContaining({ engineer: ['codex/gpt-6'], reviewer: ['codex/gpt-6'] }),
            consult: DEFAULT_STAGE_AGENTS.consult,
          },
          warnings: ['a2d2: 评审和工程师的首选模型同为 codex/gpt-6；通常应为评审配置不同的首选模型'],
        },
      },
    })
  })

  it('revision-guards writes, schema-validates values, and returns the reread value', async () => {
    const next = {
      ...DEFAULT_STAGE_AGENTS,
      consult: ['codex/gpt-6'],
    }
    expect(await send(handler(), {
      method: 'settings.update',
      payload: { settings: next, expectedRevision: 7 },
    })).toMatchObject({
      status: 200,
      json: { ok: true, value: { revision: 8, settings: next, warnings: [] } },
    })

    expect(await send(handler(), {
      method: 'settings.update',
      payload: { settings: { ...DEFAULT_STAGE_AGENTS, consult: [] }, expectedRevision: 7 },
    })).toMatchObject({
      status: 400,
      json: { ok: false, error: { code: 'schema-rejected', message: expect.stringContaining('array length >= 1') } },
    })

    expect(await send(handler({ revision: 3 }), {
      method: 'settings.update',
      payload: { settings: next, expectedRevision: 2 },
    })).toMatchObject({
      status: 409,
      json: {
        ok: false,
        error: {
          code: 'settings-conflict',
          latest: { revision: 3, settings: DEFAULT_STAGE_AGENTS },
        },
      },
    })
  })

  it('rejects settings updates that omit expectedRevision before writing', async () => {
    let writes = 0
    const result = await send(handler({
      update: async value => {
        writes += 1
        return { value, revision: 8 }
      },
    }), {
      method: 'settings.update',
      payload: { settings: DEFAULT_STAGE_AGENTS },
    })

    expect(result).toMatchObject({
      status: 400,
      json: { ok: false, error: { code: 'missing-revision' } },
    })
    expect(writes).toBe(0)
  })

  it('rejects invalid JSON and oversized request bodies before dispatching', async () => {
    expect(await sendRaw(handler(), '{"method":')).toMatchObject({
      status: 400,
      json: { ok: false, error: { code: 'bad-json' } },
    })

    expect(await sendRaw(handler(), ' '.repeat(64 * 1024 + 1))).toMatchObject({
      status: 413,
      json: { ok: false, error: { code: 'payload-too-large' } },
    })
  })
})

describe('model probe', () => {
  it('classifies normal, refusal, rate limit, and ordinary errors', async () => {
    await expect(classifyModelProbe({
      route: 'provider/ok',
      stream: () => output('OK'),
    })).resolves.toEqual({ status: 'normal', reason: 'OK' })

    await expect(classifyModelProbe({
      route: 'provider/refusal',
      stream: () => output('', { kind: 'refusal' } as unknown as FinishReason),
    })).resolves.toEqual({ status: 'refusal', reason: 'model refused the probe' })

    await expect(classifyModelProbe({
      route: 'provider/policy-block',
      stream: () => output('', { kind: 'error', failure: { message: anthropicUsagePolicyRefusal, code: 'PI_AI_ERROR' } } as FinishReason),
    })).resolves.toEqual({ status: 'refusal', reason: anthropicUsagePolicyRefusal })

    await expect(classifyModelProbe({
      route: 'provider/limited',
      stream: () => output('', { kind: 'error', failure: { message: '429 too many requests', code: 'RATE_LIMIT' } } as FinishReason),
    })).resolves.toEqual({ status: 'rate-limited', reason: '429 too many requests' })

    await expect(classifyModelProbe({
      route: 'provider/error',
      stream: () => output('', { kind: 'error', failure: { message: 'adapter unavailable', code: 'NO_ADAPTER' } } as FinishReason),
    })).resolves.toEqual({ status: 'error', reason: 'adapter unavailable' })

    await expect(classifyModelProbe({
      route: 'provider/empty',
      stream: () => output('   '),
    })).resolves.toEqual({ status: 'error', reason: '空输出' })
  })

  it('probes only provider/model routes that are configured or present in the catalog', async () => {
    const route = handler({ modelRoutes: ['catalog/model'] })

    expect(await send(route, {
      method: 'probe',
      payload: { route: 'not-a-route' },
    })).toMatchObject({
      status: 400,
      json: { ok: false, error: { code: 'bad-route' } },
    })

    expect(await send(route, {
      method: 'probe',
      payload: { route: 'missing/model' },
    })).toMatchObject({
      status: 404,
      json: { ok: false, error: { code: 'unknown-route' } },
    })

    expect(await send(route, {
      method: 'probe',
      payload: { route: 'catalog/model' },
    })).toMatchObject({
      status: 200,
      json: { ok: true, value: { status: 'normal', reason: 'OK' } },
    })
  })

  it('does not require a catalog read for routes already present in settings', async () => {
    const route = createConfigHandler({
      trustedHosts: () => ['10.126.126.12:30710'],
      getSettings: () => ({ value: DEFAULT_STAGE_AGENTS, revision: 1 }),
      updateSettings: async value => ({ value, revision: 2 }),
      modelRoutes: async () => { throw new Error('catalog unavailable') },
      stream: () => output('OK'),
    })

    expect(await send(route, {
      method: 'probe',
      payload: { route: 'claude-bray/claude-fable-5-1' },
    })).toMatchObject({
      status: 200,
      json: { ok: true, value: { status: 'normal', reason: 'OK' } },
    })
  })
})
