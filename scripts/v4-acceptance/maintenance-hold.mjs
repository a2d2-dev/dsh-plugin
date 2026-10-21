export function maintenanceHoldSource(runId){
  if(!/^[a-z0-9-]+$/.test(runId))throw Error('stable hold runId required')
  return `import {readFileSync,openSync,writeSync,fsyncSync,closeSync,renameSync} from 'node:fs'
import {createHash} from 'node:crypto'
const runId=${JSON.stringify(runId)}
const receipt=new URL('./.v4-141-maintenance-hold.json',import.meta.url)
const temporary=new URL('./.v4-141-maintenance-hold.'+runId+'-'+process.pid+'.pending',import.meta.url)
const value={source:'a2d2-maintenance-hold',runId,pid:process.pid,entrySha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),holding:true,cliStarted:false,startedAt:new Date().toISOString()}
const publish=data=>{const fd=openSync(temporary,'wx',0o600);writeSync(fd,JSON.stringify(data)+'\\n');fsyncSync(fd);closeSync(fd);renameSync(temporary,receipt)}
publish(value)
console.log(JSON.stringify(value))
const timer=setInterval(()=>{},1000)
const stop=signal=>{clearInterval(timer);publish({...value,holding:false,stopSignal:signal,stoppedAt:new Date().toISOString()});process.exitCode=0}
process.once('SIGTERM',()=>stop('SIGTERM'))
process.once('SIGINT',()=>stop('SIGINT'))
`
}
