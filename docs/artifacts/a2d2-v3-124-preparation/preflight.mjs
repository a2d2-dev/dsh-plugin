import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const root = '/data/_dsh-dev/previews/a2d2-v3-121'
const out = new URL('./', import.meta.url)
const origin = 'http://10.126.126.12:18782'
const session = 'a2d2-124-prep'
function browser(args, input) {
  const result = spawnSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', input })
  assert.equal(result.status, 0, `agent-browser ${args[0]} failed`)
  return result.stdout
}
const env = {
  PATH: '/root/.nvm/versions/node/v22.23.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  DSH_HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_STATE_HOME: `${root}/state`,
  DSH_TELEMETRY_DISABLED: '1', DSH_WEB_PASSWORD_FILE: '/data/_dsh-dev/web-password',
  GH_CONFIG_DIR: '/root/.config/gh',
}
if (process.env.HOME !== undefined) env.HOME = process.env.HOME
// No auth token command: only the whitelisted environment and public identity are recorded.
const credentialProbe = spawnSync('gh', ['api', '--method', 'GET', 'user', '--jq', '{login:.login,nodeId:.node_id}'], { env, encoding: 'utf8' })
assert.equal(credentialProbe.status, 0, 'Server credential probe failed; raw stderr intentionally excluded')
const status = spawnSync('supervisorctl', ['status', 'dsh-a2d2-v3-preview'], { encoding: 'utf8' })
assert.equal(status.status, 0)
browser(['--profile', '/tmp/a2d2-124-prep-browser', 'open', `${origin}/`])
const capabilities = JSON.parse(browser(['eval', '--stdin'], '({origin:location.origin,isSecureContext,randomUUIDType:typeof crypto.randomUUID,getRandomValuesType:typeof crypto.getRandomValues,userAgent:navigator.userAgent})'))
assert.equal(capabilities.origin, origin)
assert.equal(capabilities.isSecureContext, false)
assert.equal(capabilities.randomUUIDType, 'undefined')
assert.equal(capabilities.getRandomValuesType, 'function')
const browserPids = []
for (const pid of await readdir('/proc')) {
  if (!/^\d+$/.test(pid)) continue
  try {
    const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean)
    if (argv.some(arg => arg === '--user-data-dir=/tmp/a2d2-124-prep-browser') && !argv.some(arg => arg.startsWith('--type='))) {
      const flags = argv.filter(arg => arg.startsWith('--') && !arg.includes('token='))
      browserPids.push({ pid: Number(pid), flags })
    }
  } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error }
}
assert.equal(browserPids.length, 1, 'Exactly one owned browser must be identified')
assert.ok(browserPids.every(row => row.flags.every(flag => !flag.includes('unsafely-treat-insecure-origin-as-secure') && flag !== '--disable-web-security')))
const result = {
  observedAt: new Date().toISOString(), mode: 'preparation only; unauthenticated read-only login page',
  supervisor: { exitCode: status.status, status: status.stdout.trim() },
  credentials: { probe: 'GET /user', exitCode: credentialProbe.status, identity: JSON.parse(credentialProbe.stdout), environment: env, launcherChangeApplied: false, requiredAddition: 'GH_CONFIG_DIR only' },
  capabilities, browserPids, apiMocksApplied: false, cryptoOverridesApplied: false,
  authenticatedProductAcceptance: 'not performed; awaiting CEO candidate and deployment green light',
}
await writeFile(new URL('preflight.json', out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
await writeFile(new URL('login-snapshot.txt', out), browser(['snapshot', '-i']), { flag: 'wx', mode: 0o600 })
browser(['screenshot', new URL('01-native-http-login.png', out).pathname])
console.log(JSON.stringify({ supervisor: result.supervisor, credentialProbeExitCode: credentialProbe.status, identity: result.credentials.identity, capabilities, ownedBrowserPid: browserPids[0].pid }))
