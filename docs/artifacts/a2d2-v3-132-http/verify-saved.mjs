import assert from 'node:assert/strict'
import {writeFile,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {connect,root} from '/data/_dsh-dev/previews/a2d2-v3-121/http.mjs'
const api=await connect(), projects=(await api.query({type:'projects.list'})).projects
const project=projects.find(p=>p.name==='验收_HTTP132_20261020_独立项目')
assert.ok(project);assert.deepEqual(project.resources,[])
const detail=await api.query({type:'project.detail',projectId:project.id}), task=detail.tasks.find(t=>t.title==='验收_HTTP132_20261020_工作')
assert.ok(task);assert.equal(task.version,3);assert.equal(task.specification.version,2)
assert.equal(task.specification.text,'修订规格：普通HTTP原生getRandomValues生成UUID；保留历史规格并支持工作拆解。')
assert.equal(task.specificationHistory[0].text,'初版规格：原HTTP地址使用真实UI创建工作。')
assert.equal(task.breakdown.length,1);assert.equal(task.breakdown[0].title,'验收_HTTP132_工作块')
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
assert.match(task.breakdown[0].id,uuid)
for(const activity of task.activity)assert.match(activity.commandId,uuid)
const resources=(await api.query({type:'resources.list'})).resources
assert.ok(resources.some(r=>r.owner?.projectName==='演示项目 · 本地工作'))
assert.equal(projects.some(p=>p.name==='abcd'),false)
const before=JSON.parse(await readFile(`${root}/evidence/http-fix-132/before-retention.json`,'utf8'))
const output={origin:'http://10.126.126.12:18782',verificationInterface:'Read-only public Work API after actual agent-browser UI writes',project:{id:project.id,name:project.name,resources:project.resources},task:{id:task.id,projectId:task.projectId,title:task.title,version:task.version,specificationVersion:task.specification.version,historyVersions:task.specificationHistory.map(s=>s.version),breakdown:task.breakdown,activity:task.activity},resources,unsavedAbcdAbsent:true,preexistingProjectIds:before.records.projects.map(r=>r.id),preexistingTaskIds:before.records.tasks.map(r=>r.id),apiWritesPerformedByThisScript:0}
await writeFile(`${root}/evidence/http-fix-132/read-only-verdict.json`,JSON.stringify(output,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({projectId:project.id,taskId:task.id,taskVersion:task.version,specificationVersion:task.specification.version,blockId:task.breakdown[0].id,commandIds:task.activity.map(a=>a.commandId),readOnlyAssertionsPassed:true}))
