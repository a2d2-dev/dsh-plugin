import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const root='/data/_dsh-dev/previews/a2d2-v3-121', out=join(root,'evidence/http-fix-132')
await mkdir(out,{recursive:true,mode:0o700})
const hash=data=>createHash('sha256').update(data).digest('hex')
const snapshot=JSON.parse(await readFile(join(root,'home/a2d2/work-v3/work-v3.json'),'utf8'))
const records=Object.fromEntries(['projects','agents','tasks','commands','legacyMappings'].map(kind=>[kind,snapshot[kind].map(row=>({id:row.id??row.commandId??JSON.stringify(row.address),sha256:hash(JSON.stringify(row))}))]))
async function files(directory,prefix='') { const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){const file=join(directory,entry.name),name=join(prefix,entry.name);if(entry.isDirectory())result.push(...await files(file,name));else if(entry.isFile())result.push({file:name,sha256:hash(await readFile(file))})}return result.sort((a,b)=>a.file.localeCompare(b.file)) }
const sessions=await files(join(root,'home/sessions'))
const metrics=(await readFile(join(root,'evidence/metrics.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
const modelCalls={gateway:metrics.filter(row=>row.kind==='gateway').length,adapter:metrics.filter(row=>row.kind==='adapter').length}
const result={time:new Date().toISOString(),records,sessions,modelCalls}
assert.deepEqual(modelCalls,{gateway:0,adapter:0})
if(process.argv[2]==='before') await writeFile(join(out,'before-retention.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'})
else {
  const before=JSON.parse(await readFile(join(out,'before-retention.json'),'utf8'))
  for(const kind of Object.keys(before.records))for(const record of before.records[kind])assert.deepEqual(records[kind].find(row=>row.id===record.id),record,`Changed existing ${kind}: ${record.id}`)
  const identical=JSON.stringify(sessions)===JSON.stringify(before.sessions)
  let appendDiagnosis
  if(!identical) {
    appendDiagnosis=JSON.parse(await readFile(join(out,'session-byte-diagnosis.json'),'utf8'))
    await writeFile(join(out,'retention-strict-failure.json'),JSON.stringify({strictSessionWholeFileHashEquality:false,before:before.sessions,after:sessions,diagnosis:'Original compressed bytes unchanged; native host appended session/end-seed when opening the existing session. No data restored or deleted.'},null,2)+'\n',{mode:0o600})
    assert.deepEqual(sessions.map(row=>row.file),before.sessions.map(row=>row.file))
    for(const session of sessions) {
      const prior=before.sessions.find(row=>row.file===session.file)
      if(session.sha256===prior.sha256)continue
      const proof=appendDiagnosis.results.find(row=>row.file===session.file)
      assert.equal(proof?.beforeSha256,prior.sha256);assert.equal(proof?.currentSha256,session.sha256)
      assert.equal(proof?.originalBytesIntact,true)
      const bytes=await readFile(join(root,'home/sessions',session.file))
      assert.equal(hash(bytes.subarray(0,proof.originalExactBytesPrefixLength)),prior.sha256)
      assert.deepEqual(proof?.appendedRecordShapes?.map(row=>row.type),['session/end-seed'])
    }
  }
  await writeFile(join(out,'final-retention.json'),JSON.stringify({...result,allExistingWorkRecordHashesPreserved:true,sessionWholeFileHashesIdentical:identical,allOriginalSessionBytesPreserved:true,...(appendDiagnosis?{sessionAppendDiagnosis:appendDiagnosis}: {})},null,2)+'\n',{mode:0o600})
}
console.log(JSON.stringify({phase:process.argv[2],counts:Object.fromEntries(Object.entries(records).map(([kind,rows])=>[kind,rows.length])),sessionFiles:sessions.length,modelCalls}))
