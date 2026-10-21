import { readFile, writeFile, mkdir, readdir, realpath, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { canonical } from './retention.mjs'

export const instances = {
  gui: { origin: 'http://127.0.0.1:18781', home: '/data/_dsh-dev', program: 'dsh-dev-web-server' },
  preview: { origin: 'http://10.126.126.12:18782', home: '/data/_dsh-dev/previews/a2d2-v3-121/home', program: 'dsh-a2d2-v3-preview' },
}
const host = '/data/src/github.com/deepseek-ai/deepseek-harness-dev'
const hash = value => createHash('sha256').update(value).digest('hex')
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) throw Error(`${cmd} failed (${result.status}); inspect privately, no fallback`)
  return result.stdout
}
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
async function files(root) {
  const output = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) output.push(...await files(path))
    else if (entry.isFile()) output.push(path)
  }
  return output.sort()
}
async function login(origin) {
  const password = (await readFile('/data/_dsh-dev/web-password', 'utf8')).trim()
  const response = await fetch(`${origin}/?token=${encodeURIComponent(password)}`, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (response.status !== 303 || !cookie) throw Error('Private local login failed')
  return cookie
}
async function sessionList(origin, cookie) {
  const response = await fetch(`${origin}/api/session/list`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/list', payload: { args: { _request: {} } } }), signal: AbortSignal.timeout(30000) })
  const value = await response.json()
  if (value.result?.ok !== true || !Array.isArray(value.result.value.items)) throw Error('Public session/list unavailable; baseline incomplete')
  return value.result.value.items
}
async function capture(name, root) {
  const instance = instances[name]
  if (!instance || !root?.startsWith('/tmp/a2d2-v4-') || resolve(root) !== root) throw Error('Usage: capture.mjs gui|preview /tmp/a2d2-v4-<unique-private-directory>')
  await mkdir(root, { mode: 0o700 }) // exclusive directory; never overwrite an earlier baseline
  if (await realpath(root) !== root || (await lstat(root)).mode & 0o077) throw Error('Private evidence root must be canonical mode 0700')
  await mkdir(join(root, 'raw'), { mode: 0o700 })
  const records = [], fingerprints = [], warnings = []
  const backup = async path => {
    const bytes = await readFile(path), digest = hash(bytes)
    await writeFile(join(root, 'raw', hash(path)), bytes, { flag: 'wx', mode: 0o600 })
    fingerprints.push({ path, realpath: await realpath(path), bytes: bytes.length, sha256: digest })
    return bytes
  }
  const cookie = await login(instance.origin)
  const publicRows = await sessionList(instance.origin, cookie)
  await save(join(root, 'session-list.private.json'), publicRows)
  const [cookieName, ...cookieValue] = cookie.split('=')
  await save(join(root, 'browser.private.json'), { cookies: [{ name: cookieName, value: cookieValue.join('='), domain: new URL(instance.origin).hostname, path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] })
  const journalPaths = (await files(join(instance.home, 'sessions'))).filter(path => path.endsWith('.jsonl.zstd'))
  for (const path of journalPaths) {
    const compressed = await backup(path)
    const decoded = spawnSync('zstd', ['-dc'], { input: compressed, maxBuffer: 256 * 1024 * 1024 })
    if (decoded.status !== 0) throw Error('Journal decode failed; no fallback')
    const events = decoded.stdout.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    const header = events[0]
    if (header?.type !== 'session' || !header.id || !header.cwd) throw Error('Invalid persisted session header')
    const config = {}
    for (const event of events.slice(1)) if (['model/selection', 'permission/preset', 'sandbox/mode', 'approval/policy', 'agent/preset'].includes(event.type)) config[event.type] = event.data
    const live = publicRows.find(row => row.sessionId === header.id)
    const projections = live?.projections?.values
    // Public configuration projections may resolve defaults; don't activate cold Sessions.
    const publicConfiguration = Object.fromEntries(Object.entries(projections ?? {}).filter(([key]) => ['modelSelection', 'permissions', 'agentPreset'].includes(key)))
    records.push({ kind: 'session', id: header.id, identity: { cwd: header.cwd, agentPreset: header.agentPreset ?? null, config, publicConfiguration }, history: events.map(event => hash(canonical(event))) })
    if (!config['model/selection'] || !config['permission/preset']) warnings.push(`${header.id}: persisted selection incomplete; effective policy requires later live public observation`)
  }
  const known = new Set(records.filter(row => row.kind === 'session').map(row => row.id))
  for (const row of publicRows) if (!known.has(row.sessionId)) warnings.push(`${row.sessionId}: public Session not yet persisted at capture; flush/final baseline required`)
  const profile = join(instance.home, 'profiles/web')
  for (const name of ['package.json', 'pnpm-lock.yaml', 'cordis.yml', 'cordis.patch.yml']) {
    try { await backup(join(profile, name)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const plugin = join(profile, 'node_modules/dsh-a2d2')
  const pluginRoot = await realpath(plugin)
  await backup(join(plugin, 'package.json'))
  await backup(join(plugin, 'lib/client.js'))
  const manifest = JSON.parse(await readFile(join(profile, 'package.json')))
  const dependency = manifest.dependencies?.['dsh-a2d2']
  if (dependency?.startsWith('file:') && dependency.endsWith('.tgz')) await backup(resolve(profile, dependency.slice(5)))
  const store = join(instance.home, 'a2d2/work-v3')
  try {
    const runtime = JSON.parse(await backup(join(store, 'runtime-v1.json')))
    records.push({ kind: 'runtime', id: runtime.runtimeId, identity: runtime, history: [] })
    const domain = JSON.parse(await backup(join(store, 'work-v3.json')))
    for (const kind of ['projects', 'agents', 'tasks', 'sources', 'externalBindings', 'executions', 'commands', 'legacyMappings']) {
      for (const [index, row] of (domain[kind] ?? []).entries()) {
        const id = row.id ?? row.commandId ?? hash(canonical(row.ref ?? row.address ?? row))
        const identity = structuredClone(row)
        // Only explicit append-only histories are relaxed. Status/config changes fail closed.
        for (const key of ['activity', 'history', 'specificationHistory', 'events', 'continuationHistory', 'retired']) if (Array.isArray(identity[key])) {
          records.push({ kind: `${kind}.${key}`, id: String(id), identity: {}, history: identity[key].map(value => hash(canonical(value))) })
          delete identity[key]
        }
        records.push({ kind, id: String(id), identity: { sha256: hash(canonical(identity)) }, history: [] })
      }
    }
    records.push({ kind: 'externalIndex', id: 'canonical', identity: domain.externalIndex ?? {}, history: [] })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    warnings.push('work-v3 store absent: current instance may still use legacy plugin; not a v4 pass')
  }
  await backup(join(instance.home, 'storages/workspace.json'))
  for (const relative of ['apps/cli/lib/bin.js', 'apps/web/dist/index.html', 'packages/jobs/jobs-local/lib/index.js', 'packages/session/session/lib/index.js']) {
    try { await backup(join(host, relative)) } catch (error) { if (error.code !== 'ENOENT') throw error; warnings.push(`Host artifact absent: ${relative}`) }
  }
  const service = run('supervisorctl', ['status', instance.program]).trim()
  const hostCommit = run('git', ['-C', host, 'rev-parse', 'HEAD']).trim()
  const observation = { schemaVersion: 1, capturedAt: new Date().toISOString(), origin: instance.origin, program: instance.program, service, hostCommit, pluginRoot, dependency, fingerprints, records, warnings, coverage: { modelCalls: 'not instrumented; no model command issued by this collector', effectiveLivePermissions: 'not verified; persisted selections and public projections only', snapshot: 'sequential read; repeat after settlement and Session flush before deployment' } }
  await save(join(root, 'baseline.json'), observation)
  console.log(JSON.stringify({ privateRoot: root, origin: instance.origin, records: records.length, sessions: known.size, service, warnings }, null, 2))
}
try { await capture(...process.argv.slice(2)) } catch (error) { console.error(error.message); process.exitCode = 1 }
