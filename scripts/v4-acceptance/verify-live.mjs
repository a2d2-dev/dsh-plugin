import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { liveCut } from './live-cut.mjs'
import { canonical } from './retention.mjs'
import { permitsSystemGenesis } from './data-genesis.mjs'
import { targets } from './profile-actions.mjs'
import { captureScriptResponses } from './browser-response.mjs'

import { setTimeout as delay } from 'node:timers/promises'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function runBrowser(binary,session,args,input){
  const result=spawnSync(binary,['--session',session,...args],{input,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024})
  if(result.status!==0)throw Error('dedicated browser verification failed; inspect private action log')
  return result.stdout
}
// Fixed a450/8282 Host prepareSource + buildComboScript contract.
const sourceMapTrailer=/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/
const sourceUrlTrailer=/(?:\r?\n)?\/\/# sourceURL=([^\r\n]+)(?:\r?\n)?$/
function combo(url,origin){
  const parsed=new URL(url)
  const match=parsed.search.match(/^\?\?(.+)&rev=([a-f0-9]{12})$/)
  if(parsed.origin!==origin||parsed.pathname!=='/plugins/'||parsed.hash||!match)throw Error('unexpected browser module URI')
  const resources=match[1].split(',')
  const ids=resources.map(resource=>{
    const match=resource.match(/^((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)\/client\.js$/i)
    if(!match)throw Error('unexpected browser module URI')
    return match[1]
  })
  if(new Set(ids).size!==ids.length)throw Error('duplicate browser module')
  return {ids,trailer:`//# sourceMappingURL=??${ids.map(id=>id+'/client.js.map').join(',')}&rev=${match[2]}\n`}
}
function response(row,origin){
  if(row.status!==200||!row.contentType?.includes('javascript')||typeof row.body!=='string')throw Error('actual plugin response failed or returned non-JavaScript content')
  const parsed=combo(row.url,origin)
  if(!row.body.endsWith(parsed.trailer))throw Error('browser module source-map trailer mismatch')
  return {...parsed,source:row.body.slice(0,-parsed.trailer.length)}
}
export function verifyBrowserClients({origin,loadedPayloads:payloads,modules,client,clientSha256}){
  if(hash(client)!==clientSha256)throw Error('selected client fingerprint mismatch')
  let prepared=client.toString().replace(sourceUrlTrailer,'').replace(sourceMapTrailer,'')
  if(!prepared.endsWith('\n'))prepared+='\n'
  if(!Array.isArray(payloads)||!payloads.length||!Array.isArray(modules))throw Error('browser plugin resource missing')
  const singletons=new Map()
  for(const row of modules){
    const parsed=response(row,origin)
    if(parsed.ids.length!==1||singletons.has(parsed.ids[0]))throw Error('ambiguous browser module singleton')
    if(parsed.ids[0]==='dsh-a2d2'&&parsed.source!==prepared+';\n')throw Error('browser response does not match selected client')
    singletons.set(parsed.ids[0],parsed.source)
  }
  if(!singletons.has('dsh-a2d2'))throw Error('selected client module missing')
  if(new Set(payloads.map(row=>row.requestId)).size!==payloads.length||new Set(payloads.map(row=>row.loaderId)).size!==1||new Set(payloads.map(row=>row.frameId)).size!==1)throw Error('loaded Script document/request identity ambiguous')
  return payloads.map(row=>{
    if(row.source!=='cdp-network-script-response'||row.resourceType!=='Script'||!row.requestId||!row.loaderId||!row.frameId||row.cacheDisabled!==true||row.serviceWorkerBypassed!==true||row.servedFromCache!==false||row.fromDiskCache!==false||row.fromServiceWorker!==false||row.fromPrefetchCache!==false)throw Error('actual loaded Script response with disabled cache required')
    const parsed=response(row,origin)
    if(!parsed.ids.includes('dsh-a2d2'))throw Error('selected client module missing from loaded combo')
    const source=parsed.ids.map(id=>{if(!singletons.has(id))throw Error('browser combo module missing');return singletons.get(id)}).join('')
    if(row.body!==source+parsed.trailer)throw Error('loaded browser combo differs from bound module responses')
    const {body,...metadata}=row
    return {...metadata,sha256:hash(body),bytes:Buffer.byteLength(body),clientSha256,preparedClientSha256:hash(prepared),binding:'host-prepared-client-and-ordered-combo'}
  })
}
export async function verifyLive(plan,side){
  const target=targets[plan.program],selected=plan.profiles[side]
  if(!target||plan.origin!==target.origin)throw Error('wrong live origin')
  if(!plan.browser?.path||hash(await readFile(plan.browser.path))!==plan.browser.sha256)throw Error('pinned agent-browser executable missing/changed')
  if(!/^[a-z0-9-]+$/.test(plan.runId))throw Error('stable browser runId required')
  const browser=(args,input)=>runBrowser(plan.browser.path,`a2d2-v4-${plan.runId}-${side}`,args,input)
  const evaluate=script=>{
    const value=JSON.parse(browser(['--json','eval','--stdin'],script))
    if(value.success!==true||!Object.hasOwn(value.data??{},'result'))throw Error('invalid browser evaluation envelope')
    return value.data.result
  }
  let run
  const deadline=Date.now()+30000
  while(Date.now()<deadline){
    try{
      const candidate=JSON.parse(await readFile(join(target.profile,'.v4-141-current-run.json')))
      if(candidate.origin===plan.origin&&candidate.cli===join(selected.hostRoot,'apps/cli/lib/bin.js')){
        await readFile(`/proc/${candidate.pid}/stat`);run=candidate;break
      }
    }catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error}
    await delay(200)
  }
  if(!run)throw Error('matching live host did not become ready at the original origin')
  const args=(await readFile(`/proc/${run.pid}/cmdline`)).toString().split('\0')
  if(args[1]!==run.cli||!args.includes('web'))throw Error('live process is not the verified host CLI')
  const installedClientSha256=hash(await readFile(join(target.profile,'node_modules/dsh-a2d2/lib/client.js')))
  if(installedClientSha256!==selected.clientSha256)throw Error('installed client does not match prepared artifact')
  const before=JSON.parse(await readFile(plan.liveCutPath))
  const after=await liveCut(plan.program,join(plan.evidenceRoot,`${side}-live-cut`))
  const map=new Map(after.sessions.map(session=>[session.id,session]))
  for(const old of before.sessions){
    const current=map.get(old.id)
    if(!current||current.cwd!==old.cwd||old.eventHashes.some((sha,index)=>current.eventHashes[index]!==sha))throw Error('live Session identity/accepted history lost')
    if(old.config&&canonical(old.config)!==canonical(current.config))throw Error('live Session configuration selection drift')
  }
  const jsonAfter=new Map((after.jsonCut??[]).map(file=>[file.path,file]))
  const genesis=[]
  for(const old of before.jsonCut??[]){
    const current=jsonAfter.get(old.path)
    if(old.exists===false&&current?.exists===true){
      const value=JSON.parse(await readFile(old.path,'utf8'))
      if(!permitsSystemGenesis(old.path,false,value,plan.allowedSystemGenesis))throw Error('unapproved new persistent data')
      genesis.push({path:old.path,...value});continue
    }
    if(!current||current.exists!==old.exists||(old.exists&&current.materialSha256!==old.materialSha256))throw Error('runtime/domain/workspace identity or material drift')
  }
  let desktop,narrow,resources,capture
  try{
    browser(['open','about:blank'])
    capture=await captureScriptResponses(browser(['get','cdp-url']).trim(),{metadataPath:join(plan.evidenceRoot,`${side}-script-capture-metadata.jsonl`)})
    browser(['open',plan.origin+'/'])
    const password=(await readFile('/data/_dsh-dev/web-password','utf8')).trim()
    evaluate(`fetch('/?token='+encodeURIComponent(${JSON.stringify(password)}),{credentials:'include'}).then(r=>({status:r.status}))`)
    browser(['open',plan.origin+'/']) // full same-URL document refresh; no HMR promise
    browser(['wait','--fn',"document.querySelector('[aria-label=\"Global panels\"]') !== null"])
    evaluate(`(() => { const dialog=Array.from(document.querySelectorAll('[role="dialog"],dialog')).find(node=>Array.from(node.querySelectorAll('h2,[role="heading"]')).some(title=>title.textContent.trim()==='Preview Notice')); if(!dialog)return false; const buttons=Array.from(dialog.querySelectorAll('button')).filter(button=>button.textContent.trim()==='Continue'&&!button.disabled); if(buttons.length!==1)throw Error('preview dialog is ambiguous'); buttons[0].click(); return true })()` )
    const expectsEntry=side==='new'||plan.program==='dsh-a2d2-v3-preview'
    if(expectsEntry){
      const result=evaluate("document.querySelector('[aria-label=\"Global panels\"]')?.textContent.includes('A²D²') === true")
      if(result!==true)throw Error('actual global A²D² entry missing')
    }
    browser(['set','viewport','1440','1000'])
    desktop=join(plan.evidenceRoot,`${side}-desktop.png`);browser(['screenshot',desktop])
    browser(['set','viewport','390','844'])
    narrow=join(plan.evidenceRoot,`${side}-narrow.png`);browser(['screenshot',narrow])
    const loadedPayloads=(await capture.snapshot(plan.origin)).filter(row=>row.url.includes('/plugins/')&&row.url.includes('dsh-a2d2'))
    await writeFile(join(plan.evidenceRoot,`${side}-loaded-script-responses.private.json`),JSON.stringify(loadedPayloads,null,2)+'\n',{flag:'wx',mode:0o600})
    const observed=loadedPayloads.map(row=>row.url)
    const ids=[...new Set(observed.flatMap(url=>combo(url,plan.origin).ids))]
    const entries=evaluate('window.__DSH_BOOT__.entries.map(({id,url})=>({id,url}))')
    const urls=ids.map(id=>{
      const matches=entries.filter(row=>row.id===id)
      if(matches.length!==1)throw Error('browser graph module missing or ambiguous')
      const url=new URL(matches[0].url,plan.origin+'/').href
      if(JSON.stringify(combo(url,plan.origin).ids)!==JSON.stringify([id]))throw Error('browser graph singleton module mismatch')
      return url
    })
    const modules=evaluate(`Promise.all(${JSON.stringify(urls)}.map(async url=>{const response=await fetch(url,{cache:'reload',credentials:'same-origin'});return {url,status:response.status,contentType:response.headers.get('content-type'),body:await response.text()}}))`)
    resources=verifyBrowserClients({origin:plan.origin,loadedPayloads,modules,client:await readFile(join(target.profile,'node_modules/dsh-a2d2/lib/client.js')),clientSha256:selected.clientSha256})
  }catch(error){await capture?.saveMetadata('verification-failed',error);throw error}
  finally{await capture?.close();browser(['close'])}
  const result={source:'automatic-acceptance',status:'verified',side,origin:plan.origin,pid:run.pid,cli:run.cli,installedClientSha256,retainedSessions:before.sessions.length,genesis,desktop:{path:desktop,sha256:hash(await readFile(desktop))},narrow:{path:narrow,sha256:hash(await readFile(narrow))},resources,scope:'same URL browser refresh + native process/client fingerprint + public Session accepted-prefix/config selection; effective live permissions and real-model E2E remain separate'}
  await writeFile(join(plan.evidenceRoot,`${side}-verification.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600})
  return result
}
