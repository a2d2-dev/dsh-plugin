import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, realpath, lstat, open } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isAbsolute, join, dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const namespace = '/tmp/a2d2-v3-121/'
const toolDirectory = dirname(fileURLToPath(import.meta.url))
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const save = (path, data, flag = 'w') => writeFile(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag })
export function isolatedEnvironment(root, inherited = process.env) {
  return { PATH: inherited.PATH, DSH_HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_STATE_HOME: `${root}/state`, DSH_TELEMETRY_DISABLED: '1' }
}
export function assertUnchanged(baseline, current) {
  const ordered = value => [...value].sort((a, b) => a.sessionId.localeCompare(b.sessionId))
  if (JSON.stringify(ordered(baseline.sessions)) !== JSON.stringify(ordered(current.sessions))) throw new Error('Session identity or configuration changed')
  if (current.gateway !== 0 || current.adapter !== 0) throw new Error('Unexpected model call')
  if (baseline.births !== current.births) {
    const known = new Set(baseline.sessions.map(row => row.sessionId))
    if (baseline.processId === current.processId || !current.bornSessionIds?.length || current.bornSessionIds.some(id => !known.has(id))) throw new Error('Unexpected Session birth')
  }
}
function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(`${program} exited ${result.status}: ${result.stderr}`)
  return result.stdout.trim()
}
async function checkedRoot(root) {
  if (typeof root !== 'string' || !isAbsolute(root) || !root.startsWith(namespace) || resolve(root) !== root) throw new Error('root must be a canonical path inside ticket temporary namespace')
  // Find the nearest existing ancestor without creating anything. lstat also catches
  // dangling symlinks; realpath equality rejects symlinks anywhere in its parents.
  let parent = root
  while (true) {
    let entry
    try { entry = await lstat(parent) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      parent = dirname(parent)
      continue
    }
    if (!entry.isDirectory() || await realpath(parent) !== parent) throw new Error('root has a symlink or noncanonical parent')
    break
  }
  await mkdir(root, { recursive: true, mode: 0o700 })
  if (await realpath(root) !== root) throw new Error('root escapes its canonical path through a symlink')
  return root
}
export async function prepare({ host, root, plugin, hostOnly = false }) {
  if (!isAbsolute(host)) throw new Error('host must be an absolute existing checkout')
  await checkedRoot(root)
  if (hostOnly === Boolean(plugin)) throw new Error('choose exactly --host-only or --plugin <absolute tgz>')
  const manifestPath = join(root, 'manifest.json')
  const lock = await open(manifestPath, 'wx', 0o600)
  await lock.close()
  host = await realpath(host)
  const cli = join(host, 'apps/cli/lib/bin.js')
  const anchor = join(host, 'packages/bundle/web-app/package.json')
  const require = createRequire(anchor)
  const llm = createRequire(join(host, 'packages/bundle/base/package.json')).resolve('@deepseek-ai/dsh-llm')
  const modules = {}
  for (const name of ['@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-api-workspace-controller', '@deepseek-ai/dsh-client-modules']) modules[name] = require.resolve(name)
  for (const directory of ['home', 'config', 'state', 'workspace', 'browser-profile', 'logs', 'evidence', 'ipc']) await mkdir(join(root, directory), { mode: 0o700 })
  const env = isolatedEnvironment(root)
  const manifest = { root, host, cli, anchor, llm, modules, hostCommit: command('git', ['-C', host, 'rev-parse', 'HEAD']), cliVersion: command(process.execPath, [cli, '--version'], { env, cwd: join(root, 'workspace') }), nodeVersion: process.version, hostOnly, plugin: null, preparedAt: new Date().toISOString() }
  if (plugin) {
    if (!isAbsolute(plugin) || !plugin.endsWith('.tgz')) throw new Error('plugin must be an absolute built tgz')
    plugin = await realpath(plugin)
    manifest.plugin = { path: plugin, sha256: createHash('sha256').update(await readFile(plugin)).digest('hex') }
    // The official installer writes only into this run's isolated DSH home.
    const install = command(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', plugin], { env, cwd: join(root, 'workspace'), timeout: 120_000 })
    await writeFile(join(root, 'logs/install.log'), install, { mode: 0o600 })
  }
  await mkdir(join(root, 'guard'), { mode: 0o700 })
  await save(join(root, 'guard/package.json'), { name: 'a2d2-v3-121-disabled-guard', private: true, type: 'module' }, 'wx')
  await writeFile(join(root, 'guard/guard.mjs'), await readFile(join(toolDirectory, 'guard.mjs')), { mode: 0o600, flag: 'wx' })
  // JSON is a YAML subset. Whole config replacements are intentional.
  const patch = [
    ...['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-title-llm', 'session-telemetry-otel', 'hmr'].map(id => ({ id, disabled: true })),
    { id: 'agent-default-model', config: { provider: 'acceptance-disabled', model: 'no-model' } },
    { id: 'workspace-controller', config: { documentsDirectory: join(root, 'workspace') } },
    { id: 'session-persistence-jsonl', config: { root: join(root, 'home/sessions') } },
    { id: 'storage-json', config: { root: join(root, 'home/storages') } },
    { id: 'session-log-deepseek', config: { enabled: false } },
    { id: 'ui-plugin-manager', config: { registryProbeEnabled: false } },
    ...hostOnly ? [] : [{ id: 'a2d2-task-runtime', config: { enabled: false } }],
    { insert: [{ id: 'a2d2-v3-121-guard', name: join(root, 'guard/guard.mjs'), config: { root, llm } }] },
  ]
  await save(join(root, 'acceptance.patch.yml'), patch, 'wx')
  await save(manifestPath, manifest)
  return manifest
}
export async function request(root, action) {
  await checkedRoot(root)
  const id = randomUUID()
  const response = join(root, 'ipc', `${id}.response.json`)
  await save(join(root, 'ipc', `${id}.request.json`), { action }, 'wx')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const result = await json(response)
      if (!result.ok) throw new Error(result.error)
      return result.value
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    await delay(100)
  }
  throw new Error(`guard command ${action} timed out; do not interpret as zero calls`)
}
export async function run(root) {
  await checkedRoot(root)
  const manifest = await json(join(root, 'manifest.json'))
  if (command('git', ['-C', manifest.host, 'rev-parse', 'HEAD']) !== manifest.hostCommit) throw new Error('Host commit changed after preparation')
  if (manifest.plugin && createHash('sha256').update(await readFile(manifest.plugin.path)).digest('hex') !== manifest.plugin.sha256) throw new Error('Plugin tgz changed after preparation')
  const runId = randomUUID()
  const log = await open(join(root, 'logs', `${runId}.log`), 'wx', 0o600)
  const child = spawn(process.execPath, [manifest.cli, 'web', '--patch', join(root, 'acceptance.patch.yml'), '--no-open', '--host', '127.0.0.1', '--port', '0'], { cwd: join(root, 'workspace'), env: isolatedEnvironment(root), stdio: ['ignore', 'pipe', 'pipe'] })
  let announced = false
  let pending = ''
  const startedAt = new Date().toISOString()
  const capture = async data => {
    await log.write(data)
    pending = (pending + data.toString()).slice(-64_000)
    const match = pending.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\S*)/)
    if (announced || !match) return
    announced = true
    const login = new URL(match[1])
    if (['18780', '18781'].includes(login.port)) { child.kill('SIGTERM'); throw new Error('refusing existing-service port') }
    await writeFile(join(root, 'login-url.private'), login.href, { mode: 0o600 })
    const run = { runId, pid: child.pid, supervisorPid: process.pid, startedAt, baseURL: login.origin, hostCommit: manifest.hostCommit, cliVersion: manifest.cliVersion, plugin: manifest.plugin, managedJobId: null }
    await save(join(root, 'current-run.json'), run)
    await save(join(root, 'evidence', `${runId}-run.json`), run, 'wx')
    console.log(JSON.stringify({ ready: true, baseURL: login.origin, runId, pid: child.pid }))
  }
  // Serialize output writes so raw credentials stay only in the private log.
  let output = Promise.resolve()
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = output.then(() => capture(data)) })
  const stop = () => child.kill('SIGTERM')
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  child.once('error', error => { console.error(error.message); process.exitCode = 1 })
  const exit = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  await output
  await log.close()
  await save(join(root, 'evidence', `${runId}-exit.json`), exit, 'wx')
  process.removeListener('SIGTERM', stop)
  process.removeListener('SIGINT', stop)
  console.log(JSON.stringify({ stopped: true, runId, ...exit }))
  process.exitCode = exit.code ?? (exit.signal === 'SIGTERM' ? 0 : 1)
  if (!announced) throw new Error('Host exited without Web readiness; zero-call acceptance invalid')
}
async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { host: { type: 'string' }, root: { type: 'string' }, plugin: { type: 'string' }, 'page-evidence': { type: 'string' }, 'host-only': { type: 'boolean' }, job: { type: 'string' } } })
  const [action] = positionals
  const root = values.root
  if (action !== 'prepare') await checkedRoot(root)
  if (action === 'prepare') console.log(JSON.stringify(await prepare({ host: values.host, root, plugin: values.plugin, hostOnly: values['host-only'] }), null, 2))
  else if (action === 'run') await run(root)
  else if (action === 'job') {
    if (!values.job) throw new Error('--job is required')
    const current = await json(join(root, 'current-run.json'))
    current.managedJobId = values.job
    await save(join(root, 'current-run.json'), current)
    await save(join(root, 'evidence', `${current.runId}-run.json`), current)
    console.log(JSON.stringify(current))
  } else if (['positive', 'seed', 'snapshot'].includes(action)) console.log(JSON.stringify(await request(root, action), null, 2))
  else if (action === 'baseline') {
    const pageEvidence = values['page-evidence']
    if (!pageEvidence || !isAbsolute(pageEvidence) || !pageEvidence.startsWith(`${root}/`)) throw new Error('Baseline requires --page-evidence <absolute browser PNG inside this isolated run>')
    const screenshot = await readFile(pageEvidence)
    if (screenshot.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Page evidence must be a real browser PNG screenshot')
    const run = await json(join(root, 'current-run.json'))
    if (!run.managedJobId) throw new Error('Register the managed job before freezing a baseline')
    const current = await request(root, 'snapshot')
    if (current.pid !== run.pid) throw new Error('Guard snapshot does not belong to current Web process')
    current.pageEvidence = { path: pageEvidence, sha256: createHash('sha256').update(screenshot).digest('hex') }
    if (current.gateway !== 0 || current.adapter !== 0) throw new Error('Baseline requires a new zero-call process/environment')
    if (current.sessions.length === 0) throw new Error('Baseline requires real Sessions and a verified page')
    await save(join(root, 'evidence/baseline.json'), current, 'wx')
    console.log(JSON.stringify(current, null, 2))
  } else if (action === 'check') {
    const current = await request(root, 'snapshot')
    assertUnchanged(await json(join(root, 'evidence/baseline.json')), current)
    await save(join(root, 'evidence', `${Date.now()}-check.json`), current, 'wx')
    console.log(JSON.stringify({ unchanged: true, ...current }, null, 2))
  } else throw new Error('Usage: acceptance.mjs prepare|run|job|positive|seed|snapshot|baseline|check --root /tmp/a2d2-v3-121/<run> [--host /absolute/host --host-only | --plugin /absolute/plugin.tgz]')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
