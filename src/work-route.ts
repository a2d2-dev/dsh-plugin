import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { commandSchema, querySchema } from './work-schema.ts'
import type { WorkApplication } from './work.ts'
import { WorkHostUnavailable } from './work-host.ts'
import type { RequestRejection } from './route-auth.ts'
import { rejectionError } from './route-auth.ts'
import type { WorkResult } from './work-types.ts'

const BODY_LIMIT = 1024 * 1024
const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('command'), value: commandSchema }).strict(),
  z.object({ kind: z.literal('query'), value: querySchema }).strict(),
])
function respond(response: ServerResponse, status: number, body: WorkResult): void {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
function fail(response: ServerResponse, status: number, code: string, message: string): void {
  respond(response, status, { status: 'failed', error: { code, message } })
}
function resultStatus(result: WorkResult): number {
  if (result.status === 'completed') return 200
  if (result.status === 'conflict') return 409
  const code = result.error.code
  if (['github-unauthorized', 'github-forbidden', 'github-not-found', 'github-credentials-unavailable'].includes(code)) return 424
  if (code === 'github-rate-limited') return 429
  if (['github-offline', 'github-unavailable', 'github-capability-unavailable'].includes(code)) return 503
  if (code === 'github-invalid-response') return 502
  return 400
}
class Oversize extends Error {}
async function readJson(request: IncomingMessage): Promise<unknown> {
  const declared = request.headers['content-length']
  if (typeof declared === 'string' && Number(declared) > BODY_LIMIT) throw new Oversize()
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk)
    size += bytes.byteLength
    if (size > BODY_LIMIT) throw new Oversize()
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Production trusted UI entry: the host operator check precedes all parsing, reads and writes. */
export function createWorkHandler(app: WorkApplication, requestRejection: RequestRejection) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const rejection = requestRejection(request)
    if (rejection) {
      const error = rejectionError(rejection)
      fail(response, rejection, error.code, error.message)
      return
    }
    if (request.method !== 'POST') { fail(response, 405, 'method-not-allowed', 'Only POST is allowed'); return }
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers['content-type'] ?? '')) {
      fail(response, 415, 'unsupported-content-type', 'Use application/json'); return
    }
    let raw: unknown
    try { raw = await readJson(request) }
    catch (error) {
      if (error instanceof Oversize) fail(response, 413, 'payload-too-large', 'Work request exceeds one MiB')
      else fail(response, 400, 'bad-json', 'Work request must contain valid JSON')
      return
    }
    const parsed = requestSchema.safeParse(raw)
    if (!parsed.success) { fail(response, 400, 'invalid-request', 'Use a valid work command or query envelope'); return }
    // Recheck after body acquisition as login/trust can change while receiving it.
    const currentRejection = requestRejection(request)
    if (currentRejection) {
      const error = rejectionError(currentRejection)
      fail(response, currentRejection, error.code, error.message); return
    }
    try {
      const result = parsed.data.kind === 'command'
        ? await app.execute(parsed.data.value, { operator: true })
        : await app.query(parsed.data.value, { operator: true })
      respond(response, resultStatus(result), result)
    } catch (error) {
      if (error instanceof WorkHostUnavailable) fail(response, 503, 'host-capability-unavailable', error.message)
      else fail(response, 503, 'work-record-unavailable', 'Local work records could not be accessed safely')
    }
  }
}
