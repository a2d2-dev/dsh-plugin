import {open,lstat,stat as fileStat,readdir,readFile,writeFile} from 'node:fs/promises'
import {constants} from 'node:fs'
import {createHash} from 'node:crypto'
import {join} from 'node:path'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)})
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino
async function prefixHash(handle,length){
  const result=createHash('sha256'),buffer=Buffer.alloc(65536)
  for(let offset=0;offset<length;){
    const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,length-offset),offset)
    if(!bytesRead)throw Error('CLI log prefix truncated')
    result.update(buffer.subarray(0,bytesRead));offset+=bytesRead
  }
  return result.digest('hex')
}
export async function beginShutdownLog(path,ownerPid){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW)
  try{
    const stat=await handle.stat(),named=await lstat(path),file=identity(stat)
    if(!stat.isFile()||!named.isFile()||!same(file,identity(named))||stat.nlink!==1)throw Error('CLI log identity is not a unique regular file')
    let ownerFd
    for(const fd of await readdir(`/proc/${ownerPid}/fd`)){
      try{
        const held=await lstat(`/proc/${ownerPid}/fd/${fd}`)
        if(!held.isSymbolicLink())continue
        const match=same(file,identity(await fileStat(`/proc/${ownerPid}/fd/${fd}`)))
        if(!match)continue
        const flags=parseInt((await readFile(`/proc/${ownerPid}/fdinfo/${fd}`,'utf8')).match(/^flags:\s+(\d+)$/m)?.[1]??'',8)
        if((flags&3)!==0&&(flags&constants.O_APPEND)!==0)ownerFd=Number(fd)
      }catch(error){if(!['ENOENT','ESRCH','ENXIO','EACCES','ELOOP'].includes(error.code))throw error}
    }
    if(ownerFd===undefined)throw Error('reviewed launcher does not hold the CLI append log')
    const offset=stat.size
    if(offset){const byte=Buffer.alloc(1);await handle.read(byte,0,1,offset-1);if(byte[0]!==10)throw Error('CLI log pre-signal boundary is incomplete')}
    const prefixSha256=await prefixHash(handle,offset)
    if((await handle.stat()).size!==offset)throw Error('CLI log changed while binding pre-signal offset')
    return {handle,path,file,offset,prefixSha256,ownerPid,ownerFd,boundAt:new Date().toISOString()}
  }catch(error){await handle.close();throw error}
}
export async function finishShutdownLog(bound,evidenceRoot){
  const {handle,path,file,offset}=bound
  let bytes=Buffer.alloc(0),attributable=true,reason='stable-file-and-prefix'
  try{
    const current=await handle.stat()
    if(current.size>=offset){
      bytes=Buffer.alloc(Math.min(current.size-offset,1024*1024))
      const {bytesRead}=await handle.read(bytes,0,bytes.length,offset)
      if(bytesRead!==bytes.length)throw Error('log-window-unstable')
    }
    const named=await lstat(path)
    if(!named.isFile()||!same(file,identity(named))||!same(file,identity(current))||current.nlink!==1)throw Error('log-identity-drift')
    if(current.size<offset)throw Error('log-truncated')
    if(current.size-offset>1024*1024)throw Error('log-window-over-budget')
    if(await prefixHash(handle,offset)!==bound.prefixSha256)throw Error('log-prefix-changed')
    if((await handle.stat()).size!==current.size)throw Error('log-window-unstable')
    if(bytes.length&&!bytes.toString().endsWith('\n'))throw Error('log-window-incomplete')
  }catch(error){attributable=false;reason=['log-identity-drift','log-truncated','log-window-over-budget','log-prefix-changed','log-window-unstable','log-window-incomplete'].includes(error.message)?error.message:'log-unavailable'}
  // Raw window is private; public evidence contains only classification and hashes.
  const rawPath=join(evidenceRoot,'old-cli-shutdown.private.log')
  await writeFile(rawPath,bytes,{flag:'wx',mode:0o600})
  const text=bytes.toString().replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')
  const explicitError=/(?:\[(?:E|F)\]|\b(?:error|fatal|exception|failed|failure|unhandled(?:Rejection|Exception)?)\b)/i.test(text)
  const knownForced=/\b(?:forceExit|force[- ]?exit|forced? (?:shutdown|termination)|shutdown (?:timed? ?out|timeout)|SIGKILL)\b/i.test(text)
  return {source:'reviewed-launcher-cli-private-log-window',classification:knownForced?'known-forced':explicitError?'error':attributable?'no-known-error':'unknown',attributable,reason,file,offset,bytes:bytes.length,windowSha256:hash(bytes),prefixSha256:bound.prefixSha256,rawPath,ownerPid:bound.ownerPid,ownerFd:bound.ownerFd,boundAt:bound.boundAt,gracefulOutcome:'not inferred'}
}
