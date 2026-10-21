import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {once} from 'node:events'
import {maintenanceHoldSource} from './maintenance-hold.mjs'

function line(child,predicate){return new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('fixture startup timed out')),5000);child.stdout.on('data',chunk=>{text+=chunk;for(const value of text.split('\n').filter(Boolean)){try{const row=JSON.parse(value);if(predicate(row)){clearTimeout(timer);resolve(row);return}}catch{}}});child.once('error',reject)})}
test('旧Node不热读被替换脚本；单次launcher TERM后未来spawn只hold，hold退出也有真实状态',async t=>{
  const root=await mkdtemp(join(tmpdir(),'a2d2-v4-hold-')),entry=join(root,'launch.mjs'),cli=join(root,'probe.mjs'),count=join(root,'signal-count'),data=join(root,'user-data')
  await mkdir(data);await writeFile(join(data,'decision'),'preserved')
  await writeFile(cli,`import{writeFileSync}from'node:fs';let count=0;const timer=setInterval(()=>{},1000);console.log(JSON.stringify({probeReady:true}));process.on('SIGTERM',()=>{count++;writeFileSync(${JSON.stringify(count)},String(count));setTimeout(()=>{clearInterval(timer);process.exitCode=0},50)})`)
  await writeFile(entry,`import{spawn}from'node:child_process';const child=spawn(process.execPath,[${JSON.stringify(cli)}],{stdio:['ignore','pipe','pipe']});child.stdout.pipe(process.stdout);process.once('SIGTERM',()=>child.kill('SIGTERM'));child.once('exit',code=>{process.exitCode=code??1})`)
  const old=spawn(process.execPath,[entry],{stdio:['ignore','pipe','pipe']});let future
  t.after(()=>{for(const child of [old,future])if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM')})
  await line(old,row=>row.probeReady===true)
  await writeFile(entry,maintenanceHoldSource('fixture-only'))
  const oldExited=once(old,'exit');old.kill('SIGTERM');await oldExited
  assert.equal(await readFile(count,'utf8'),'1')
  future=spawn(process.execPath,[entry],{stdio:['ignore','pipe','pipe']})
  const held=await line(future,row=>row.source==='a2d2-maintenance-hold')
  assert.equal(held.runId,'fixture-only')
  assert.equal(held.cliStarted,false)
  assert.equal((await readFile(`/proc/${future.pid}/task/${future.pid}/children`,'utf8')).trim(),'')
  assert.equal(await readFile(join(data,'decision'),'utf8'),'preserved')
  const futureExited=once(future,'exit');future.kill('SIGTERM');await futureExited
  const stopped=JSON.parse(await readFile(join(root,'.v4-141-maintenance-hold.json')))
  assert.equal(stopped.holding,false)
  assert.equal(stopped.stopSignal,'SIGTERM')
  assert.equal(await readFile(count,'utf8'),'1')
})
