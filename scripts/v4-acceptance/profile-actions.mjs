import { readFile, readdir, readlink, lstat, realpath, cp, rename, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { canonical } from './retention.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export const targets = {
  'dsh-dev-web-server': { profile: '/data/_dsh-dev/profiles/web', origin: 'http://127.0.0.1:18781', files: ['/etc/supervisor/conf.d/dsh-dev-web-server.conf'] },
  'dsh-a2d2-v3-preview': { profile: '/data/_dsh-dev/previews/a2d2-v3-121/home/profiles/web', origin: 'http://10.126.126.12:18782', files: ['/etc/supervisor/conf.d/dsh-a2d2-v3-preview.conf', '/data/_dsh-dev/previews/a2d2-v3-121/launch.mjs', '/data/_dsh-dev/previews/a2d2-v3-121/.v4-141-runtime.private.json'] },
}
async function absent(path) {
  try { await lstat(path); throw Error(`path already exists: ${path}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
}
export async function fingerprintTree(root) {
  if (resolve(root) !== root || await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw Error('canonical directory required')
  const rows = []
  async function walk(directory, relative = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name), name = join(relative, entry.name)
      if (['.v4-141-current-run.json','.v4-141-exit.json','.v4-141-web.private.log'].includes(name)) continue // runtime PID observation, not profile configuration
      if (entry.isSymbolicLink()) rows.push({ path: name, link: await readlink(path) })
      else if (entry.isDirectory()) await walk(path, name)
      else if (entry.isFile()) rows.push({ path: name, sha256: hash(await readFile(path)) })
      else throw Error('unsupported profile entry')
    }
  }
  await walk(root)
  return hash(canonical(rows))
}
export async function replaceProfile({ target, staged, backup, expected }) {
  for (const path of [target, staged]) if (await realpath(path) !== path) throw Error('canonical profile paths required')
  if (dirname(backup) !== dirname(target) || resolve(backup) !== backup || backup === target || staged === target || staged.startsWith(target + '/')) throw Error('invalid verified replacement paths')
  const next = `${backup}.next`
  await absent(backup); await absent(next)
  if (await fingerprintTree(target) !== expected) throw Error('original profile changed before replacement')
  const stagedHash = await fingerprintTree(staged)
  await cp(staged, next, { recursive: true, dereference: false, preserveTimestamps: true, errorOnExist: true, force: false })
  if (await fingerprintTree(next) !== stagedHash || await fingerprintTree(target) !== expected) throw Error('profile changed during staging')
  // Both destinations are checked, canonical siblings on the same filesystem; never delete data.
  await rename(target, backup)
  try { await rename(next, target) } catch (error) { await absent(target); await rename(backup, target); throw error }
  return { target, backup, sha256: stagedHash }
}
function run(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 16*1024*1024 })
  if (result.status !== 0) throw Error(`${program} failed; inspect private action output`)
  return result.stdout
}
export async function replaceReviewedFile(file, allowed) {
  if (!allowed.includes(file.target) || await realpath(dirname(file.target)) !== dirname(file.target)) throw Error('file target outside exact program allowlist')
  let current = null
  try { current = hash(await readFile(file.target)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!file.allowedCurrentSha256.includes(current)) throw Error('launcher/conf changed outside reviewed plan')
  const bytes = await readFile(file.candidate)
  if (hash(bytes) !== file.sha256) throw Error('candidate file changed')
  const next = `${file.target}.v4-141-next`
  const handle = await open(next, 'wx', 0o600)
  await handle.writeFile(bytes); await handle.sync(); await handle.close()
  // Exact allowlisted target and sibling temporary path checked above.
  await rename(next, file.target)
}
export async function runAction(planPath, kind) {
  const bytes = await readFile(planPath), plan = JSON.parse(bytes)
  if (process.env.A2D2_V4_DEPLOY_PLAN_SHA256 !== hash(bytes)) throw Error('action requires parent-authorized external one-shot context')
  const target = targets[plan.program]
  if (!target || plan.origin !== target.origin || !/^[a-z0-9-]+$/.test(plan.runId)) throw Error('only exact existing targets allowed')
  if (kind === 'verify' || kind === 'rollbackVerify') {
    const { verifyLive } = await import('./verify-live.mjs')
    return verifyLive(plan, kind === 'rollbackVerify' ? 'rollback' : 'new')
  }
  if (!['apply', 'rollback'].includes(kind)) throw Error('unknown reviewed action')
  const status = spawnSync('supervisorctl', ['status', plan.program], { encoding: 'utf8' })
  if (![0,3].includes(status.status) || !status.stdout.trim().startsWith(plan.program+' ') || !/\b(STOPPED|EXITED|FATAL)\b/.test(status.stdout)) throw Error('exact target must be fully stopped before profile replacement')
  const side = kind === 'apply' ? 'new' : 'rollback', selected = plan.profiles[side]
  if (await fingerprintTree(selected.path) !== selected.sha256) throw Error('prepared profile artifact changed')
  const current = await fingerprintTree(target.profile)
  const expected = kind === 'apply' ? plan.originalProfileSha256 : undefined
  if (kind === 'apply' && current !== expected) throw Error('original profile changed')
  const unexpectedProfileChanges=kind==='rollback'&&![plan.originalProfileSha256,plan.profiles.new.sha256].includes(current)
  // A changed failed profile is a rollback reason, not permission to discard it.
  // replaceProfile preserves that exact tree as the canonical sibling backup.
  const backup = `${target.profile}.v4-${plan.runId}-${side}-previous`
  const replacement = await replaceProfile({ target: target.profile, staged: selected.path, backup, expected: current })
  run(process.execPath, [new URL('./profile-imports.mjs', import.meta.url).pathname, selected.hostRoot, target.profile, join(plan.evidenceRoot, `${side}-installed-imports.json`), ...(selected.overlays ?? [])])
  for (const file of plan.files[side]) await replaceReviewedFile(file, target.files)
  if (plan.files[side].some(file=>file.target.startsWith('/etc/supervisor/conf.d/'))) {
    // reread changes no process state; update is restricted to this one exact program.
    run('supervisorctl', ['reread'])
    run('supervisorctl', ['update', plan.program]) // Supervisor may autostart this named program.
  }
  return { action: kind, unexpectedProfileChanges, ...replacement }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAction(...process.argv.slice(2)).then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error.message); process.exitCode=1 })
}
