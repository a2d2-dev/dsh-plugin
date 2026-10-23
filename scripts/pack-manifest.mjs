/**
 * Shared derivation of what a packed tarball must contain.
 *
 * `scripts/assert-pack-entrypoints.mjs` uses it to prove the build emitted every
 * file package.json promises; `scripts/verify-pack-exports.mjs` uses it to prove
 * the tarball actually carries those files. Both read the same manifest, so the
 * pre-pack assertion and the release check cannot drift apart.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Files the plugin cannot activate without; they must survive packing. */
export const PACKAGE_SIDECARS = ['dsh.plugin.json', 'cordis.patch.yml']

export function readPackageManifest(root) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
}

/**
 * Every file an explicit export can resolve to, types included. Wildcard
 * subpaths (`./src/*`) and `./package.json` name no single file and are skipped.
 */
export function explicitExportTargets(exportsMap) {
  const targets = []
  for (const [specifier, entry] of Object.entries(exportsMap ?? {})) {
    if (specifier === './package.json' || specifier.includes('*')) continue
    const values = typeof entry === 'string' ? [entry] : Object.values(entry ?? {})
    for (const target of values) {
      if (typeof target === 'string') targets.push({ specifier, target })
    }
  }
  return targets
}

/**
 * The host-side import specifiers: explicit `./lib/*.js` entrypoints. The
 * `./client` bundle is a browser classic script that registers itself on
 * `window.__ModuleLoader__`, so Node cannot import it; its files are still
 * asserted on disk and inside the tarball.
 */
export function exportedNodeEntrypoints(exportsMap, packageName) {
  return explicitExportTargets(exportsMap)
    .filter(({ target }) => target.startsWith('./lib/') && target.endsWith('.js') && !target.endsWith('/client.js'))
    .map(({ specifier }) => (specifier === '.' ? packageName : `${packageName}/${specifier.slice(2)}`))
}
