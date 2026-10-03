/**
 * Browser authentication for the A2D2 HTTP routes.
 *
 * The routes are registered on DSH's `webServer`, outside the channels DSH
 * itself authenticates, so each one asks the composition's `connection`
 * service first. `requestRejection` applies the same Host/Origin fence and
 * login-cookie check as DSH's built-in channels; a Host or Origin header alone
 * is forgeable by any non-browser client and is never enough.
 *
 * @module @deepseek-ai/dsh-a2d2/src/route-auth
 */

import type { IncomingHttpHeaders } from 'node:http'

/** The status DSH's connection service refuses a request with: 401 unauthenticated, 403 untrusted authority or origin. */
export type RouteRejection = 401 | 403

/**
 * The `connection` service's request check, as the routes consume it.
 * @param request - the incoming request's headers.
 * @returns the refusal status, or `undefined` when the caller is a logged-in browser on a trusted authority.
 */
export type RequestRejection = (request: { readonly headers: IncomingHttpHeaders }) => RouteRejection | undefined

/** The JSON error each refusal status answers with. */
export function rejectionError(status: RouteRejection): { readonly code: 'unauthenticated' | 'untrusted'; readonly message: string } {
  return status === 401
    ? { code: 'unauthenticated', message: 'Sign in to DSH in this browser to use this route.' }
    : { code: 'untrusted', message: 'The request authority or origin is not trusted.' }
}

/** The JSON error a write route answers a request without a JSON body with. */
export interface UnsupportedMediaType {
  readonly status: 415
  readonly code: 'unsupported-media-type'
  readonly message: string
}

/**
 * The write routes' content-type check, asked right after authentication and
 * before reading the body or touching any state.
 *
 * DSH's login cookie is same-site, so a page on another port of the same host
 * can make a logged-in browser send a "simple" POST — `text/plain`, a form
 * encoding, or no body at all — that skips the CORS preflight. Only
 * `application/json` (parameters such as `charset` allowed) forces a preflight
 * such a page cannot pass, so write routes accept nothing else.
 * @param request - the incoming request's headers.
 * @returns the 415 refusal, or `undefined` when the request declares JSON.
 */
export function contentTypeRejection(request: { readonly headers: IncomingHttpHeaders }): UnsupportedMediaType | undefined {
  const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType === 'application/json') return undefined
  return {
    status: 415,
    code: 'unsupported-media-type',
    message: 'Write requests must send content-type: application/json.',
  }
}
