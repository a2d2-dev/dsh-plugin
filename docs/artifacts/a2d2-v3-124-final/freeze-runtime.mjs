import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const root = '/data/_dsh-dev/previews/a2d2-v3-121', out = new URL('./', import.meta.url)
const raw = await readFile(`${root}/evidence/metrics.jsonl`)
const metrics = raw.toString('utf8').trim().split('\n').map(JSON.parse)
const counts = Object.fromEntries(['gateway', 'adapter'].map(kind => [kind, metrics.filter(row => row.kind === kind).length]))
assert.deepEqual(counts, { gateway: 0, adapter: 0 })
const run = JSON.parse(await readFile(`${root}/current-run.json`, 'utf8'))
const status = spawnSync('supervisorctl', ['status', 'dsh-a2d2-v3-preview'], { encoding: 'utf8' })
assert.equal(status.status, 0)
assert.ok(status.stdout.includes(`RUNNING   pid ${run.launcherPid},`))
const actions = (await readFile(new URL('browser-actions.jsonl', out), 'utf8')).trim().split('\n').map(JSON.parse)
const closed = actions.findLast(row => row.args.length === 1 && row.args[0] === 'close')
assert.ok(closed?.output.includes('Browser closed'))
const profilePids = []
for (const pid of await readdir('/proc')) {
  if (!/^\d+$/.test(pid)) continue
  try {
    const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0')
    if (argv.includes(`--user-data-dir=${root}/browser-http132`) && !argv.some(arg => arg.startsWith('--type='))) profilePids.push(Number(pid))
  } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error }
}
assert.deepEqual(profilePids, [])
await writeFile(new URL('metrics.jsonl', out), raw, { flag: 'wx', mode: 0o600 })
const result = {
  observedAt: new Date().toISOString(), supervisor: { command: 'supervisorctl status dsh-a2d2-v3-preview', exitCode: status.status, stdout: status.stdout, stderr: status.stderr }, run,
  browser: { session: 'a2d2-http132', lastCloseAction: closed, remainingOwnedProfileMainPids: profilePids },
  rawMetrics: { source: `${root}/evidence/metrics.jsonl`, frozenCopy: 'metrics.jsonl', bytes: raw.length, lines: metrics.length, sha256: createHash('sha256').update(raw).digest('hex'), modelCountsRecomputedFromRaw: counts, sessionCreatedEvents: metrics.filter(row => row.kind === 'session-born') },
}
await writeFile(new URL('final-runtime-status.json', out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(result, null, 2))
