import {readFile,readlink,open,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
import {join} from 'node:path'
import {replaceReviewedFile} from './profile-actions.mjs'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function invoke(program,args){const value=spawnSync(program,args,{encoding:'utf8',timeout:30000});if(value.status!==0)throw Error('named Supervisor control failed; no group-signal retry permitted');return value.stdout}
function info(plan){return JSON.parse(invoke(plan.pythonBinary??'python3',[new URL('./supervisor-info.py',import.meta.url).pathname,plan.program]))}
async function processIdentity(pid){const text=await readFile(`/proc/${pid}/stat`,'utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(/\s+/);return{pid,startTicks:fields[19],parent:Number(fields[1]),group:Number(fields[2]),args:(await readFile(`/proc/${pid}/cmdline`)).toString().split('\0'),exe:await readlink(`/proc/${pid}/exe`)}}
async function gone(expected){try{return(await processIdentity(expected.pid)).startTicks!==expected.startTicks}catch(error){if(['ENOENT','ESRCH'].includes(error.code))return true;throw error}}
export async function stopPreviewWithHold(plan){
  const strategy=plan.initialStop,entry='/data/_dsh-dev/previews/a2d2-v3-121/launch.mjs'
  if(plan.program!=='dsh-a2d2-v3-preview'||strategy?.strategy!=='single-pid-term-with-hold'||strategy.hold.target!==entry)throw Error('exact original preview hold strategy required')
  for(const file of strategy.signalContractFiles)if(hash(await readFile(file.path))!==file.sha256)throw Error('installed Supervisor signal contract changed')
  const before=info(plan)
  if(before.pid!==strategy.launcher.pid||before.statename!=='RUNNING'||!before.stdoutUnique)throw Error('original preview generation/log provenance changed')
  const launcher=await processIdentity(before.pid),cli=await processIdentity(strategy.cli.pid)
  if(launcher.startTicks!==strategy.launcher.startTicks||cli.startTicks!==strategy.cli.startTicks||launcher.args[1]!==entry||launcher.group!==launcher.pid||launcher.pid===cli.pid||cli.parent!==launcher.pid)throw Error('old launcher/CLI identity mismatch')
  const log=await open(before.stdout_logfile,'r'),offset=(await log.stat()).size
  try{
    // Tested Node main-module lifetime: replacing the path does not hot-read it in old Node.
    await replaceReviewedFile(strategy.hold,[entry])
    const signaledAt=Date.now()
    const signalFact=JSON.parse(invoke(plan.pythonBinary??'python3',[new URL('./signal-one.py',import.meta.url).pathname,'--execute',plan.runId,String(launcher.pid),launcher.startTicks]))
    let holder,held
    const deadline=Date.now()+30000
    while(Date.now()<deadline){
      try{
        const receipt=JSON.parse(await readFile(strategy.receipt))
        const current=info(plan)
        if(receipt.source==='a2d2-maintenance-hold'&&receipt.runId===plan.runId&&receipt.holding===true&&receipt.entrySha256===strategy.hold.sha256&&receipt.pid===current.pid&&receipt.pid!==launcher.pid&&await gone(launcher)&&await gone(cli)){
          const identity=await processIdentity(receipt.pid)
          if(identity.args[1]!==entry||identity.group!==identity.pid||(await readFile(`/proc/${identity.pid}/task/${identity.pid}/children`,'utf8')).trim())throw Error('holder has an unexpected process/group/child')
          holder=current;held=receipt;break
        }
      }catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error}
      await delay(100)
    }
    if(!holder)throw Error('original processes did not converge to a proven no-CLI holder; never send a second group TERM')
    const size=(await log.stat()).size
    if(size<offset||size-offset>1024*1024)throw Error('old launcher exit log window is not attributable')
    const tail=Buffer.alloc(size-offset);await log.read(tail,0,tail.length,offset)
    const records=tail.toString().split('\n').flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}})
    const exits=records.filter(row=>row.stopped===true&&Object.hasOwn(row,'code')&&Object.hasOwn(row,'signal'))
    const observed=exits.length===1?exits[0]:{code:null,signal:null,unknown:true}
    const elapsed=Date.now()-signaledAt
    // Old CLI is proven gone. Administrative group stop now reaches ONLY the no-child holder.
    invoke('supervisorctl',['stop',plan.program])
    const after=info(plan)
    if(!['STOPPED','EXITED','FATAL'].includes(after.statename))throw Error('maintenance holder did not administratively stop')
    const exit={source:observed.unknown?'original-child-exit-unavailable':'original-launcher-child-exit',unknown:observed.unknown===true,code:observed.code,signal:observed.signal,forced:observed.signal!==null,stopElapsedMs:elapsed,launcherSignalSent:signalFact.sent===true,cliSignalReceipt:'not directly observed; original reviewed launcher forwards once',gracefulOutcome:'not inferred',originalLauncher:launcher.pid,originalCli:cli.pid,holderPid:held.pid,oldExitRecordSha256:hash(JSON.stringify(observed))}
    await writeFile(join(plan.evidenceRoot,'single-signal-hold.json'),JSON.stringify({strategy:strategy.strategy,before,holder,after,exit,oldProcessesGone:true,holderCliChildren:0},null,2)+'\n',{flag:'wx',mode:0o600})
    return {info:after,exit,heldPreview:true,commandStatus:0}
  }finally{await log.close()}
}
