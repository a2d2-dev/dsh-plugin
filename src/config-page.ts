/**
 * Host-side route for the A2D2 configuration page.
 *
 * The browser cannot call arbitrary settings namespaces: this route exposes
 * only the plugin-owned stage Agent settings, and only to a browser DSH has
 * authenticated (see `route-auth.ts`), like every other A2D2 route.
 *
 * @module @a2d2/dsh-a2d2/src/config-page
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  BlockAssembler,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { rejectionError } from './route-auth.ts'
import type { RequestRejection } from './route-auth.ts'
import { A2D2_MESSAGE_SOURCE } from './message-source.ts'
import { classifyFailureKind } from './refusal.ts'
import {
  candidateRoute,
  candidateSelection,
  stageAgentWarnings,
  validateCompleteStageAgentsSettings,
} from './stage-agents.ts'
import type { StageAgentsSettings } from './stage-agents.ts'
import type { ModelCandidate, ModelEffortCatalog } from './stage-agent-data.ts'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { isModelCandidate } from './stage-agent-data.ts'

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
  readonly settings: StageAgentsSettings
  readonly revision: number | undefined
  readonly warnings: readonly string[]
}

export type ModelProbeStatus = 'normal' | 'refusal' | 'rate-limited' | 'error'

export interface ModelProbeResult {
  readonly status: ModelProbeStatus
  readonly reason: string
}

export interface ConfigDependencies {
  /** DSH's browser authentication, asked before anything else (see `route-auth.ts`). */
  readonly requestRejection: RequestRejection
  readonly getSettings: () => ConfigSettingsView | { readonly value: StageAgentsSettings; readonly revision: number | undefined }
  readonly updateSettings: (
    value: StageAgentsSettings,
    expectedRevision: number | undefined,
  ) => Promise<{ readonly value: StageAgentsSettings; readonly revision: number | undefined }>
  readonly modelRoutes: () => Promise<readonly string[]>
  readonly modelEfforts?: () => Promise<ModelEffortCatalog>
  readonly stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function settingsView(
  entry: ConfigSettingsView | { readonly value: StageAgentsSettings; readonly revision: number | undefined },
): ConfigSettingsView {
  const settings = 'settings' in entry ? entry.settings : entry.value
  return {
    settings,
    revision: entry.revision,
    warnings: stageAgentWarnings(settings),
  }
}

function flattenConfiguredRoutes(settings: StageAgentsSettings): Set<string> {
  return new Set([
    ...settings.consult,
    ...Object.values(settings.agents).flat(),
  ].map(candidateRoute))
}

function validateCandidateEffort(candidate: ModelCandidate, efforts: ModelEffortCatalog | undefined): void {
  const selection = candidateSelection(candidate)
  if (selection.reasoningEffort === undefined) return
  const route = candidateRoute(candidate)
  if (efforts === undefined || !Object.hasOwn(efforts, route)) {
    throw new Error(`${route} reasoning effort metadata is unavailable; cannot validate explicit effort "${selection.reasoningEffort}"`)
  }
  if (!efforts[route]?.some(option => option.id === selection.reasoningEffort)) {
    throw new Error(`${route} does not support reasoning effort "${selection.reasoningEffort}"`)
  }
}

function reasonOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.trim() || 'unknown error'
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
  readonly route: ModelCandidate
  readonly stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>
  readonly signal?: AbortSignal
}): Promise<ModelProbeResult> {
  const route = candidateSelection(options.route)
  const generateOptions: GenerateOptions = deepFreeze({
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) }),
    messages: [createUserMessage({
      content: [{ type: 'text', text: 'reply OK' }],
      source: A2D2_MESSAGE_SOURCE,
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
      const status = classifyFailureKind({
        finishKind: finish.kind,
        message: error.message,
        code: error.code,
        status: error.status,
      })
      return { status: status === 'empty' ? 'error' : status, reason: error.message }
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
    const err: Error & { code?: string; status?: number } = error instanceof Error
      ? error
      : new Error(String(error))
    const status = classifyFailureKind({ message: err.message, code: err.code, status: err.status })
    return { status: status === 'empty' ? 'error' : status, reason: reasonOf(err) }
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

/** Create the authenticated configuration route handler. */
export function createConfigHandler(
  dependencies: ConfigDependencies,
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
    try {
      switch (body.method as ConfigMethod) {
        case 'settings.get': {
          respond(response, 200, { ok: true, value: {
            ...settingsView(dependencies.getSettings()),
            // The A2D2 candidate list is the plugin's routable catalog
            // (`llm.listModels`), which can be wider than the session
            // controller's Host-generation catalog.
            catalog: await dependencies.modelRoutes?.() ?? [],
            efforts: await dependencies.modelEfforts?.() ?? {},
          } })
          return
        }
        case 'settings.update': {
          if (typeof payload.expectedRevision !== 'number') {
            fail(response, 400, 'missing-revision', 'settings.update requires expectedRevision.')
            return
          }
          const expectedRevision = payload.expectedRevision
          let next: StageAgentsSettings
          try {
            next = validateCompleteStageAgentsSettings(payload.settings)
            const candidates = [...Object.values(next.agents).flat(), ...next.consult]
            const efforts = candidates.some(candidate => candidateSelection(candidate).reasoningEffort !== undefined)
              ? await dependencies.modelEfforts?.() : undefined
            for (const candidate of candidates) {
              validateCandidateEffort(candidate, efforts)
            }
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
          const candidate = payload.reasoningEffort === undefined ? payload.route
            : { route: payload.route, reasoningEffort: payload.reasoningEffort }
          if (!isModelCandidate(candidate)) {
            fail(response, 400, 'bad-effort', 'reasoningEffort must be a non-empty effort id')
            return
          }
          const efforts = candidateSelection(candidate).reasoningEffort === undefined
            ? undefined : await dependencies.modelEfforts?.()
          try {
            validateCandidateEffort(candidate, efforts)
          } catch (error) {
            fail(response, 400, 'unsupported-effort', reasonOf(error))
            return
          }
          const controller = new AbortController()
          request.once('aborted', () => { controller.abort() })
          const result = await classifyModelProbe({
            route: candidate,
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
