import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const root = process.argv[2]
assert.match(root, /^\/tmp\/a2d2-v3-121\/122-admission-/)
const run = JSON.parse(await readFile(`${root}/current-run.json`, 'utf8'))
const login = await fetch((await readFile(`${root}/login-url.private`, 'utf8')).trim(), {redirect:'manual'})
assert.equal(login.status, 303)
const cookie = login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
async function request(kind, value) {
 const response = await fetch(`${run.baseURL}/a2d2/api/work`, {method:'POST', headers:{'content-type':'application/json', cookie, origin:run.baseURL}, body:JSON.stringify({kind,value})})
 return {http:response.status, body:await response.json(), request:{kind,value}}
}
const command = value => request('command', {commandId:randomUUID(), ...value})
const resourceResult = await request('query', {type:'resources.list'})
assert.equal(resourceResult.http,200)
const resource = resourceResult.body.resources.find(row=>row.title)?.ref
assert.ok(resource)
const projectResult = await command({type:'project.create', name:'admission-diagnostic', resource})
assert.equal(projectResult.http,200)
const project = projectResult.body.project
const taskResult = await command({type:'task.create',projectId:project.id,title:'Check real host admission', goal:'Deterministic admission',specification:'Preflight only; no fake Context',acceptance:['No execution on preflight rejection']})
assert.equal(taskResult.http,200)
const task = taskResult.body.task
const ref={projectId:project.id,taskId:task.id}
const start = await command({type:'task.start',ref,expectedVersion:task.version,agentId:project.defaultAgentId,resource,agentPreset:'standard',model:{provider:'a2d2-acceptance',model:'deterministic'},permissionPreset:'read-only'})
const execution = await request('query',{type:'task.execution',ref})
const evidence={product:'07297921961d01f0da7ac15336f33131b5188a6a', resourceResult,projectResult,taskResult,start,execution}
await writeFile(`${root}/evidence/public-red.json`,JSON.stringify(evidence,null,2),{flag:'wx',mode:0o600})
console.log(JSON.stringify({start,execution},null,2))
assert.equal(start.http,200,'Valid public start must pass host admission')
assert.ok(execution.body.execution,'Successful start must have execution')
