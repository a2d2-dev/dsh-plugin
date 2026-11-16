/** Host route for the optional A2D2 Grok Bot integration settings. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { BOT_CONFIG_ROUTE_PATH } from './bot-contract.ts'
import type { BotSettings, BotSettingsSnapshot, BotSettingsState } from './bot-contract.ts'
import { rejectionError } from './route-auth.ts'
import type { RequestRejection } from './route-auth.ts'

export { BOT_CONFIG_ROUTE_PATH } from './bot-contract.ts'

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const
const BODY_LIMIT_BYTES = 16 * 1024
const SETTINGS_KEYS = new Set(['enabled', 'defaultBot'])

export interface BotConfigDependencies {
  readonly requestRejection: RequestRejection
  readonly getSettings: () => BotSettingsState
  readonly updateSettings: (settings: BotSettings, expectedRevision: number) => Promise<BotSettingsState>
  readonly missingTools: () => readonly string[]
}

class PayloadTooLargeError extends Error {
  constructor() {
    super(`Request body must be ${BODY_LIMIT_BYTES} bytes or smaller.`)
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function settingsFrom(value: unknown): BotSettings {
  if (!isRecord(value)) throw new Error('settings must be an object')
  for (const key of Object.keys(value)) {
    if (!SETTINGS_KEYS.has(key)) throw new Error(`unknown setting "${key}"`)
  }
  if (typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean')
  if (typeof value.defaultBot !== 'string') throw new Error('defaultBot must be a string')
  const defaultBot = value.defaultBot.trim()
  if (defaultBot.length > 256) throw new Error('defaultBot must be 256 characters or fewer')
  return { enabled: value.enabled, defaultBot }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const declaredLength = request.headers['content-length']
  if (typeof declaredLength === 'string' && Number.parseInt(declaredLength, 10) > BODY_LIMIT_BYTES) {
    throw new PayloadTooLargeError()
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > BODY_LIMIT_BYTES) throw new PayloadTooLargeError()
    chunks.push(buffer)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  if (body.trim() === '') return {}
  return JSON.parse(body)
}

function respond(
  response: ServerResponse,
  status: number,
  body: { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: Readonly<Record<string, unknown>> },
): void {
  response.writeHead(status, JSON_HEADERS)
  response.end(JSON.stringify(body))
}

function fail(response: ServerResponse, status: number, code: string, message: string, extras: Readonly<Record<string, unknown>> = {}): void {
  respond(response, status, { ok: false, error: { code, message, ...extras } })
}

function snapshot(dependencies: BotConfigDependencies, state = dependencies.getSettings()): BotSettingsSnapshot {
  return { ...state, missingTools: [...dependencies.missingTools()] }
}

/** Create the authenticated settings route; it never calls Grok Bot itself. */
export function createBotConfigHandler(
  dependencies: BotConfigDependencies,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const rejection = dependencies.requestRejection(request)
    if (rejection !== undefined) {
      const { code, message } = rejectionError(rejection)
      fail(response, rejection, code, message)
      return
    }
    if (request.method !== 'POST') {
      fail(response, 405, 'method-not-allowed', 'Only POST is allowed for this route.')
      return
    }

    let body: unknown
    try {
      body = await readJson(request)
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        fail(response, 413, 'payload-too-large', error.message)
        return
      }
      fail(response, 400, 'bad-json', reasonOf(error))
      return
    }
    if (!isRecord(body) || typeof body.method !== 'string') {
      fail(response, 400, 'bad-request', 'Request body must name a method.')
      return
    }
    const payload = isRecord(body.payload) ? body.payload : {}
    if (body.method === 'settings.get') {
      respond(response, 200, { ok: true, value: snapshot(dependencies) })
      return
    }
    if (body.method !== 'settings.update') {
      fail(response, 400, 'unknown-method', `Unknown method "${body.method}".`)
      return
    }
    if (typeof payload.expectedRevision !== 'number' || !Number.isInteger(payload.expectedRevision)) {
      fail(response, 400, 'missing-revision', 'settings.update requires an integer expectedRevision.')
      return
    }

    let settings: BotSettings
    try {
      settings = settingsFrom(payload.settings)
    } catch (error) {
      fail(response, 400, 'schema-rejected', reasonOf(error))
      return
    }
    try {
      respond(response, 200, { ok: true, value: snapshot(dependencies, await dependencies.updateSettings(settings, payload.expectedRevision)) })
    } catch (error) {
      if (error instanceof SettingsConflictError) {
        fail(response, 409, 'settings-conflict', error.message, { latest: snapshot(dependencies) })
        return
      }
      fail(response, 400, 'settings-rejected', reasonOf(error))
    }
  }
}
