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
