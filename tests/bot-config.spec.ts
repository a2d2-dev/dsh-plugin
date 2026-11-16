import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { createBotConfigHandler } from '../src/bot-config.ts'
import type { BotSettings } from '../src/bot-contract.ts'

interface HttpResult {
  readonly status: number
  readonly json: unknown
}

async function send(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  body: unknown,
  headers: Record<string, string> = { host: '10.126.126.12:3710' },
): Promise<HttpResult> {
  const server = createServer((request, response) => { void handler(request, response) })
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
        path: '/a2d2/api/bot',
        headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(encoded).toString() },
      }, response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => { chunks.push(Buffer.from(chunk)) })
        response.on('end', () => resolve({
          status: response.statusCode ?? 0,
          json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }))
      })
      request.once('error', reject)
      request.end(encoded)
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
}

function harness(options: {
  settings?: BotSettings
  revision?: number
  missingTools?: readonly string[]
  requestRejection?: () => 401 | 403 | undefined
} = {}) {
  let settings = options.settings ?? { enabled: false, defaultBot: '' }
  let revision = options.revision ?? 4
  const updateSettings = vi.fn(async (next: BotSettings, expectedRevision: number) => {
    if (expectedRevision !== revision) throw new SettingsConflictError('a2d2-bot' as never, expectedRevision, revision)
    settings = next
    revision++
    return { settings, revision }
  })
  const handler = createBotConfigHandler({
    requestRejection: options.requestRejection ?? (() => undefined),
    getSettings: () => ({ settings, revision }),
    updateSettings,
    missingTools: () => options.missingTools ?? [],
  })
  return { handler, updateSettings, getSettings: () => ({ settings, revision }) }
}

describe('A2D2 Bot settings route', () => {
  it('returns the saved settings and reports missing companion tools', async () => {
    const h = harness({ settings: { enabled: true, defaultBot: 'review-bot' }, missingTools: ['grok_bot_wait'] })
    const result = await send(h.handler, { method: 'settings.get' })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({
      ok: true,
      value: {
        settings: { enabled: true, defaultBot: 'review-bot' },
        revision: 4,
        missingTools: ['grok_bot_wait'],
      },
    })
  })

  it('saves only recognized settings with the expected revision', async () => {
    const h = harness()
    const result = await send(h.handler, {
      method: 'settings.update',
      payload: { settings: { enabled: true, defaultBot: '  review-bot  ' }, expectedRevision: 4 },
    })

    expect(result.status).toBe(200)
    expect(h.updateSettings).toHaveBeenCalledWith({ enabled: true, defaultBot: 'review-bot' }, 4)
    expect(h.getSettings()).toEqual({ settings: { enabled: true, defaultBot: 'review-bot' }, revision: 5 })
  })

  it('refuses unauthenticated requests before reading or writing settings', async () => {
    const h = harness({ requestRejection: () => 401 })
    const result = await send(h.handler, { method: 'settings.update', payload: { settings: {}, expectedRevision: 4 } })

    expect(result.status).toBe(401)
    expect(h.updateSettings).not.toHaveBeenCalled()
  })

  it('rejects malformed settings and returns the latest settings on revision conflict', async () => {
    const invalid = harness()
    expect((await send(invalid.handler, {
      method: 'settings.update', payload: { settings: { enabled: true, defaultBot: '', injected: true }, expectedRevision: 4 },
    })).status).toBe(400)
    expect(invalid.updateSettings).not.toHaveBeenCalled()

    const conflict = harness({ revision: 5 })
    const result = await send(conflict.handler, {
      method: 'settings.update', payload: { settings: { enabled: true, defaultBot: 'review-bot' }, expectedRevision: 4 },
    })
    expect(result.status).toBe(409)
    expect(result.json).toMatchObject({ ok: false, error: { code: 'settings-conflict', latest: { revision: 5 } } })
  })
})
