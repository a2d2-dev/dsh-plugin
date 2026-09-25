/**
 * Host-side read route for the A²D² panel.
 *
 * The browser asks with only the open session id. The host resolves that
 * session's working directory, derives the project root with the same store
 * rules as `/handoff`, and returns the task documents for that project.
 *
 * @module @deepseek-ai/dsh-a2d2/src/panel
 */

import type { IncomingHttpHeaders } from 'node:http'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isTrustedConsultRequest } from './consult.ts'
import { parseSessionId } from './handoff.ts'
import { PANEL_ROUTE_PATH } from './panel-types.ts'
import type { PanelErrorCode, PanelPayload, PanelResponse, PanelTask } from './panel-types.ts'
import type { Task } from './types.ts'

export { PANEL_ROUTE_PATH } from './panel-types.ts'
export type { PanelErrorCode, PanelMember, PanelPayload, PanelResponse, PanelTask } from './panel-types.ts'

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const

/** Minimal live-session face needed by the route. */
export interface PanelSession {
  readonly header: { readonly cwd?: string }
}

/** Host capabilities injected into the route handler. */
export interface PanelDependencies {
  readonly trustedHosts: () => readonly string[]
  readonly getSession: (id: SessionId) => PanelSession | undefined
  readonly listTasks: (cwd: string) => Promise<readonly Task[]>
  readonly projectRoot: (cwd: string) => Promise<string>
}

/** Structural request face used by Node's HTTP server and tests. */
export interface PanelRequest {
  readonly method?: string
  readonly url?: string
  readonly headers: IncomingHttpHeaders
}

/** Structural response face used by Node's HTTP server and tests. */
export interface PanelResponseWriter {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

function taskView(task: Task): PanelTask {
  return {
    id: task.id,
    name: task.name,
    ...(task.goal === undefined ? {} : { goal: task.goal }),
    state: task.state,
    createdAt: task.createdAt,
    members: task.members.map(member => ({
      sessionId: member.sessionId,
      ...(member.handoffFrom === undefined ? {} : { handoffFrom: member.handoffFrom }),
    })),
  }
}

/**
 * Flatten stored task documents into the browser-facing payload.
 * @param root - resolved project root.
 * @param tasks - tasks read from that project.
 * @returns the route payload.
 */
export function panelPayload(root: string, tasks: readonly Task[]): PanelPayload {
  return { root, tasks: tasks.map(taskView) }
}

function statusOf(code: PanelErrorCode): number {
  switch (code) {
    case 'method-not-allowed': return 405
    case 'untrusted': return 403
    case 'missing-session': return 400
    case 'unknown-session': return 404
    case 'no-working-directory': return 409
    case 'read-failed': return 500
  }
}

function respond(response: PanelResponseWriter, status: number, body: PanelResponse): void {
  response.writeHead(status, JSON_HEADERS)
  response.end(JSON.stringify(body))
}

function fail(response: PanelResponseWriter, code: PanelErrorCode, message: string): void {
  respond(response, statusOf(code), { ok: false, error: { code, message } })
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sessionIdOf(url: string | undefined): SessionId | undefined {
  const values = new URL(url ?? PANEL_ROUTE_PATH, 'http://a2d2.invalid')
    .searchParams.getAll('session')
  return values.length === 1 ? parseSessionId(values[0]!) : undefined
}

/**
 * Create the trusted, read-only panel task route.
 * @param dependencies - host services used by the route.
 * @returns a Node-compatible request handler.
 */
export function createPanelHandler(
  dependencies: PanelDependencies,
): (request: PanelRequest, response: PanelResponseWriter) => Promise<void> {
  return async (request, response) => {
    if (request.method !== 'GET') {
      fail(response, 'method-not-allowed', 'Only GET is allowed for this route.')
      return
    }
    if (!isTrustedConsultRequest(request.headers, dependencies.trustedHosts())) {
      fail(response, 'untrusted', 'The request authority or origin is not trusted.')
      return
    }
    const sessionId = sessionIdOf(request.url)
    if (sessionId === undefined) {
      fail(response, 'missing-session', 'A valid session query parameter is required.')
      return
    }
    const session = dependencies.getSession(sessionId)
    if (session === undefined) {
      fail(response, 'unknown-session', `Session "${sessionId}" is not live.`)
      return
    }
    const cwd = session.header.cwd
    if (cwd === undefined || cwd === '') {
      fail(response, 'no-working-directory', 'The session records no working directory.')
      return
    }
    try {
      const [root, tasks] = await Promise.all([
        dependencies.projectRoot(cwd),
        dependencies.listTasks(cwd),
      ])
      respond(response, 200, { ok: true, value: panelPayload(root, tasks) })
    } catch (error) {
      fail(response, 'read-failed', `The project's tasks could not be read: ${reasonOf(error)}`)
    }
  }
}
