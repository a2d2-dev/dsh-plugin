import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const root = '/data/_dsh-dev/previews/a2d2-v3-121'
const out = new URL('./', import.meta.url)
const read = async name => JSON.parse(await readFile(new URL(name, out), 'utf8'))
const baseline = await read('before-retention.json'), final = await read('final-retention.json')
const snapshot = JSON.parse(await readFile(`${root}/home/a2d2/work-v3/work-v3.json`, 'utf8'))
const reference = (await read('issue112-current-body-verification.json')).issue
const imported = snapshot.tasks.filter(t => !baseline.records.tasks.some(prior => prior.id === t.id))
assert.equal(imported.length, 1)
const task = imported[0], ref = { projectId: task.projectId, taskId: task.id }
const binding = snapshot.externalBindings.find(row => row.nodeId === reference.nodeId)
assert.deepEqual(binding.ref, ref)
assert.deepEqual(snapshot.externalIndex[`github:node:${reference.nodeId}`], ref)
assert.deepEqual(snapshot.externalIndex[`github:url:${reference.url}`], ref)
assert.equal(task.specification.text, reference.body)
assert.equal(binding.accepted.body, reference.body)
assert.equal(binding.lastObserved.body, reference.body)
const importReceipt = snapshot.commands.find(row => row.commandId === task.activity.find(a => a.type === 'source.import').commandId)
assert.deepEqual(importReceipt.result.ref, ref)
assert.equal(task.sessions.length, 1)
assert.equal(task.sessions[0].session.sessionId, 'session-f9282a68-4c3f-4251-adcb-bcd6f24d7515')
const source = snapshot.sources.find(s => s.id === binding.sourceIds[0])
assert.equal(source.enabled, true)
assert.equal(source.identity.login, 'imneov')
assert.equal(source.lastError, undefined)
assert.equal(snapshot.sources.length, 1)
assert.equal(final.oldRecordHashesPreserved, true)
assert.equal(final.sessionWholeFilesIdentical, true)
assert.equal(final.originalSessionBytesPreserved, true)
assert.equal(final.addedSessionFiles.length, 0)
assert.deepEqual(final.modelCalls, { gateway: 0, adapter: 0 })
const run = JSON.parse(await readFile(`${root}/current-run.json`, 'utf8'))
const metrics = (await readFile(`${root}/evidence/metrics.jsonl`, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
const currentBirths = metrics.filter(row => row.pid === run.pid && row.kind === 'session-born')
const baselineSessionIds = [...new Set(baseline.sessions.flatMap(row => row.file.split('/').filter(part => part.startsWith('session-'))))]
const currentRunNewSessionIds = [...new Set(currentBirths.map(row => row.sessionId))].filter(id => !baselineSessionIds.includes(id))
assert.deepEqual(currentRunNewSessionIds, [])
const browser = spawnSync('agent-browser', ['--session', 'a2d2-http132', 'eval', '--stdin'], { encoding: 'utf8', input: '({origin:location.origin,isSecureContext,randomUUIDType:typeof crypto.randomUUID,getRandomValuesType:typeof crypto.getRandomValues,body:[...document.querySelectorAll("main h3")].find(e=>e.textContent==="完整原文")?.nextElementSibling?.textContent,alerts:[...document.querySelectorAll("main [role=alert]")].map(e=>e.textContent),sourceControls:[...document.querySelectorAll("main button")].filter(b=>["停用来源","刷新 Issue 详情","打开已关联工作","接入为本地工作"].includes(b.textContent)).map(b=>({text:b.textContent,disabled:b.disabled}))})' })
assert.equal(browser.status, 0)
const visible = JSON.parse(browser.stdout)
assert.equal(visible.body, reference.body)
assert.deepEqual(visible.alerts, [])
assert.equal(visible.isSecureContext, false)
assert.equal(visible.randomUUIDType, 'undefined')
assert.equal(visible.getRandomValuesType, 'function')
assert.ok(visible.sourceControls.some(b => b.text === '停用来源' && !b.disabled))
assert.ok(visible.sourceControls.some(b => b.text === '刷新 Issue 详情' && !b.disabled))
assert.ok(visible.sourceControls.some(b => b.text === '打开已关联工作' && !b.disabled))
assert.ok(!visible.sourceControls.some(b => b.text === '接入为本地工作'))
const bodySha = createHash('sha256').update(visible.body).digest('hex')
delete visible.body
const newReceipts = snapshot.commands.filter(row => !baseline.records.commands.some(prior => prior.id === row.commandId)).map(row => ({ commandId: row.commandId, resultKeys: Object.keys(row.result), status: row.result.status, canonicalRef: row.result.ref ?? null, sourceEnabled: row.result.source?.enabled ?? null }))
assert.equal(newReceipts.length, 5)
assert.ok(newReceipts.every(row => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.commandId)))
const result = {
  observedAt: new Date().toISOString(), sourceCommit: '876758c8566e50c0db0df53e27ada46b8041c223', run,
  canonicalRef: ref, importReceiptCommandId: importReceipt.commandId,
  body: { bytes: Buffer.byteLength(reference.body), sha256: bodySha, sourcePageAndAcceptedSnapshotAndLocalSpecificationEqual: true },
  task: { id: task.id, version: task.version, title: task.title, specificationVersion: task.specification.version, missingStructuredFields: task.specification.missing, sessions: task.sessions, activity: task.activity },
  source: { id: source.id, repository: source.repository, enabled: source.enabled, version: source.version, identity: source.identity, lastError: source.lastError ?? null, cachedPages: Object.keys(source.pages).length, observationCount: Object.keys(source.observations).length },
  counts: Object.fromEntries(['projects', 'agents', 'tasks', 'sources', 'externalBindings', 'commands'].map(kind => [kind, snapshot[kind].length])),
  newReceipts, externalIndex: snapshot.externalIndex,
  retention: { oldRecordHashesPreserved: final.oldRecordHashesPreserved, originalSessionBytesPreserved: final.originalSessionBytesPreserved, sessionWholeFilesIdentical: final.sessionWholeFilesIdentical, addedSessionFiles: final.addedSessionFiles, sessionIdsUnchanged: true, baselineSessionIds, currentRunSessionCreatedEvents: currentBirths, currentRunNewSessionIds, historicalBornSessionIds: metrics.filter(row => row.kind === 'session-born').map(row => row.sessionId), modelCalls: final.modelCalls, fixedGuardAndPatchPreserved: final.fixedGuardAndPatchPreserved },
  visibleFinalState: visible,
  scope: { githubBusinessWrites: false, hiddenImportOrLinkApiWrites: false, projectViews125Verified: false, taskStart122Verified: false, repeatedImportBackendIdempotenceLiveRetested: false, repeatedAccessUiPreventsSecondImport: true },
}
await writeFile(new URL('final-verdict.json', out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(result, null, 2))
