import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

/**
 * Guards the release contract that made issue #194 silent: `lib/` is
 * git-ignored, so a checkout without a build packs an empty shell unless
 * packing itself builds. These assertions fail on the manifest that shipped
 * the bug, before and independently of `pnpm verify:pack-exports`.
 */

interface PackageManifest {
  readonly name: string
  readonly exports: Record<string, string | Record<string, string>>
  readonly files: readonly string[]
  readonly scripts: Record<string, string>
}

interface PatchRow {
  readonly id?: string
  readonly name?: string
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageManifest
const patch = (parseYaml(readFileSync(join(root, 'cordis.patch.yml'), 'utf8')) as {
  readonly insert: readonly PatchRow[]
}[])[0]

interface ExportTarget {
  readonly specifier: string
  readonly target: string
}

/** Every file an explicit (non-wildcard) export can resolve to, types included. */
function explicitExportTargets(exportsMap: PackageManifest['exports']): ExportTarget[] {
  const targets: ExportTarget[] = []
  for (const [specifier, entry] of Object.entries(exportsMap)) {
    if (specifier === './package.json' || specifier.includes('*')) continue
    const values = typeof entry === 'string' ? [entry] : Object.values(entry)
    for (const target of values) {
      if (typeof target === 'string') targets.push({ specifier, target })
    }
  }
  return targets
}

/** npm `files` glob semantics the manifest relies on: `*` stays in a segment, `**` crosses. */
function globMatches(pattern: string, path: string): boolean {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern.startsWith('**/', index)) {
      source += '(?:[^/]+/)*'
      index += 2
      continue
    }
    if (pattern.startsWith('**', index)) {
      source += '.*'
      index += 1
      continue
    }
    const char = pattern[index] ?? ''
    if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  }
  return new RegExp(`${source}$`, 'u').test(path)
}

function defaultTarget(entry: string | Record<string, string> | undefined): string | undefined {
  if (typeof entry === 'string') return entry
  return entry?.default
}

describe('pack manifest', () => {
  it('builds and asserts the shipped entrypoints before packing', () => {
    const prepack = pkg.scripts.prepack
    expect(prepack, 'package.json scripts.prepack is what makes a clean checkout pack a built tarball').toBeTruthy()
    expect(prepack).toMatch(/\bpnpm\b.*\bbuild\b|pnpm run build/u)
    expect(prepack).toContain('scripts/assert-pack-entrypoints.mjs')
    expect(existsSync(join(root, 'scripts/assert-pack-entrypoints.mjs'))).toBe(true)
  })

  it('ships every explicit export target through the files list', () => {
    const targets = explicitExportTargets(pkg.exports)
    expect(targets.length).toBeGreaterThan(0)
    const uncovered = targets.filter(({ target }) => {
      const path = target.replace(/^\.\//u, '')
      return !pkg.files.some(pattern => globMatches(pattern, path))
    })
    expect(uncovered).toEqual([])
  })

  it('declares eight mount rows that resolve to built explicit exports', () => {
    const rows = patch?.insert ?? []
    expect(rows).toHaveLength(8)
    const names = rows.map(row => row.name)
    expect(new Set(names).size).toBe(8)
    const explicitSpecifiers = new Set(
      Object.keys(pkg.exports).filter(specifier => specifier !== './package.json' && !specifier.includes('*')),
    )

    expect(names).toContain(pkg.name)
    for (const row of rows) {
      const name = row.name
      expect(typeof name).toBe('string')
      if (name === pkg.name) continue
      expect(name?.startsWith(`${pkg.name}/`), `${String(name)} must be the package or one of its subpaths`).toBe(true)
      const subpath = `./${String(name).slice(pkg.name.length + 1)}`
      expect(explicitSpecifiers.has(subpath), `${String(name)} must be declared in package.json exports`).toBe(true)
      const target = defaultTarget(pkg.exports[subpath])
      expect(target, `${subpath} must declare a default target`).toBeDefined()
      expect(target).toMatch(/^\.\/lib\/.+\.js$/u)
    }
  })
})
