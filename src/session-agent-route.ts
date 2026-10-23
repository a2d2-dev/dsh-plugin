/**
 * Authenticated browser route for recording the Agent assigned to a session.
 *
 * Browser chips create sessions outside the model tool path, so they call this
 * route immediately after creation to persist the session's A2D2 Agent.
 *
 * @module @a2d2/dsh-a2d2/src/session-agent-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { parseSessionId } from './handoff.ts'
import { rejectionError } from './route-auth.ts'
import type { RequestRejection } from './route-auth.ts'
import { STAGE_AGENTS } from './stage-agents.ts'
import type { StageAgent } from './stage-agents.ts'

/** Exact HTTP pathname owned by the session Agent registration route. */
export const SESSION_AGENT_ROUTE_PATH = '/a2d2/api/session-agent'

/** Same request body limit used by the A2D2 configuration route. */
export const SESSION_AGENT_BODY_LIMIT_BYTES = 64 * 1024

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const

const AGENT_SET = new Set<string>(STAGE_AGENTS)

type SessionAgentErrorCode =
  | 'method-not-allowed'
  | 'unauthenticated'
  | 'untrusted'
  | 'payload-too-large'
  | 'bad-json'
  | 'bad-request'
  | 'bad-session'
  | 'unknown-session'
  | 'no-working-directory'
  | 'bad-agent'
  | 'record-rejected'
  | 'record-failed'

export interface SessionAgentSession {
  readonly id: SessionId
  readonly header: Pick<SessionHeader, 'cwd'>
}

export interface SessionAgentDependencies {
  /** DSH's browser authentication, asked before anything else (see `route-auth.ts`). */
  readonly requestRejection: RequestRejection
  readonly getSession: (id: SessionId) => SessionAgentSession | undefined
  readonly recordSessionAgent: (cwd: string, sessionId: SessionId, agent: StageAgent) => Promise<void>
}

class PayloadTooLargeError extends Error {
  constructor() {
    super(`Request body must be ${SESSION_AGENT_BODY_LIMIT_BYTES} bytes or smaller.`)
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function reasonOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.trim() || 'unknown error'
}

function isRecordRejected(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /main session|already recorded session/u.test(error.message)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const declaredLength = request.headers['content-length']
  if (typeof declaredLength === 'string' && Number.parseInt(declaredLength, 10) > SESSION_AGENT_BODY_LIMIT_BYTES) {
    throw new PayloadTooLargeError()
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > SESSION_AGENT_BODY_LIMIT_BYTES) throw new PayloadTooLargeError()
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

function fail(response: ServerResponse, status: number, code: SessionAgentErrorCode, message: string): void {
  respond(response, status, { ok: false, error: { code, message } })
}

/** Create the authenticated browser route handler that records session Agents. */
export function createSessionAgentHandler(
  dependencies: SessionAgentDependencies,
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
    if (!isRecord(body)) {
      fail(response, 400, 'bad-request', 'Request body must be a JSON object.')
      return
    }
    if (typeof body.session !== 'string') {
      fail(response, 400, 'bad-session', 'session must be a session id string.')
      return
    }
    const sessionId = parseSessionId(body.session)
    if (sessionId === undefined) {
      fail(response, 400, 'bad-session', 'session must be a valid session id.')
      return
    }
    if (typeof body.agent !== 'string' || !AGENT_SET.has(body.agent)) {
      fail(response, 400, 'bad-agent', `agent must be one of ${STAGE_AGENTS.join(', ')}.`)
      return
    }
    const session = dependencies.getSession(sessionId)
    if (session === undefined) {
      fail(response, 404, 'unknown-session', `Session "${sessionId}" is not live.`)
      return
    }
    const cwd = session.header.cwd
    if (cwd === undefined || cwd === '') {
      fail(response, 409, 'no-working-directory', 'The session records no working directory.')
      return
    }
    try {
      await dependencies.recordSessionAgent(cwd, sessionId, body.agent as StageAgent)
    } catch (error) {
      if (isRecordRejected(error)) {
        fail(response, 409, 'record-rejected', reasonOf(error))
        return
      }
      fail(response, 500, 'record-failed', reasonOf(error))
      return
    }
    respond(response, 200, { ok: true, value: { session: sessionId, agent: body.agent } })
  }
}
