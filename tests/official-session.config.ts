import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Explicit opt-in lane, never skip: all runtime imports come from the built,
// unmodified official checkout. No symlinks, dependency installs or Host writes.
const root = process.env.DSH_OFFICIAL_HOST_ROOT
if (!root) throw new Error('DSH_OFFICIAL_HOST_ROOT must point to the built official checkout')
const expectedHead = process.env.DSH_OFFICIAL_HOST_COMMIT ?? '22ddee3792402c3e70ec5f86a63c3e3e895a2f60'
const expectedVersion = process.env.DSH_OFFICIAL_HOST_VERSION ?? '0.2.1-rc.3'
if (!/^[0-9a-f]{40}$/.test(expectedHead)
  || execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== expectedHead
  || execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim() !== '') throw new Error('Official fixture requires the exact clean candidate commit')
const packages = new Map<string, string>()
for (const group of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
  if (!group.isDirectory()) continue
  for (const entry of readdirSync(join(root, 'packages', group.name), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = join(root, 'packages', group.name, entry.name, 'package.json')
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; version?: string }
      if (pkg.name) packages.set(pkg.name, manifest)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
for (const entry of readdirSync(join(root, 'vendor'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifest = join(root, 'vendor', entry.name, 'package.json')
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string }
  packages.set(pkg.name, manifest)
}
for (const entry of readdirSync(join(root, 'native/system/packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifest = join(root, 'native/system/packages', entry.name, 'package.json')
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string }
  packages.set(pkg.name, manifest)
}
const controller = packages.get('@deepseek-ai/dsh-api-session-controller')
if (!controller || JSON.parse(readFileSync(controller, 'utf8')).version !== expectedVersion) throw new Error(`Official fixture requires SessionController ${expectedVersion}`)
const requireHost = createRequire(controller)
export default defineConfig({
  root: resolve('.'),
  plugins: [{
    name: 'official-host-public-packages',
    enforce: 'pre',
    resolveId(id) {
      if (!id.startsWith('@deepseek-ai/')) return
      const name = id.split('/').slice(0, 2).join('/')
      const manifest = packages.get(name)
      try { return (manifest ? createRequire(manifest) : requireHost).resolve(id) }
      catch (cause) { throw new Error(`Official built package unavailable: ${id}`, { cause }) }
    },
  }],
  test: {
    include: ['tests/official-session.integration.ts'],
    environment: 'node',
    maxWorkers: 1,
    testTimeout: 15_000,
    server: { deps: { inline: [/^@deepseek-ai\//] } },
  },
  cacheDir: resolve('.local/tmp/official-vite'),
})
