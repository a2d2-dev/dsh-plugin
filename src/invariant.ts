/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-a2d2`.
 * @module @deepseek-ai/dsh-a2d2/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-a2d2'

/** Cordis companion plugin name. */
export const name = 'a2d2-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this service is a stateless façade over task documents,
 * so it owns no in-process mutable relation to re-assert. The only state it has
 * is file content, and that relation is already checked where it can be —
 * `parseTaskDocument` validates every document at the read boundary, and the
 * service refuses a mutating call whose document fails it.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
