/**
 * Host-side route for the A2D2 configuration page.
 *
 * The browser cannot call arbitrary settings namespaces: this route exposes
 * only the plugin-owned station model table, guarded by the same trusted-host
 * fence as the next-step consult route.
 *
 * @module @deepseek-ai/dsh-a2d2/src/config-page
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  BlockAssembler,
  createUserMessage,
  deepFreeze,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { isTrustedConsultRequest } from './consult.ts'
import {
  DEFAULT_STATION_MODELS,
  splitModelRoute,
  stationModelWarnings,
  validateStationModelsSettings,
} from './station-models.ts'
import type { StationModelsSettings } from './station-models.ts'

/** Exact HTTP pathname owned by the configuration page. */
export const CONFIG_ROUTE_PATH = '/a2d2/api/config'

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const

const PROBE_MAX_OUTPUT_TOKENS = 8
const CONFIG_BODY_LIMIT_BYTES = 64 * 1024
const ROUTE_PATTERN = /^[^/\s]+\/[^/\s]+$/u

export type ConfigMethod = 'settings.get' | 'settings.update' | 'probe'

export interface ConfigSettingsView {
  readonly settings: StationModelsSettings
  readonly revision: number | undefined
  readonly warnings: readonly string[]
}

export type ModelProbeStatus = 'normal' | 'refusal' | 'rate-limited' | 'error'

export interface ModelProbeResult {
  readonly status: ModelProbeStatus
  readonly reason: string
}

export interface ConfigDependencies {
  readonly trustedHosts: () => readonly string[]
  readonly getSettings: () => ConfigSettingsView | { readonly value: StationModelsSettings; readonly revision: number | undefined }
  readonly updateSettings: (
    value: StationModelsSettings,
    expectedRevision: number | undefined,
  ) => Promise<{ readonly value: StationModelsSettings; readonly revision: number | undefined }>
  readonly modelRoutes: () => Promise<readonly string[]>
  readonly stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function settingsView(
  entry: ConfigSettingsView | { readonly value: StationModelsSettings; readonly revision: number | undefined },
): ConfigSettingsView {
  const settings = 'settings' in entry ? entry.settings : entry.value
  return {
    settings,
    revision: entry.revision,
    warnings: stationModelWarnings(settings),
  }
}

function flattenConfiguredRoutes(settings: StationModelsSettings): Set<string> {
  return new Set([
    ...settings.consult,
    ...Object.values(settings.stations).flat(),
  ])
}

function reasonOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.trim() || 'unknown error'
}

function isRateLimit(error: Error & { code?: unknown; status?: unknown }): boolean {
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : ''
  return code.includes('rate') || code.includes('429') || error.status === 429 || /(^|\D)429(\D|$)|rate limit|too many requests/iu.test(error.message)
}

class PayloadTooLargeError extends Error {
  constructor() {
    super(`Request body must be ${CONFIG_BODY_LIMIT_BYTES} bytes or smaller.`)
  }
}

/**
 * Run the tiny user-triggered model probe and classify provider outcomes.
 *
 * The prompt is intentionally minimal; this is an availability check, not a
 * quality evaluation, and callers invoke it only after the user clicks Test.
 */
export async function classifyModelProbe(options: {
  readonly route: string
  readonly stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>
  readonly signal?: AbortSignal
}): Promise<ModelProbeResult> {
  const route = splitModelRoute(options.route)
  const generateOptions: GenerateOptions = deepFreeze({
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({
      content: [{ type: 'text', text: 'reply OK' }],
      source: { kind: 'plugin', plugin: 'dsh-a2d2' },
    })],
    system: 'Reply with exactly OK.',
    maxTokens: PROBE_MAX_OUTPUT_TOKENS,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  try {
    const assembler = new BlockAssembler()
    for await (const chunk of options.stream(generateOptions)) assembler.push(chunk)
    const finish = assembler.finish as { readonly kind?: unknown; readonly failure?: unknown }
    if (finish.kind === 'refusal') return { status: 'refusal', reason: 'model refused the probe' }
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      const failure = isRecord(finish.failure) ? finish.failure : {}
      const error = new Error(typeof failure.message === 'string' ? failure.message : 'model probe failed') as Error & {
        code?: string
        status?: number
      }
      if (typeof failure.code === 'string') error.code = failure.code
      if (typeof failure.status === 'number') error.status = failure.status
      return { status: isRateLimit(error) ? 'rate-limited' : 'error', reason: error.message }
    }
    if (finish.kind !== 'stop') {
      return { status: 'error', reason: `model stopped with ${String(finish.kind ?? 'unknown')}` }
    }
    const text = assembler.blocks()
      .filter((block): block is Extract<(ReturnType<BlockAssembler['blocks']>)[number], { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    if (text.length === 0) return { status: 'error', reason: '空输出' }
    return { status: 'normal', reason: text }
  } catch (error) {
    const err = error instanceof Error ? error as Error & { code?: string; status?: number } : new Error(String(error))
    return { status: isRateLimit(err) ? 'rate-limited' : 'error', reason: reasonOf(err) }
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const declaredLength = request.headers['content-length']
  if (typeof declaredLength === 'string' && Number.parseInt(declaredLength, 10) > CONFIG_BODY_LIMIT_BYTES) {
    throw new PayloadTooLargeError()
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > CONFIG_BODY_LIMIT_BYTES) throw new PayloadTooLargeError()
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

/** Create the trusted configuration route handler. */
export function createConfigHandler(
  dependencies: ConfigDependencies,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (request.method !== 'POST') {
      fail(response, 405, 'method-not-allowed', 'Only POST is allowed for this route.')
      return
    }
    if (!isTrustedConsultRequest(request.headers, dependencies.trustedHosts())) {
      fail(response, 403, 'untrusted', 'The request authority or origin is not trusted.')
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
    try {
      switch (body.method as ConfigMethod) {
        case 'settings.get': {
          respond(response, 200, { ok: true, value: settingsView(dependencies.getSettings()) })
          return
        }
        case 'settings.update': {
          if (typeof payload.expectedRevision !== 'number') {
            fail(response, 400, 'missing-revision', 'settings.update requires expectedRevision.')
            return
          }
          const expectedRevision = payload.expectedRevision
          let next: StationModelsSettings
          try {
            next = validateStationModelsSettings(payload.settings)
          } catch (error) {
            fail(response, 400, 'schema-rejected', reasonOf(error))
            return
          }
          try {
            const updated = await dependencies.updateSettings(next, expectedRevision)
            respond(response, 200, { ok: true, value: settingsView(updated) })
          } catch (error) {
            if (error instanceof SettingsConflictError) {
              fail(response, 409, 'settings-conflict', error.message, {
                latest: settingsView(dependencies.getSettings()),
              })
              return
            }
            fail(response, 400, 'settings-rejected', reasonOf(error))
          }
          return
        }
        case 'probe': {
          if (typeof payload.route !== 'string' || !ROUTE_PATTERN.test(payload.route)) {
            fail(response, 400, 'bad-route', 'route must be provider/model')
            return
          }
          const configured = flattenConfiguredRoutes(settingsView(dependencies.getSettings()).settings)
          if (!configured.has(payload.route)) {
            const catalog = new Set(await dependencies.modelRoutes())
            if (!catalog.has(payload.route)) {
              fail(response, 404, 'unknown-route', 'route is not configured and is not present in the model catalog')
              return
            }
          }
          const controller = new AbortController()
          request.once('aborted', () => { controller.abort() })
          const result = await classifyModelProbe({
            route: payload.route,
            stream: dependencies.stream,
            signal: controller.signal,
          })
          respond(response, 200, { ok: true, value: result })
          return
        }
        default:
          fail(response, 400, 'unknown-method', `Unknown method "${body.method}".`)
      }
    } catch (error) {
      fail(response, 500, 'config-failed', reasonOf(error))
    }
  }
}
