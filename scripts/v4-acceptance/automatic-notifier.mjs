import { readFile, writeFile, appendFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export const name='a2d2-v4-automatic-acceptance-notifier'
export const inject=['sessionController','sessions']
export function wasQueued(events,messageId){
  return events.some(event=>(event.type==='agent/inbox/spliced'&&event.data.inserted?.some(message=>message.id===messageId))||(event.type==='user/message'&&event.data.id===messageId))
}
export function apply(ctx,config){
  if(!config.enabled)return
  if(!config.targetSessionId||!config.parentInstructionRef||!config.runId)throw Error('explicit parent resume target/instruction required')
  let active,stopped=false,finished=false
  const response=join(config.evidenceRoot,'notification-response.json')
  async function deliver(){
    try{
      const prior=JSON.parse(await readFile(response))
      if(prior.runId!==config.runId||prior.targetSessionId!==config.targetSessionId)throw Error('notification response scope mismatch')
      finished=true;return
    }catch(error){if(error.code!=='ENOENT')throw error}
    let request
    try{request=JSON.parse(await readFile(join(config.evidenceRoot,'notification-request.json')))}catch(error){if(error.code==='ENOENT')return;throw error}
    if(request.source!=='automatic-acceptance'||request.runId!==config.runId||request.targetSessionId!==config.targetSessionId||request.parentInstructionRef!==config.parentInstructionRef)throw Error('automatic notification scope mismatch')
    const bytes=await readFile(join(config.evidenceRoot,'completion.json'))
    const sha256=createHash('sha256').update(bytes).digest('hex')
    const completion=JSON.parse(bytes)
    if(sha256!==request.receiptSha256||completion.runId!==config.runId||!['deployment-verified','rolled-back','failed-needs-external-recovery'].includes(completion.status))throw Error('completion evidence mismatch')
    const messageId=`a2d2-acceptance:${config.runId}`
    const before=await ctx.sessionController.inspect(config.targetSessionId)
    let queued=wasQueued(before.events,messageId)
    if(!queued){
      const resolved=await ctx.sessionController.resolveAgent(config.targetSessionId)
      if('error'in resolved)throw Error('original target Session cannot be resumed')
      // A real automatic source. Never source.kind=user, never an LF/person message.
      resolved.agent.followup({id:messageId,role:'user',content:[{type:'text',text:`自动验收通知（非LF消息）：运行 ${config.runId} 已产生 ${completion.status} 回执。请核验 ${config.evidenceRoot}/completion.json，并按父会话阶段指令接续；不表示#141整票通过。`}],source:{kind:'a2d2-acceptance-result',runId:config.runId,origin:completion.origin,receiptSha256:sha256,parentInstructionRef:config.parentInstructionRef}})
      if(await ctx.sessions.flush(resolved.agent.session)!==true)throw Error('notification queue durability listener missing')
      queued=wasQueued((await ctx.sessionController.inspect(config.targetSessionId)).events,messageId)
      if(!queued)throw Error('native notification queue record missing')
    }
    await writeFile(response,JSON.stringify({source:'automatic-acceptance',runId:config.runId,targetSessionId:config.targetSessionId,messageId,status:'queued-or-previously-recorded',receiptSha256:sha256,modelConsumption:'unknown',at:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600})
    finished=true
  }
  const timer=setInterval(()=>{
    if(stopped||finished||active)return
    active=deliver().catch(async error=>{await appendFile(join(config.evidenceRoot,'notification-errors.private.jsonl'),JSON.stringify({at:new Date().toISOString(),error:error.message})+'\n',{mode:0o600})}).finally(()=>{active=undefined})
  },500)
  ctx.effect(()=>async()=>{stopped=true;clearInterval(timer);await active},'automatic acceptance notification drain')
}
