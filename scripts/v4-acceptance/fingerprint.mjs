import { readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

export const roles = ['plugin-tgz', 'plugin-client', 'host-cli', 'host-web', 'host-jobs', 'host-session', 'host-smoke', 'rollback-cli', 'rollback-smoke']
const shared = '/data/src/github.com/deepseek-ai/deepseek-harness-dev'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export function validateRelease(manifest) {
  for (const key of ['pluginCommit', 'hostCommit']) if (!/^[0-9a-f]{40}$/.test(manifest[key] ?? '')) throw Error(`missing fixed ${key}`)
  for (const role of roles) if (!manifest.artifacts?.some(item => item.role === role)) throw Error(`missing ${role}`)
  for (const key of ['hostRoot', 'rollbackHostRoot']) {
    if (!isAbsolute(manifest[key] ?? '')) throw Error(`missing ${key}`)
    if (manifest[key] === shared || manifest[key].startsWith(shared + '/')) throw Error('shared dev host is forbidden')
  }
  if (manifest.hostRoot === manifest.rollbackHostRoot) throw Error('new and rollback host must be independent')
  const seen = new Set()
  for (const artifact of manifest.artifacts) {
    if (seen.has(artifact.role)) throw Error(`duplicate role ${artifact.role}`)
    seen.add(artifact.role)
    if (!isAbsolute(artifact.path ?? '') || !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '')) throw Error(`invalid path/sha256: ${artifact.role}`)
  }
}
export async function verifyRelease(manifest) {
  validateRelease(manifest)
  for (const root of [manifest.hostRoot, manifest.rollbackHostRoot]) if (await realpath(root) !== root) throw Error('host roots must be canonical, not shared links')
  const git = spawnSync('git', ['-C', manifest.hostRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  if (git.status !== 0 || git.stdout.trim() !== manifest.hostCommit) throw Error('host commit mismatch')
  const artifacts = new Map()
  for (const artifact of manifest.artifacts) {
    const path = await realpath(artifact.path)
    if (path === shared || path.startsWith(shared + '/')) throw Error('artifact resolves into shared dev host')
    const bytes = await readFile(path)
    if (sha(bytes) !== artifact.sha256) throw Error(`artifact SHA mismatch: ${artifact.role}`)
    artifacts.set(artifact.role, { ...artifact, bytes })
  }
  for (const [role, root] of [['host-cli', manifest.hostRoot], ['host-web', manifest.hostRoot], ['host-jobs', manifest.hostRoot], ['host-session', manifest.hostRoot], ['rollback-cli', manifest.rollbackHostRoot]]) {
    if (!(await realpath(artifacts.get(role).path)).startsWith(root + '/')) throw Error(`artifact escapes ${role} host root`)
  }
  const cli = await realpath(artifacts.get('host-cli').path)
  if (cli !== join(manifest.hostRoot, 'apps/cli/lib/bin.js')) throw Error('unexpected CLI entry')
  const packed = spawnSync('tar', ['-xOzf', artifacts.get('plugin-tgz').path, 'package/lib/client.js'], { maxBuffer: 64 * 1024 * 1024 })
  if (packed.status !== 0 || sha(packed.stdout) !== artifacts.get('plugin-client').sha256) throw Error('tgz/client fingerprint mismatch')
  for (const role of ['host-smoke', 'rollback-smoke']) {
    const proof = JSON.parse(artifacts.get(role).bytes)
    const expectedRoot = role === 'host-smoke' ? manifest.hostRoot : manifest.rollbackHostRoot
    if (proof.passed !== true || proof.hostRoot !== expectedRoot || proof.cliSha256 !== artifacts.get(role === 'host-smoke' ? 'host-cli' : 'rollback-cli').sha256 || !Array.isArray(proof.imports) || proof.imports.length < 5 || proof.imports.some(item => item.ok !== true)) throw Error(`invalid executable/dynamic import proof: ${role}`)
    if (role === 'host-smoke' && (proof.hostCommit !== manifest.hostCommit || proof.jobsObserve !== true || proof.appendIgnorable !== true)) throw Error('host142 capability proof missing')
  }
  return { ok: true, pluginCommit: manifest.pluginCommit, hostCommit: manifest.hostCommit, verifiedRoles: [...artifacts.keys()] }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await verifyRelease(JSON.parse(await readFile(process.argv[2]))), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
