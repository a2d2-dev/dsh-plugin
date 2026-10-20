import { prepare as prepare121, run, request } from '../a2d2-v3-121/acceptance.mjs'
import { readFile, writeFile, realpath, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import assert from 'node:assert/strict'
import { PROVIDER, MODEL } from './model.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const save = (path, data, flag = 'wx') => writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag, mode: 0o600 })
const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex')
export function rootName(root) {
  if (typeof root !== 'string' || !/^\/tmp\/a2d2-v3-121\/122-[a-zA-Z0-9-]+$/.test(root) || resolve(root) !== root) throw new Error('Use a fresh canonical /tmp/a2d2-v3-121/122-<run> root')
  return root
}
async function owned(root) {
  rootName(root)
  assert.equal(await realpath(root), root, 'Owned root must not be a symlink')
  assert.ok((await lstat(root)).isDirectory())
  const manifest = await json(join(root, 'manifest.json'))
  assert.equal(manifest.root, root)
  return manifest
}
async function packageFingerprint(entry) {
  let parent = dirname(entry)
  while (parent !== dirname(parent)) {
    try {
      const path = join(parent, 'package.json')
      const pkg = await json(path)
      if (pkg.name) return { entry, sha256: await sha(entry), package: { name: pkg.name, version: pkg.version, path, sha256: await sha(path) } }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    parent = dirname(parent)
  }
  throw new Error(`Missing package identity for ${entry}`)
}
export async function prepare(options) {
  rootName(options.root)
  // 121 validates canonical ancestors before mkdir and owns all CLI/process safety.
  await prepare121(options)
  const manifest = await owned(options.root)
  const root = options.root
  const source = { manifestSHA: await sha(join(root, 'manifest.json')), patchSHA: await sha(join(root, 'acceptance.patch.yml')), guardSHA: await sha(join(root, 'guard/guard.mjs')), lifecycleSHA: await sha(join(directory, '../a2d2-v3-121/acceptance.mjs')) }
  await save(join(root, 'evidence/prepare-121-source.json'), source)
  const patch = await json(join(root, 'acceptance.patch.yml'))
  const insertion = patch.find(row => row.insert)
  assert.equal(insertion.insert[0].id, 'a2d2-v3-121-guard')
  insertion.insert[0].id = 'a2d2-v3-122-guard'
  for (const filename of ['guard.mjs', 'model.mjs']) await writeFile(join(root, 'guard', filename), await readFile(join(directory, filename)), { mode: 0o600, flag: filename === 'guard.mjs' ? 'w' : 'wx' })
  // The inherited default is deliberately unavailable. Only per-Session selection
  // may route a prompt to the deterministic model; never save a global default.
  await save(join(root, 'acceptance.patch.yml'), patch, 'w')
  const require = createRequire(manifest.anchor)
  const entries = { cli: manifest.cli, llm: manifest.llm, ...manifest.modules, agent: require.resolve('@deepseek-ai/dsh-agent') }
  const packages = {}
  for (const [name, entry] of Object.entries(entries)) packages[name] = await packageFingerprint(entry)
  const assembly = { scope: '#122 host tools, final product pending', root, plugin: manifest.plugin, source, provider: PROVIDER, model: MODEL, packages, manifestSHA: await sha(join(root, 'manifest.json')), patchSHA: await sha(join(root, 'acceptance.patch.yml')), guardSHA: await sha(join(root, 'guard/guard.mjs')), modelSHA: await sha(join(root, 'guard/model.mjs')), wrapperSHA: await sha(fileURLToPath(import.meta.url)) }
  await save(join(root, 'assembly.json'), assembly)
  return assembly
}
async function verify(root) {
  await owned(root)
  const assembly = await json(join(root, 'assembly.json'))
  assert.equal(assembly.root, root)
  for (const [file, key] of [['manifest.json', 'manifestSHA'], ['acceptance.patch.yml', 'patchSHA'], ['guard/guard.mjs', 'guardSHA'], ['guard/model.mjs', 'modelSHA']]) assert.equal(await sha(join(root, file)), assembly[key], `${file} changed after preparation`)
  assert.equal(await sha(join(directory, '../a2d2-v3-121/acceptance.mjs')), assembly.source.lifecycleSHA)
  for (const pkg of Object.values(assembly.packages)) {
    assert.equal(await sha(pkg.entry), pkg.sha256, 'Installed host artifact changed')
    assert.equal(await sha(pkg.package.path), pkg.package.sha256, 'Installed package identity changed')
  }
  return assembly
}
async function main() {
  const { positionals: [action], values } = parseArgs({ allowPositionals: true, options: { root: { type: 'string' }, host: { type: 'string' }, plugin: { type: 'string' }, 'host-only': { type: 'boolean' }, phase: { type: 'string' }, job: { type: 'string' } } })
  const root = rootName(values.root)
  if (action === 'prepare') return console.log(JSON.stringify(await prepare({ root, host: values.host, plugin: values.plugin, hostOnly: values['host-only'] }), null, 2))
  await verify(root)
  if (action === 'run') return run(root)
  if (action === 'job') {
    assert.ok(values.job, '--job required')
    const current = await json(join(root, 'current-run.json'))
    current.managedJobId = values.job
    await save(join(root, 'current-run.json'), current, 'w')
    await save(join(root, 'evidence', `${current.runId}-run.json`), current, 'w')
    return console.log(JSON.stringify(current))
  }
  if (['positive', 'fixture', 'snapshot'].includes(action)) {
    const result = await request(root, action)
    await save(join(root, 'evidence', `${Date.now()}-${action}.json`), result)
    return console.log(JSON.stringify(result, null, 2))
  }
  if (action === 'mark' || action === 'check') {
    assert.match(values.phase ?? '', /^[a-z0-9-]+$/, '--phase must be a stable lowercase phase name')
    const path = join(root, 'evidence', `phase-${values.phase}.json`)
    const current = await request(root, 'snapshot')
    if (action === 'mark') await save(path, current)
    else {
      const before = await json(path)
      assert.equal(current.gateway, before.gateway, 'Unexpected public LLM call in no-call phase')
      assert.equal(current.adapter, before.adapter, 'Unexpected adapter call in no-call phase')
      assert.deepEqual(current.sessions.map(row => row.sessionId), before.sessions.map(row => row.sessionId), 'Session identity set changed')
      assert.deepEqual(current.defaultModel, before.defaultModel, 'Global default changed')
      // Live/cold state is observational, never replaced with invented effective config.
      const durable = value => value.sessions.map(({ sessionId, meta, eventTypes, projections }) => ({ sessionId, meta, eventTypes, projections }))
      assert.deepEqual(durable(current), durable(before), 'Read-only phase changed durable Session state')
      await save(join(root, 'evidence', `${Date.now()}-check-${values.phase}.json`), { passed: true, phase: values.phase, delta: { gateway: 0, adapter: 0 }, before, current })
    }
    return console.log(JSON.stringify({ passed: true, phase: values.phase, action, gateway: current.gateway, adapter: current.adapter }))
  }
  throw new Error('Usage: prepare|run|job|fixture|positive|snapshot|mark|check --root /tmp/a2d2-v3-121/122-<run> [--host <checkout> --host-only|--plugin <tgz>] [--phase <name>]')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.stack); process.exitCode = 1 })
