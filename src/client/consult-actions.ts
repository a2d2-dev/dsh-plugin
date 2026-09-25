/**
 * Client-side next-step consultation and candidate selection.
 *
 * Network, composer, and card capabilities are injected so this module stays
 * independent of React and cannot send a session command when a chip is picked.
 *
 * @module @deepseek-ai/dsh-a2d2/client/consult-actions
 */

/** Exact host route used for next-step consultation. */
export const CONSULT_ROUTE_PATH = '/a2d2/api/consult'

/** One candidate returned by the host consultation route. */
export interface ConsultCandidate {
  readonly label: string
  readonly input: string
  readonly kind: 'stay' | 'handoff' | 'other'
}

/** The complete state of the next-step card. */
export type ConsultPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready'
      /** Where the work stands, shown above the chips; absent from an older host. */
      readonly position?: string
      readonly candidates: readonly ConsultCandidate[]
      readonly degraded: boolean
    }
  | { readonly kind: 'error'; readonly message: string }

/** The small response face needed from an injected fetch implementation. */
export interface ConsultFetchResponse {
  json(): Promise<unknown>
}

/** Capabilities needed to run one consultation. */
export interface ConsultRequestDeps {
  readonly fetch: (
    input: string,
    init: { readonly method: 'POST' },
  ) => Promise<ConsultFetchResponse>
  readonly setPhase: (phase: ConsultPhase) => void
}

/** Capabilities a chip may invoke. Deliberately excludes session commands. */
export interface ConsultSelectionDeps {
  readonly appendToDraft: (input: string) => boolean
  readonly focusComposer: () => void
  readonly closeConsult: () => void
  readonly openHandoff: (focus: string) => void
}

type ConsultResponse =
  | {
      readonly ok: true
      readonly value: {
        readonly position?: string
        readonly candidates: readonly ConsultCandidate[]
        readonly degraded: boolean
      }
    }
  | {
      readonly ok: false
      readonly error: { readonly code: string; readonly message: string }
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseCandidate(value: unknown): ConsultCandidate | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.label !== 'string' || value.label.trim() === '') return undefined
  if (typeof value.input !== 'string' || value.input.trim() === '') return undefined
  if (value.kind !== 'stay' && value.kind !== 'handoff' && value.kind !== 'other') return undefined
  return { label: value.label, input: value.input, kind: value.kind }
}

/** Parse the route's discriminated response before it reaches rendering state. */
export function parseConsultResponse(value: unknown): ConsultResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error('下一步咨询返回了无效响应')
  }
  if (!value.ok) {
    if (!isRecord(value.error) || typeof value.error.code !== 'string' || typeof value.error.message !== 'string') {
      throw new Error('下一步咨询返回了无效响应')
    }
    return { ok: false, error: { code: value.error.code, message: value.error.message } }
  }
  if (!isRecord(value.value) || !Array.isArray(value.value.candidates) || typeof value.value.degraded !== 'boolean') {
    throw new Error('下一步咨询返回了无效响应')
  }
  const position = value.value.position
  if (position !== undefined && typeof position !== 'string') {
    throw new Error('下一步咨询返回了无效响应')
  }
  const candidates = value.value.candidates.map(parseCandidate)
  if (candidates.some(candidate => candidate === undefined)) {
    throw new Error('下一步咨询返回了无效响应')
  }
  return {
    ok: true,
    value: {
      ...(position === undefined || position.trim() === '' ? {} : { position: position.trim() }),
      candidates: candidates as ConsultCandidate[],
      degraded: value.value.degraded,
    },
  }
}

/** Fetch one fresh candidate set, replacing every prior card state. */
export async function requestConsult(deps: ConsultRequestDeps, sessionId: string): Promise<void> {
  deps.setPhase({ kind: 'loading' })
  try {
    const response = await deps.fetch(
      `${CONSULT_ROUTE_PATH}?session=${encodeURIComponent(sessionId)}`,
      { method: 'POST' },
    )
    const result = parseConsultResponse(await response.json())
    if (!result.ok) {
      deps.setPhase({ kind: 'error', message: result.error.message })
      return
    }
    deps.setPhase({
      kind: 'ready',
      ...(result.value.position === undefined ? {} : { position: result.value.position }),
      candidates: result.value.candidates,
      degraded: result.value.degraded,
    })
  } catch (error) {
    deps.setPhase({
      kind: 'error',
      message: error instanceof Error ? error.message : '下一步咨询失败',
    })
  }
}

/**
 * Apply one candidate without ever sending it.
 *
 * Stay/other candidates only write and focus the composer. Handoff candidates
 * only open the existing confirmation card with their input as its focus.
 * @returns whether the requested UI transition was completed.
 */
export function selectConsultCandidate(
  deps: ConsultSelectionDeps,
  candidate: ConsultCandidate,
): boolean {
  if (candidate.kind === 'handoff') {
    deps.openHandoff(candidate.input)
    return true
  }
  if (!deps.appendToDraft(candidate.input)) return false
  deps.closeConsult()
  deps.focusComposer()
  return true
}
