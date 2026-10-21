import {open} from 'node:fs/promises'
import {createHash} from 'node:crypto'

const budgetMs=10000
const bufferLimits={maxTotalBufferSize:16*1024*1024,maxResourceBufferSize:16*1024*1024}
const hash=body=>createHash('sha256').update(body).digest('hex')
function safeUrl(value){
  try{
    const url=new URL(value)
    if(!['http:','https:','file:','about:'].includes(url.protocol))return url.protocol+'[redacted]'
    url.username='';url.password='';url.hash=''
    if(url.pathname!=='/plugins/'||!/^\?\?[A-Za-z0-9@/.,_-]+&rev=[a-f0-9]{12}$/.test(url.search))url.search=''
    return url.href
  }catch{return '[invalid URL]'}
}
const safeMessage=value=>String(value).replace(/(?:https?|wss?):\/\/\S+/g,'[URL redacted]').replace(/\b(token|cookie|password|authorization)\s*[=:]\s*\S+/gi,'$1=[redacted]')

// One dedicated agent-browser page; every Script of the selected main document must complete.
// The wire/body budgets and cache/identity requirements remain unchanged.
export async function captureScriptResponses(endpoint,{metadataPath}={}){
  const url=new URL(endpoint)
  if(url.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('local agent-browser CDP endpoint required')
  const metadataFile=metadataPath?await open(metadataPath,'wx',0o600):null
  const requests=new Map(),scripts=new Map(),cached=new Set(),changes=new Set()
  let socket,nextId=0,sessionId,frame,transportError,closed=false,cacheDisabled=false,serviceWorkerBypassed=false,writes=Promise.resolve()
  const notify=()=>{for(const resume of [...changes])resume()}
  const saveMetadata=async(status,error)=>{
    const value={source:'cdp-script-capture-metadata',status,at:new Date().toISOString(),frame:frame?{id:frame.id,loaderId:frame.loaderId,url:safeUrl(frame.url)}:null,budgetMs,bufferLimits,cacheDisabled,serviceWorkerBypassed,scope:'all observed Script responses; require every Script of the selected main document; binding validates the target separately',error:error?safeMessage(error.message):null,scripts:[...scripts.values()].map(row=>({requestId:row.requestId,loaderId:row.loaderId??null,frameId:row.frameId??null,url:safeUrl(row.url),status:row.status,resourceType:row.resourceType,contentType:row.contentType,state:row.state,failed:row.failed===true,pending:row.state==='loading'||row.state==='body-pending',currentDocument:row.loaderId===frame?.loaderId&&row.frameId===frame?.id,bodyBytes:typeof row.body==='string'?Buffer.byteLength(row.body):null,bodySha256:typeof row.body==='string'?hash(row.body):null,encodedDataLength:row.encodedDataLength??null,servedFromCache:cached.has(row.requestId),fromDiskCache:row.fromDiskCache,fromServiceWorker:row.fromServiceWorker,fromPrefetchCache:row.fromPrefetchCache,bodyError:row.bodyError??null,loadingError:row.loadingError??null}))}
    if(metadataFile){writes=writes.then(async()=>{await metadataFile.write(JSON.stringify(value)+'\n');await metadataFile.sync()});await writes}
    return value
  }
  const close=async()=>{
    if(closed)return
    closed=true
    for(const pending of requests.values())pending.reject(Error('browser CDP capture closed'))
    requests.clear();socket?.close();notify()
    try{await writes}finally{await metadataFile?.close()}
  }
  const send=(method,params={},target=sessionId,timeoutMs=budgetMs)=>new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>{requests.delete(id);reject(Error('browser CDP command timed out'))},Math.max(1,timeoutMs))
    requests.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}})
    socket.send(JSON.stringify({id,method,params,...target?{sessionId:target}:{}}))
  })
  try{
    socket=new WebSocket(endpoint)
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('browser CDP connection timed out')),budgetMs)
      socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true})
      socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('browser CDP connection failed'))},{once:true})
    })
    socket.addEventListener('close',()=>{if(!closed){transportError=Error('browser CDP transport closed');notify()}})
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data)
      if(message.id){
        const pending=requests.get(message.id)
        if(pending){requests.delete(message.id);if(message.error)pending.reject(Object.assign(Error('browser CDP command rejected'),{cdpError:message.error}));else pending.resolve(message.result)}
        return
      }
      if(message.sessionId!==sessionId)return
      const value=message.params
      if(message.method==='Page.frameNavigated'&&!value.frame.parentId){frame=value.frame;notify()}
      if(message.method==='Network.requestServedFromCache')cached.add(value.requestId)
      if(message.method==='Network.responseReceived'&&value.type==='Script'){
        const response=value.response
        scripts.set(value.requestId,{source:'cdp-network-script-response',requestId:value.requestId,loaderId:value.loaderId,frameId:value.frameId,resourceType:value.type,url:response.url,status:response.status,contentType:Object.entries(response.headers).find(([key])=>key.toLowerCase()==='content-type')?.[1]??response.mimeType,fromDiskCache:response.fromDiskCache===true,fromServiceWorker:response.fromServiceWorker===true,fromPrefetchCache:response.fromPrefetchCache===true,state:'loading'})
        notify()
      }
      if(message.method==='Network.loadingFailed'&&scripts.has(value.requestId)){
        const row=scripts.get(value.requestId)
        row.failed=true;row.state='failed';row.loadingError={errorText:safeMessage(value.errorText),canceled:value.canceled===true};notify()
      }
      if(message.method==='Network.loadingFinished'&&scripts.has(value.requestId)){
        const row=scripts.get(value.requestId);row.state='body-pending';row.encodedDataLength=value.encodedDataLength
        send('Network.getResponseBody',{requestId:value.requestId}).then(result=>{
          if(typeof result.body!=='string')throw Error('invalid CDP response body')
          row.body=result.base64Encoded?Buffer.from(result.body,'base64').toString('utf8'):result.body
          row.state='complete';notify()
        }).catch(error=>{row.failed=true;row.state='failed';row.bodyError={code:error.cdpError?.code??null,message:safeMessage(error.cdpError?.message??error.message)};notify()})
      }
    })
    const targets=await send('Target.getTargets',{},undefined)
    const pages=targets.targetInfos.filter(row=>row.type==='page'&&row.url==='about:blank')
    if(pages.length!==1)throw Error('one dedicated blank agent-browser page required before capture')
    sessionId=(await send('Target.attachToTarget',{targetId:pages[0].targetId,flatten:true},undefined)).sessionId
    await send('Page.enable')
    await send('Network.enable',bufferLimits)
    await send('Network.setCacheDisabled',{cacheDisabled:true});cacheDisabled=true
    await send('Network.setBypassServiceWorker',{bypass:true});serviceWorkerBypassed=true
    await send('Network.clearBrowserCache')
    return {close,saveMetadata,async snapshot(origin){
      const deadline=Date.now()+budgetMs
      try{
        frame=(await send('Page.getFrameTree')).frameTree.frame
        const expected={id:frame.id,loaderId:frame.loaderId}
        if(new URL(frame.url).origin!==origin)throw Error('captured document is outside original origin')
        while(true){
          if(closed||transportError)throw transportError??Error('browser CDP capture closed')
          if(frame.id!==expected.id||frame.loaderId!==expected.loaderId)throw Error('captured document identity changed')
          const rows=[...scripts.values()].filter(row=>row.loaderId===expected.loaderId&&row.frameId===expected.id)
          if(rows.some(row=>row.failed))throw Error('actual loaded Script response capture incomplete')
          const remaining=deadline-Date.now()
          if(remaining<=0)throw Error('actual loaded Script response capture incomplete: pending beyond original budget')
          if(rows.length&&rows.every(row=>row.state==='complete'&&typeof row.body==='string')){
            frame=(await send('Page.getFrameTree',{},sessionId,remaining)).frameTree.frame
            if(frame.id!==expected.id||frame.loaderId!==expected.loaderId||new URL(frame.url).origin!==origin)throw Error('captured document identity changed')
            await saveMetadata('complete')
            return rows.map(row=>({...row,servedFromCache:cached.has(row.requestId),cacheDisabled:true,serviceWorkerBypassed:true}))
          }
          await new Promise((resolve,reject)=>{
            const resume=()=>{clearTimeout(timer);changes.delete(resume);resolve()}
            const timer=setTimeout(()=>{changes.delete(resume);reject(Error('actual loaded Script response capture incomplete: pending beyond original budget'))},remaining)
            changes.add(resume)
          })
        }
      }catch(error){error.captureMetadata=await saveMetadata('failed',error);throw error}
    }}
  }catch(error){try{error.captureMetadata=await saveMetadata('failed',error)}finally{await close()}throw error}
}
