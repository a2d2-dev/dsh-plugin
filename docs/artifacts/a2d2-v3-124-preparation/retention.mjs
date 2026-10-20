import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const lane = '/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/a2d2-v3-04-acceptance'
const root = '/data/_dsh-dev/previews/a2d2-v3-121'
const [mode, output, baselineFile] = process.argv.slice(2)
assert.ok(['capture', 'compare'].includes(mode), 'capture OUTPUT | compare OUTPUT BASELINE')
assert.ok(resolve(output ?? '').startsWith(`${lane}/docs/artifacts/a2d2-v3-124-`), 'Output must be in this lane issue 124 evidence')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const bytes = await readFile(`${root}/home/a2d2/work-v3/work-v3.json`)
const snapshot = JSON.parse(bytes)
const records = {}
for (const [kind, rows] of Object.entries(snapshot)) {
  if (!Array.isArray(rows)) continue
  records[kind] = rows.map(row => ({ id: String(row.id ?? row.commandId ?? JSON.stringify(row.address) ?? sha(JSON.stringify(row))), sha256: sha(JSON.stringify(row)) }))
}
async function files(directory, prefix = '') {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = join(prefix, entry.name), path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path, name))
    else {
      assert.ok(entry.isFile(), `Unexpected nonregular session path ${name}`)
      const data = await readFile(path)
      result.push({ file: name, bytes: data.length, sha256: sha(data) })
    }
  }
  return result.sort((a, b) => a.file.localeCompare(b.file))
}
const sessions = await files(`${root}/home/sessions`)
const metrics = (await readFile(`${root}/evidence/metrics.jsonl`, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
const modelCalls = Object.fromEntries(['gateway', 'adapter'].map(kind => [kind, metrics.filter(row => row.kind === kind).length]))
const profile = `${root}/home/profiles/web`
const manifest = JSON.parse(await readFile(`${profile}/package.json`, 'utf8'))
const packagePath = manifest.dependencies['dsh-a2d2'].replace(/^file:/, '')
assert.ok(packagePath.startsWith(`${root}/artifacts/`))
const configuration = []
for (const path of [`${profile}/package.json`, `${profile}/pnpm-lock.yaml`, `${root}/launch.mjs`, `${root}/preview.patch.yml`, `${root}/guard/guard.mjs`, packagePath, `${profile}/node_modules/dsh-a2d2/lib/client.js`]) {
  const data = await readFile(path)
  configuration.push({ path, bytes: data.length, sha256: sha(data) })
}
const result = { observedAt: new Date().toISOString(), root, snapshot: { bytes: bytes.length, sha256: sha(bytes), topLevelKeys: Object.keys(snapshot) }, records, sessions, modelCalls, configuration, run: JSON.parse(await readFile(`${root}/current-run.json`, 'utf8')) }
let failed = modelCalls.gateway !== 0 || modelCalls.adapter !== 0
if (mode === 'compare') {
  assert.ok(baselineFile, 'Baseline required')
  const baseline = JSON.parse(await readFile(baselineFile, 'utf8'))
  assert.equal(baseline.root, root)
  result.recordChanges = []
  for (const [kind, rows] of Object.entries(baseline.records)) for (const prior of rows) {
    const current = records[kind]?.find(row => row.id === prior.id)
    if (current?.sha256 !== prior.sha256) result.recordChanges.push({ kind, prior, current: current ?? null })
  }
  result.sessionComparison = []
  for (const prior of baseline.sessions) {
    const current = sessions.find(row => row.file === prior.file)
    const data = current ? await readFile(`${root}/home/sessions/${prior.file}`) : null
    result.sessionComparison.push({ file: prior.file, beforeBytes: prior.bytes, currentBytes: current?.bytes ?? null, beforeSha256: prior.sha256, currentSha256: current?.sha256 ?? null, wholeFileIdentical: current?.sha256 === prior.sha256, originalBytesPreserved: !!data && data.length >= prior.bytes && sha(data.subarray(0, prior.bytes)) === prior.sha256, appendedBytes: data && data.length >= prior.bytes ? data.length - prior.bytes : null })
  }
  result.addedSessionFiles = sessions.filter(row => !baseline.sessions.some(prior => prior.file === row.file))
  result.configurationChanges = configuration.flatMap(current => {
    const prior = baseline.configuration.find(row => row.path === current.path)
    return prior?.sha256 === current.sha256 ? [] : [{ prior: prior ?? null, current }]
  })
  result.fixedGuardAndPatchPreserved = [`${root}/preview.patch.yml`, `${root}/guard/guard.mjs`].every(path => configuration.find(row => row.path === path)?.sha256 === baseline.configuration.find(row => row.path === path)?.sha256)
  result.addedSnapshotKeys = Object.keys(snapshot).filter(key => !baseline.snapshot.topLevelKeys.includes(key))
  result.oldRecordHashesPreserved = result.recordChanges.length === 0
  result.originalSessionBytesPreserved = result.sessionComparison.every(row => row.originalBytesPreserved)
  result.sessionWholeFilesIdentical = result.sessionComparison.every(row => row.wholeFileIdentical)
  // Append-only preservation is evidence, not an automatic acceptance pass.
  result.sessionAppendDiagnosisRequired = !result.sessionWholeFilesIdentical
  failed ||= !result.oldRecordHashesPreserved || !result.originalSessionBytesPreserved || result.sessionAppendDiagnosisRequired || !result.fixedGuardAndPatchPreserved
}
result.checkPassed = !failed
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ output, mode, checkPassed: result.checkPassed, counts: Object.fromEntries(Object.entries(records).map(([key, rows]) => [key, rows.length])), sessionFiles: sessions.length, modelCalls }))
if (failed) process.exitCode = 1
