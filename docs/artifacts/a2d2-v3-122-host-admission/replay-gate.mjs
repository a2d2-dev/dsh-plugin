import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const json=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'))
for(const name of ['old-public-red.json','b14-public-red.json']){
 const red=await json(name)
 assert.equal(red.start.http,400)
 assert.equal(red.start.body.error.code,'host-admission-failed')
 assert.equal(red.execution.http,200)
 assert.equal(red.execution.body.execution,undefined)
}
for(const name of ['old-check-exception.jsonl','b14-check-exception.jsonl']){
 const rows=(await readFile(new URL(name,import.meta.url),'utf8')).trim().split('\n').map(JSON.parse)
 assert.equal(rows.find(row=>row.kind==='check-threw').error.message,'cannot get property "workspaceRegistry" without inject')
}
const green=await json('fixed-public-gate.json')
assert.equal(green.passed,true)
assert.equal(green.public.refused.http,400)
assert.equal(green.public.refused.body.error.code,'unavailable-model')
assert.equal(green.public.afterRefusal.body.execution,undefined)
assert.equal(green.refusalSnapshotUnchanged,true)
assert.equal(green.public.start.http,200)
const execution=green.public.start.body.execution
assert.equal(execution.state,'ready')
assert.equal(execution.actual.sandbox,'read-only')
assert.equal(execution.actual.permissionPreset,'read-only')
assert.equal(green.retry.body.execution.id,execution.id)
assert.deepEqual(green.retry.body.execution.session,execution.session)
assert.deepEqual(green.after.defaultModel,green.before.defaultModel)
assert.deepEqual([green.before.gateway,green.before.adapter,green.after.gateway,green.after.adapter],[0,0,1,1])
const events=green.persistedPublicSessionPage.events
assert.ok(events.some(row=>row.type==='assistant/message'&&JSON.stringify(row).includes('A2D2_122_DETERMINISTIC_HOST_REPLY')))
assert.equal(events.findLast(row=>row.type==='turn/end').data.reason.kind,'completed')
assert.equal(green.metrics.filter(row=>row.kind==='admitted').length,1)
assert.equal(green.metrics.filter(row=>row.kind==='rejected').length,0)
const cleanup=await json('cleanup.json')
assert.equal(cleanup.passed,true)
assert.equal(cleanup.roots.length,4)
for(const row of cleanup.roots){assert.ok(row.processesStopped&&row.portClosed);assert.equal(row.exit.code,0)}
console.log(JSON.stringify({passed:true,scope:'offline evidence assertions only; no new host or browser run',browserGate:'pending',executionId:execution.id}))
