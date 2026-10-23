#!/usr/bin/env node
/**
 * Pre-pack gate (issue #194): prove the build produced every file the package
 * manifest points at before a tarball is written.
 *
 * `lib/` is git-ignored, so a missing build used to stay invisible until the
 * plugin failed to import inside a profile. Run after `pnpm build` (the
 * `prepack` script does both) so an empty-shell tarball can never be produced.
 */
import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKAGE_SIDECARS, explicitExportTargets, readPackageManifest } from './pack-manifest.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pkg = readPackageManifest(root)
const targets = explicitExportTargets(pkg.exports)

function isFile(path) {
  try {
    return statSync(path).isFile()
  }
  catch {
    return false
  }
}

const missing = targets
  .filter(({ target }) => !isFile(join(root, target)))
  .map(({ specifier, target }) => `${specifier} -> ${target}`)
const missingSidecars = PACKAGE_SIDECARS
  .filter(file => !isFile(join(root, file)))
  .map(file => file)

if (targets.length === 0 || missing.length > 0 || missingSidecars.length > 0) {
  console.error('error: the package build is incomplete — packing now would produce an uninstallable shell:')
  for (const line of missing) console.error(`  missing export target: ${line}`)
  for (const line of missingSidecars) console.error(`  missing package file: ${line}`)
  if (targets.length === 0) console.error('  no explicit export targets found in package.json')
  console.error('Run `pnpm build` first (the `prepack` script does this automatically), then retry.')
  process.exit(1)
}

console.log(
  `assert-pack-entrypoints: ${targets.length} export target files on disk; `
  + `${PACKAGE_SIDECARS.join(' and ')} present`,
)
