import { readFile, writeFile, mkdir, cp, readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { targets, fingerprintTree } from './profile-actions.mjs'
import { importProfile } from './profile-imports.mjs'
import { maintenanceHoldSource } from './maintenance-hold.mjs'
import { verifyRelease } from './fingerprint.mjs'

const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600})
const tools=fileURLToPath(new URL('.',import.meta.url))
async function optionalHash(path){try{return sha(await readFile(path))}catch(error){if(error.code==='ENOENT')return null;throw error}}
function setConf(text,key,value){const expression=new RegExp(`^${key}=.*$`,'m');return expression.test(text)?text.replace(expression,`${key}=${value}`):text.trimEnd()+`\n${key}=${value}\n`}
export function environmentPolicyFor(actual,predictedHashes,preview){
  const safeOverrides=new Set(['PATH','HOME','DSH_HOME','DSH_WEB_PASSWORD_FILE','XDG_CONFIG_HOME','XDG_STATE_HOME','XDG_CACHE_HOME','GH_CONFIG_DIR','DSH_TELEMETRY_DISABLED','TMPDIR','NODE_OPTIONS'])
  const policy={inherit:[],overrides:{},expectedInheritedHashes:{}}
  if(!preview)policy.serviceEnvironment={path:'/data/_dsh-dev/service-env.json',keys:['DEEPSEEK_API_KEY']}
  for(const [key,value]of Object.entries(actual)){
    if(!preview&&key==='DEEPSEEK_API_KEY')continue
    const expected=sha(value)
    if(predictedHashes[key]===expected){policy.inherit.push(key);policy.expectedInheritedHashes[key]=expected}
    else if(safeOverrides.has(key))policy.overrides[key]=value
    else throw Error(`actual environment key has no approved stable reference: ${key}`)
  }
  return policy
}
export async function preparePlan(input,root){
  if(input.notification?.enabled===true&&(!input.notification.targetSessionId||!input.notification.parentInstructionRef))throw Error('automatic resume needs exact parent Session/instruction scope')
  const target=targets[input.program]
  if(!target||input.origin!==target.origin||!/^[a-z0-9-]+$/.test(input.runId))throw Error('exact target and stable runId required')
  if(!root.startsWith('/data/_dsh-builds/v4-141-')||await realpath(dirname(root))!==dirname(root))throw Error('reported canonical persistent private artifact root required')
  const revision=spawnSync('git',['-C',tools,'rev-parse','HEAD'],{encoding:'utf8'})
  const dirty=spawnSync('git',['-C',tools,'status','--porcelain'],{encoding:'utf8'})
  if(revision.status!==0||dirty.status!==0||dirty.stdout.trim())throw Error('commit preparation tools before freezing a deployment plan')
  const toolCommit=revision.stdout.trim()
  await verifyRelease(input.release) // includes real new capability and complete executable rollback evidence
  await mkdir(root,{mode:0o700})
  const toolset=join(root,'tools');await mkdir(toolset,{mode:0o700})
  const toolFiles=[]
  for(const name of await readdir(tools)){
    if((name.endsWith('.mjs')&&!name.endsWith('.test.mjs'))||name.endsWith('.py')){
      const path=join(toolset,name);await cp(join(tools,name),path,{errorOnExist:true,force:false});toolFiles.push({path,sha256:sha(await readFile(path))})
    }
  }
  const browserLookup=spawnSync('which',['agent-browser'],{encoding:'utf8'})
  if(browserLookup.status!==0)throw Error('agent-browser CLI unavailable before deployment')
  const browserPath=await realpath(browserLookup.stdout.trim())
  const browserVersion=spawnSync(browserPath,['--version'],{encoding:'utf8'})
  const pythonLookup=spawnSync('python3',['-c','import sys; print(sys.executable)'],{encoding:'utf8'})
  if(browserVersion.status!==0||pythonLookup.status!==0)throw Error('verification runtime unavailable')
  const browser={path:browserPath,sha256:await optionalHash(browserPath),version:browserVersion.stdout.trim()}
  const pythonBinary=await realpath(pythonLookup.stdout.trim())
  const info=spawnSync(pythonBinary,[join(toolset,'supervisor-info.py'),input.program],{encoding:'utf8'})
  if(info.status!==0)throw Error('structured Supervisor observation failed')
  const service=JSON.parse(info.stdout)
  if(service.statename!=='RUNNING')throw Error('original existing target must be running during preparation')
  const preview=input.program==='dsh-a2d2-v3-preview'
  const previewRoot='/data/_dsh-dev/previews/a2d2-v3-121'
  const cliPid=preview?JSON.parse(await readFile(join(previewRoot,'current-run.json'))).pid:service.pid
  const env=Object.fromEntries((await readFile(`/proc/${cliPid}/environ`)).toString().split('\0').filter(Boolean).map(row=>{const i=row.indexOf('=');return[row.slice(0,i),row.slice(i+1)]}))
  const expectedHome=preview?join(previewRoot,'home'):'/data/_dsh-dev'
  if(env.DSH_HOME!==expectedHome)throw Error('actual DSH_HOME differs; do not infer environment')
  for(const key of ['NODE_OPTIONS','NODE_PATH','DSH_INSTALL_ANCHOR'])if(env[key]?.includes('/deepseek-harness-dev/'))throw Error('module-affecting environment still targets shared dev; needs exact review')
  const predicted=spawnSync(pythonBinary,[join(toolset,'supervisor-env.py'),input.program],{encoding:'utf8'})
  if(predicted.status!==0)throw Error('future Supervisor environment could not be verified')
  const predictedHashes=JSON.parse(predicted.stdout).valueHashes
  const environmentPolicy=environmentPolicyFor(env,predictedHashes,preview)
  const cwd=await realpath(`/proc/${cliPid}/cwd`)
  const conf=`/etc/supervisor/conf.d/${input.program}.conf`,originalConf=await readFile(conf,'utf8')
  const evidenceRoot=input.evidenceRoot
  if(!evidenceRoot?.startsWith('/tmp/a2d2-v4-'))throw Error('sensitive raw evidence stays in private tmp')
  await mkdir(evidenceRoot,{mode:0o700})
  await save(join(evidenceRoot,'original-environment-metadata.private.json'),{source:'actual-proc-environment',keys:Object.keys(env),valueHashes:Object.fromEntries(Object.entries(env).map(([key,value])=>[key,sha(value)]))})
  await writeFile(join(evidenceRoot,'original-supervisor.private.conf'),originalConf,{flag:'wx',mode:0o600})
  const allowedSystemGenesis=[]
  const runtimeIdentityPath=join(expectedHome,'a2d2/work-v3/runtime-v1.json')
  if(!preview&&await optionalHash(runtimeIdentityPath)===null)allowedSystemGenesis.push({path:runtimeIdentityPath,kind:'work-runtime-v1'})
  const originalProfileSha256=await fingerprintTree(target.profile),profiles={},files={new:[],rollback:[]}
  const sourceFiles={conf:await optionalHash(conf),previewLauncher:preview?await optionalHash(join(previewRoot,'launch.mjs')):null,previewConfig:preview?await optionalHash(join(previewRoot,'.v4-141-runtime.private.json')):null}
  const identity=async pid=>{const text=await readFile(`/proc/${pid}/stat`,'utf8');return{pid,startTicks:text.slice(text.lastIndexOf(')')+2).split(/\s+/)[19]}}
  let initialStop={strategy:'supervisor-single-signal'}
  if(preview&&/^stopasgroup\s*=\s*(true|yes|1)\s*$/mi.test(originalConf)){
    if(!service.stdoutUnique)throw Error('original preview child-exit log is not uniquely attributable')
    const entry=join(previewRoot,'launch.mjs'),candidate=join(root,'maintenance-hold.mjs')
    await writeFile(candidate,maintenanceHoldSource(input.runId),{flag:'wx',mode:0o600})
    await writeFile(join(evidenceRoot,'original-preview-launcher.private.mjs'),await readFile(entry),{flag:'wx',mode:0o600})
    const signalContractFiles=[]
    for(const path of ['/usr/lib/python3/dist-packages/supervisor/process.py','/usr/lib/python3/dist-packages/supervisor/rpcinterface.py'])signalContractFiles.push({path,sha256:await optionalHash(path)})
    initialStop={strategy:'single-pid-term-with-hold',launcher:await identity(service.pid),cli:await identity(cliPid),hold:{target:entry,candidate,sha256:await optionalHash(candidate),allowedCurrentSha256:[sourceFiles.previewLauncher]},receipt:join(previewRoot,'.v4-141-maintenance-hold.json'),signalContractFiles}
  }else if(!preview){
    const args=(await readFile(`/proc/${service.pid}/cmdline`)).toString().split('\0')
    if(!args.some(value=>value.endsWith('/apps/cli/lib/bin.js'))||!args.includes('web'))throw Error('GUI is not a proven direct CLI process; do not infer Python wrapper behavior')
  }
  for(const side of ['new','rollback']){
    const proof=JSON.parse(await readFile(input.profiles[side]))
    if(proof.hostRoot!==(side==='new'?input.release.hostRoot:input.release.rollbackHostRoot))throw Error('profile host root differs from verified release')
    if(side==='new'&&(proof.clientSha256!==input.release.artifacts.find(row=>row.role==='plugin-client')?.sha256||proof.tgzSha256!==input.release.artifacts.find(row=>row.role==='plugin-tgz')?.sha256))throw Error('staged new plugin differs from verified tgz/client')
    if(await fingerprintTree(proof.path)!==proof.sha256)throw Error('staged profile changed since import proof')
    const path=join(root,`profile-${side}`);await cp(proof.path,path,{recursive:true,dereference:false,errorOnExist:true,force:false})
    const runtimeTarget=preview?join(previewRoot,'.v4-141-runtime.private.json'):join(target.profile,'.v4-141-runtime.private.json')
    const launcherTarget=preview?join(previewRoot,'launch.mjs'):join(target.profile,'.v4-141-launcher.mjs')
    const notifierConfig={enabled:input.notification?.enabled===true,runId:input.runId,evidenceRoot,targetSessionId:input.notification?.targetSessionId,parentInstructionRef:input.notification?.parentInstructionRef}
    const notifier=join(path,'.v4-141-notifier.mjs');await cp(join(toolset,'automatic-notifier.mjs'),notifier,{errorOnExist:true,force:false})
    const notificationPatch=join(root,`notification-${side}.private.json`)
    await save(notificationPatch,[{insert:[{id:'a2d2-v4-acceptance-notifier',name:join(target.profile,'.v4-141-notifier.mjs'),config:notifierConfig}]}])
    // For import-only proof the same copied module is addressed in its staged location.
    const importPatch=join(root,`notification-${side}-import.private.json`)
    await save(importPatch,[{insert:[{id:'a2d2-v4-acceptance-notifier',name:notifier,config:notifierConfig}]}])
    const runtime={program:input.program,origin:input.origin,deploymentRunId:input.runId,hostCommit:side==='new'?input.release.hostCommit:'a45068d2ec03326c800c68c9bdcd47508e3ccb9c',pluginSha256:proof.tgzSha256,legacyCurrentRunPath:preview?join(previewRoot,'current-run.json'):undefined,node:process.execPath,cli:join(proof.hostRoot,'apps/cli/lib/bin.js'),cwd,environmentPolicy,overlays:[...proof.overlays,notificationPatch],currentRunPath:join(target.profile,'.v4-141-current-run.json'),exitReceiptPath:join(target.profile,'.v4-141-exit.json'),logPath:join(target.profile,'.v4-141-web.private.log')}
    const runtimeCandidate=join(root,`runtime-${side}.private.json`);await save(runtimeCandidate,runtime)
    const launcherCandidate=join(root,`launcher-${side}.mjs`);await cp(join(toolset,'managed-launcher.mjs'),launcherCandidate,{errorOnExist:true,force:false})
    if(!preview){await cp(runtimeCandidate,join(path,'.v4-141-runtime.private.json'));await cp(launcherCandidate,join(path,'.v4-141-launcher.mjs'))}
    else{
      files[side].push({target:runtimeTarget,candidate:runtimeCandidate,sha256:await optionalHash(runtimeCandidate),allowedCurrentSha256:[sourceFiles.previewConfig]})
      files[side].push({target:launcherTarget,candidate:launcherCandidate,sha256:await optionalHash(launcherCandidate),allowedCurrentSha256:[sourceFiles.previewLauncher]})
    }
    let candidate=setConf(originalConf,'command',`${process.execPath} ${launcherTarget}`)
    candidate=setConf(candidate,'stopasgroup','false');candidate=setConf(candidate,'killasgroup','true');candidate=setConf(candidate,'stopsignal','TERM');candidate=setConf(candidate,'stopwaitsecs','15')
    const confCandidate=join(root,`supervisor-${side}.private.conf`);await writeFile(confCandidate,candidate,{flag:'wx',mode:0o600})
    files[side].push({target:conf,candidate:confCandidate,sha256:await optionalHash(confCandidate),allowedCurrentSha256:[sourceFiles.conf]})
    const imported=await importProfile(proof.hostRoot,path,[...proof.overlays,importPatch])
    const importsReceipt=join(root,`profile-${side}-imports.private.json`);await save(importsReceipt,imported)
    profiles[side]={...proof,path,sha256:await fingerprintTree(path),overlays:runtime.overlays,importsReceipt:{path:importsReceipt,sha256:await optionalHash(importsReceipt)}}
  }
  // Explicitly allow the reviewed new/old candidates during partial-apply recovery.
  for(const side of ['new','rollback'])for(const file of files[side]){
    const holdHashes=initialStop.hold?.target===file.target?[initialStop.hold.sha256]:[]
    file.allowedCurrentSha256=[...new Set([...file.allowedCurrentSha256,...holdHashes,...files.new.filter(row=>row.target===file.target).map(row=>row.sha256),...files.rollback.filter(row=>row.target===file.target).map(row=>row.sha256)])]
  }
  const script=join(toolset,'profile-actions.mjs'),scriptSha=await optionalHash(script)
  const plan={...input,toolCommit,browser,pythonBinary,environmentPolicy,allowedSystemGenesis,initialStop,prepareOnly:true,evidenceRoot,release:input.release,profiles,files,toolFiles,originalProfileSha256,serviceAtPreparation:service,executionInstruction:join(evidenceRoot,'parent-execution-instruction.json'),settlement:join(evidenceRoot,'operational-handover.json'),liveCutPath:join(evidenceRoot,'pre-stop-cut/live-cut.json'),stopMode:'operational-stop-cut',stopPolicy:{parentReviewedStaticCut:false,officialReceipt:null},actions:Object.fromEntries(['apply','verify','rollback','rollbackVerify'].map(kind=>[kind,{script,sha256:scriptSha}]))}
  await save(join(root,'plan.private.json'),plan)
  return {planPath:join(root,'plan.private.json'),program:input.program,origin:input.origin,prepareOnly:true,actionCount:4,profileImports:{new:true,rollback:true},notificationPrepared:input.notification?.enabled===true}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const[inputPath,root]=process.argv.slice(2);console.log(JSON.stringify(await preparePlan(JSON.parse(await readFile(inputPath)),root),null,2))}catch(error){console.error(error.message);process.exitCode=1}
}
