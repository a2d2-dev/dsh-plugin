import { readFile, open, realpath, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyRelease } from './fingerprint.mjs'

const origins = { 'dsh-dev-web-server': 'http://127.0.0.1:18781', 'dsh-a2d2-v3-preview': 'http://10.126.126.12:18782' }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export function validateSettlement(plan, proof, pid, now = Date.now()) {
  for (const key of ['runId', 'program', 'origin']) if (!plan[key] || proof[key] !== plan[key]) throw Error(`settlement ${key} mismatch`)
  if (proof.source !== 'live-host-public-services' || proof.pid !== pid || proof.admissionHeld !== true || !Number.isFinite(Date.parse(proof.heldUntil)) || Date.parse(proof.heldUntil) <= now || Date.parse(proof.heldUntil) > now + 60000) throw Error('missing fresh held admission/PID proof')
  const expected = [...(plan.liveSessionIds ?? [])].sort()
  if (!expected.length || !Array.isArray(proof.sessions) || JSON.stringify(proof.sessions.map(s => s.id).sort()) !== JSON.stringify(expected) || proof.sessions.some(s => s.idle !== true || s.flush !== true)) throw Error('CEO/Session idle or durable flush incomplete')
  if (!Array.isArray(plan.childIds) || !Array.isArray(proof.children) || JSON.stringify(proof.children.map(child => child.id).sort()) !== JSON.stringify([...plan.childIds].sort()) || proof.children.some(child => child.settled !== true || !child.resultReceipt)) throw Error('children not settled/collected or omitted')
  if (proof.registryComplete !== true) throw Error('complete exact-owner registry observation required')
  if (!Array.isArray(proof.jobs) || proof.jobs.some(job => job.terminalResult !== 'collected' || !job.registryEpoch || !job.instanceId || !job.receipt)) throw Error('job still running, pending, or unknown')
  if (proof.pendingInputs !== 0) throw Error('pending input must be retained and settled before restart')
}
function command(program, args, timeout = 120000) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw Error(`command failed: ${program} (${result.status ?? result.signal}); inspect private unit log`)
  return result.stdout
}
function serviceStatus(program) {
  const result = spawnSync('supervisorctl', ['status', program], { encoding: 'utf8', timeout: 10000 })
  if (![0, 3].includes(result.status) || !result.stdout.trim().startsWith(program + ' ') || !/\b(RUNNING|STOPPED|EXITED|FATAL|BACKOFF|STARTING|STOPPING)\b/.test(result.stdout)) throw Error('cannot read exact target Supervisor status')
  return result.stdout
}
async function inspect(plan) {
  const reasons = []
  if (!/^[a-z0-9-]+$/.test(plan.runId ?? '')) reasons.push('missing stable runId')
  if (!origins[plan.program] || plan.origin !== origins[plan.program]) reasons.push('only the two exact existing programs/origins are allowed')
  try { await verifyRelease(plan.release) } catch (error) { reasons.push(error.message) }
  for (const kind of ['apply', 'verify', 'rollback', 'rollbackVerify']) {
    const action = plan.actions?.[kind]
    try {
      if (!isAbsolute(action?.script ?? '') || !/^[a-f0-9]{64}$/.test(action?.sha256 ?? '') || sha(await readFile(action.script)) !== action.sha256) throw Error()
    } catch { reasons.push(`missing reviewed/pinned ${kind} action`) }
  }
  if (!plan.settlement || !plan.liveSessionIds?.length) reasons.push('live maintenance/flush proof and exact live Session set required')
  if (plan.settlement && plan.liveSessionIds?.length && origins[plan.program]) {
    try {
      const proof = JSON.parse(await readFile(plan.settlement))
      const pid = Number(serviceStatus(plan.program).match(/RUNNING\s+pid (\d+)/)?.[1])
      validateSettlement(plan, proof, pid)
      for (const receipt of [...proof.children.map(row => row.resultReceipt), ...proof.jobs.map(row => row.receipt)]) if (!receipt.path || !/^[a-f0-9]{64}$/.test(receipt.sha256 ?? '') || sha(await readFile(receipt.path)) !== receipt.sha256) throw Error('result receipt missing/changed')
    } catch (error) { reasons.push(`invalid real settlement: ${error.message}`) }
  }
  if (plan.program === 'dsh-dev-web-server') {
    try {
      const receiptBytes = await readFile(plan.previewVerifiedReceiptPath)
      const receipt = JSON.parse(receiptBytes)
      for (const role of ['plugin-tgz', 'plugin-client', 'host-cli']) if (receipt.deployed?.[role] !== plan.release.artifacts.find(item => item.role === role)?.sha256) throw Error()
      if (sha(receiptBytes) !== plan.previewVerifiedReceiptSha256 || receipt.status !== 'deployment-verified' || receipt.origin !== origins['dsh-a2d2-v3-preview'] || receipt.pluginCommit !== plan.release.pluginCommit || receipt.hostCommit !== plan.release.hostCommit) throw Error()
    } catch { reasons.push('matching real preview completion receipt required before actual GUI') }
  }
  if (plan.prepareOnly !== false) reasons.push('prepareOnly; deployment not authorized')
  return reasons
}
async function main() {
  const [path, flag] = process.argv.slice(2)
  if (flag && flag !== '--execute') throw Error('Usage: one-shot.mjs PLAN.json [--execute]; default is dry-run')
  const bytes = await readFile(path), plan = JSON.parse(bytes)
  const reasons = await inspect(plan)
  const steps = ['verify complete new and rollback hosts', 'hold external admission and settle CEO/children/jobs; flush', `stop only ${plan.program}`, 'apply pinned profile + isolated-host launcher switch', `start only ${plan.program}`, 'same-origin refresh, client fingerprint and retention check', 'write durable completion; on failure preserve data and restore executable runtime']
  if (flag !== '--execute') {
    console.log(JSON.stringify({ mode: 'dry-run', ready: reasons.length === 0, reasons, steps }, null, 2))
    process.exitCode = reasons.length ? 1 : 0
    return
  }
  if (reasons.length) throw Error(`preflight refused before stop: ${reasons.join('; ')}`)
  const cgroup = await readFile('/proc/self/cgroup', 'utf8')
  if (!cgroup.includes(`/a2d2-v4-141-${plan.runId}.service`)) throw Error('must run in its own system-managed one-shot unit, outside DSH service')
  const authorization = JSON.parse(await readFile(plan.authorization))
  if (authorization.planSha256 !== sha(bytes) || authorization.source !== 'direct-human-deployment-authorization' || !authorization.requestRef || !Number.isFinite(Date.parse(authorization.expiresAt)) || Date.parse(authorization.expiresAt) <= Date.now()) throw Error('missing direct deployment authorization bound to this exact plan')
  const root = plan.evidenceRoot
  if (!isAbsolute(root ?? '') || !root.startsWith('/tmp/a2d2-v4-') || await realpath(root) !== root || (await lstat(root)).mode & 0o077) throw Error('existing canonical private evidenceRoot required')
  const lock = await open(join(root, 'one-shot.lock'), 'wx', 0o600); await lock.close()
  const journal = await open(join(root, 'one-shot.jsonl'), 'ax', 0o600)
  const record = async (stage, detail = {}) => { await journal.write(JSON.stringify({ runId: plan.runId, at: new Date().toISOString(), stage, ...detail })+'\n'); await journal.sync() }
  const finish = async (status, detail = {}) => {
    const file = await open(join(root, 'completion.json'), 'wx', 0o600)
    await file.writeFile(JSON.stringify({ runId: plan.runId, status, origin: plan.origin, program: plan.program, ticketAcceptance: 'not implied', pluginCommit: plan.release.pluginCommit, hostCommit: plan.release.hostCommit, deployed: Object.fromEntries(plan.release.artifacts.filter(item => ['plugin-tgz', 'plugin-client', 'host-cli'].includes(item.role)).map(item => [item.role, item.sha256])), at: new Date().toISOString(), ...detail }, null, 2)+'\n'); await file.sync(); await file.close()
  }
  const action = async kind => {
    const descriptor = plan.actions[kind]
    if (sha(await readFile(descriptor.script)) !== descriptor.sha256) throw Error(`action changed: ${kind}`)
    const result = spawnSync(process.execPath, [descriptor.script, path], { encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
    const log = await open(join(root, `${kind}.private.log`), 'wx', 0o600)
    await log.writeFile(JSON.stringify({ status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr })); await log.sync(); await log.close()
    if (result.status !== 0) throw Error(`action failed: ${kind}; inspect private action log`)
  }
  let stopped = false
  try {
    const status = serviceStatus(plan.program)
    const pid = Number(status.match(/RUNNING\s+pid (\d+)/)?.[1])
    if (!pid) throw Error('target is not the observed running process')
    const proof = JSON.parse(await readFile(plan.settlement))
    validateSettlement(plan, proof, pid)
    for (const receipt of [...proof.children.map(row => row.resultReceipt), ...proof.jobs.map(row => row.receipt)]) {
      if (!receipt.path || !/^[a-f0-9]{64}$/.test(receipt.sha256 ?? '') || sha(await readFile(receipt.path)) !== receipt.sha256) throw Error('collection receipt file/hash missing')
    }
    await record('preflight-passed', { pid, planSha256: sha(bytes) })
    // No awaited work between the final held-gate check and the stop request.
    validateSettlement(plan, proof, pid)
    stopped = true
    command('supervisorctl', ['stop', plan.program])
    await record('stopped')
    await action('apply'); await record('applied')
    command('supervisorctl', ['start', plan.program]); await record('started')
    await action('verify'); await record('verified')
    await finish('deployment-verified')
  } catch (error) {
    await record('failed', { error: error.message })
    if (stopped) {
      try {
        // A partially failed start may leave a live process. Never restore its files while live.
        const status = serviceStatus(plan.program)
        if (!/\b(STOPPED|EXITED|FATAL)\b/.test(status)) command('supervisorctl', ['stop', plan.program])
        await action('rollback'); await record('rollback-applied')
        command('supervisorctl', ['start', plan.program])
        await action('rollbackVerify'); await record('rollback-verified')
        await finish('rolled-back', { failure: error.message })
      } catch (rollbackError) {
        await record('rollback-failed', { error: rollbackError.message })
        await finish('failed-needs-external-recovery', { failure: error.message, rollbackFailure: rollbackError.message })
      }
    } else await finish('refused-before-stop', { failure: error.message })
    process.exitCode = 1
  } finally { await journal.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(JSON.stringify({ status: 'refused-or-failed', error: error.message })); process.exitCode = 1 })
