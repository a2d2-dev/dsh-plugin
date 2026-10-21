import { spawn } from 'node:child_process'
import { readFileSync, openSync, writeSync, fsyncSync, closeSync, writeFileSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import { pathToFileURL } from 'node:url'

// Candidate Supervisor launcher. Never started by preparation. Supervisor must use
// stopasgroup=false: this wrapper alone forwards the first TERM; killasgroup=true
// remains the explicit hard-stop fallback owned by Supervisor.
export function approvedServiceEnvironment(value){
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>key!=='DEEPSEEK_API_KEY')||Object.values(value).some(item=>typeof item!=='string'))throw Error('service environment must contain only the approved string key')
  return value
}
export async function runLauncher(configPath) {
  const config=JSON.parse(readFileSync(configPath,'utf8'))
  if(!['dsh-dev-web-server','dsh-a2d2-v3-preview'].includes(config.program))throw Error('exact existing program required')
  const preview=config.program==='dsh-a2d2-v3-preview'
  if(config.origin!==(preview?'http://10.126.126.12:18782':'http://127.0.0.1:18781'))throw Error('origin changed')
  const log=openSync(config.logPath,'a',0o600)
  const record=value=>{writeSync(log,JSON.stringify({at:new Date().toISOString(),program:config.program,...value})+'\n');fsyncSync(log)}
  const args=[config.cli,'web',...config.overlays.flatMap(path=>['--patch',path]),'--host','127.0.0.1','--port',preview?'0':'18781',...preview?['--trusted-host','10.126.126.12:18782']:[],'--no-open']
  const environment=Object.create(null)
  for(const key of config.environmentPolicy.inherit){
    if(process.env[key]===undefined)throw Error(`required inherited environment key missing: ${key}`)
    environment[key]=process.env[key]
  }
  Object.assign(environment,config.environmentPolicy.overrides)
  if(config.environmentPolicy.serviceEnvironment){
    const reference=config.environmentPolicy.serviceEnvironment
    if(reference.path!=='/data/_dsh-dev/service-env.json'||JSON.stringify(reference.keys)!==JSON.stringify(['DEEPSEEK_API_KEY']))throw Error('unapproved service environment reference')
    const value=approvedServiceEnvironment(JSON.parse(readFileSync(reference.path,'utf8')))
    Object.assign(environment,value)
  }
  const child=spawn(config.node,args,{cwd:config.cwd,env:environment,stdio:['ignore','pipe','pipe']})
  let pending='',announced=false,relay,termAt,signals=0
  const sockets=new Set()
  const ready=internalOrigin=>{
    const value={program:config.program,pid:child.pid,launcherPid:process.pid,origin:config.origin,baseURL:config.origin,cli:config.cli,internalOrigin,hostCommit:config.hostCommit,packageSha256:config.pluginSha256,deploymentRunId:config.deploymentRunId,startedAt:new Date().toISOString()}
    writeFileSync(config.currentRunPath,JSON.stringify(value,null,2)+'\n',{mode:0o600})
    if(preview){
      if(config.legacyCurrentRunPath!=='/data/_dsh-dev/previews/a2d2-v3-121/current-run.json')throw Error('preview provenance path changed')
      writeFileSync(config.legacyCurrentRunPath,JSON.stringify(value,null,2)+'\n',{mode:0o600})
    }
    record({stage:'ready',...value})
    console.log(JSON.stringify({ready:true,...value}))
  }
  const capture=data=>{
    // Raw CLI output can include login credentials; stays only in the private log.
    writeSync(log,data)
    pending=(pending+data.toString()).slice(-64000)
    const match=pending.match(/dsh web:\s+(https?:\/\/\S+)/)
    if(announced||!match)return
    const internal=new URL(match[1]);announced=true
    if(!preview){if(internal.origin!==config.origin)throw Error('CLI origin changed');ready(internal.origin);return}
    relay=createServer(socket=>{
      sockets.add(socket);const upstream=connect({host:'127.0.0.1',port:Number(internal.port)})
      socket.pipe(upstream);upstream.pipe(socket)
      socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy())
      socket.on('close',()=>{sockets.delete(socket);upstream.destroy()});upstream.on('close',()=>socket.destroy())
    })
    relay.once('error',error=>{record({stage:'relay-error',code:error.code});child.kill('SIGTERM');process.exitCode=1})
    relay.listen({host:'10.126.126.12',port:18782,exclusive:true},()=>ready(internal.origin))
  }
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{try{capture(data)}catch(error){record({stage:'capture-failed',message:error.message});child.kill('SIGTERM');process.exitCode=1}})
  const stop=signal=>{
    signals++
    if(signals!==1){record({stage:'repeat-signal',signal,signals});return} // never force the CLI by forwarding twice
    termAt=Date.now();relay?.close();for(const socket of sockets)socket.destroy()
    record({stage:'stop-requested',signal,childPid:child.pid});child.kill('SIGTERM')
  }
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>stop(signal))
  child.on('error',error=>{record({stage:'spawn-error',code:error.code});process.exitCode=1})
  child.on('exit',(code,signal)=>{
    relay?.close();for(const socket of sockets)socket.destroy()
    const receipt={source:'managed-child-exit',program:config.program,origin:config.origin,childPid:child.pid,code,signal,forwardedSignals:termAt===undefined?0:1,wrapperSignals:signals,stopElapsedMs:termAt===undefined?null:Date.now()-termAt,gracefulOutcome:'not inferred from exit code',at:new Date().toISOString()}
    writeFileSync(config.exitReceiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600})
    record({stage:'child-exit',...receipt});closeSync(log);process.exitCode=code??1
  })
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runLauncher(process.argv[2]??new URL('./.v4-141-runtime.private.json',import.meta.url)).catch(error=>{console.error(error.message);process.exitCode=1})
}
