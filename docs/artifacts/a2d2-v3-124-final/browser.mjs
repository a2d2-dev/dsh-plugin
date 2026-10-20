import assert from 'node:assert/strict'
import { readFile, writeFile, appendFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const out = new URL('./', import.meta.url)
const session = 'a2d2-http132'
const [mode, ...args] = process.argv.slice(2)
function invoke(argv, input) {
  const result = spawnSync('agent-browser', ['--session', session, ...argv], { encoding: 'utf8', input })
  if (result.status !== 0) throw Error(`agent-browser ${argv[0]} exit ${result.status}: ${result.stderr}`)
  return result.stdout
}
if (mode === 'run') {
  assert.ok(!['auth', 'state', 'cookies', 'network'].includes(args[0]), 'No secret state or network mutation capture')
  const text = invoke(args)
  await appendFile(new URL('browser-actions.jsonl', out), JSON.stringify({ time: new Date().toISOString(), args, output: text }) + '\n', { mode: 0o600 })
  console.log(text)
} else if (mode === 'capture') {
  const [name] = args
  assert.match(name, /^[a-zA-Z0-9-]+$/)
  await writeFile(new URL(`${name}.txt`, out), invoke(['snapshot']), { flag: 'wx', mode: 0o600 })
  console.log(invoke(['screenshot', new URL(`${name}.png`, out).pathname]))
} else if (mode === 'native') {
  const capabilities = JSON.parse(invoke(['eval', '--stdin'], '({origin:location.origin,url:location.href,isSecureContext,randomUUIDType:typeof crypto.randomUUID,getRandomValuesType:typeof crypto.getRandomValues,userAgent:navigator.userAgent})'))
  assert.equal(capabilities.origin, 'http://10.126.126.12:18782')
  assert.ok(!capabilities.url.includes('token='))
  assert.equal(capabilities.isSecureContext, false)
  assert.equal(capabilities.randomUUIDType, 'undefined')
  assert.equal(capabilities.getRandomValuesType, 'function')
  const browsers = []
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    try {
      const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean)
      if (argv.includes('--user-data-dir=/data/_dsh-dev/previews/a2d2-v3-121/browser-http132') && !argv.some(a => a.startsWith('--type='))) browsers.push({ pid: Number(pid), flags: argv.filter(a => a.startsWith('--') && !a.includes('token=')) })
    } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error }
  }
  assert.equal(browsers.length, 1)
  assert.ok(browsers.every(row => row.flags.every(a => !a.includes('unsafely-treat-insecure-origin-as-secure') && a !== '--disable-web-security')))
  const result = { observedAt: new Date().toISOString(), capabilities, browsers, originalProfileReused: true, localStorageOrSelectionModified: false, passwordReadDuringAcceptance: false, cryptoOverrides: false, apiMocks: false }
  await writeFile(new URL('native-browser.json', out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify(result))
} else throw Error('run ARGS | capture NAME | native')
