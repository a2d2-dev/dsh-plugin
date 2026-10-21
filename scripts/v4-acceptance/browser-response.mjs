// One dedicated agent-browser page; read actual CDP Script bodies without routing or refetch.
export async function captureScriptResponses(endpoint){
  const url=new URL(endpoint)
  if(url.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('local agent-browser CDP endpoint required')
  const socket=new WebSocket(endpoint),requests=new Map(),scripts=new Map(),cached=new Set(),bodies=[]
  let nextId=0,sessionId
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('browser CDP connection timed out')),10000)
    socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true})
    socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('browser CDP connection failed'))},{once:true})
  })
  const send=(method,params={},target=sessionId)=>new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>{requests.delete(id);reject(Error('browser CDP command timed out'))},10000)
    requests.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}})
    socket.send(JSON.stringify({id,method,params,...target?{sessionId:target}:{}}))
  })
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data)
    if(message.id){
      const pending=requests.get(message.id)
      if(pending){requests.delete(message.id);if(message.error)pending.reject(Error('browser CDP command rejected'));else pending.resolve(message.result)}
      return
    }
    if(message.sessionId!==sessionId)return
    const value=message.params
    if(message.method==='Network.requestServedFromCache')cached.add(value.requestId)
    if(message.method==='Network.responseReceived'&&value.type==='Script'){
      const response=value.response
      scripts.set(value.requestId,{source:'cdp-network-script-response',requestId:value.requestId,loaderId:value.loaderId,frameId:value.frameId,resourceType:value.type,url:response.url,status:response.status,contentType:Object.entries(response.headers).find(([key])=>key.toLowerCase()==='content-type')?.[1]??response.mimeType,fromDiskCache:response.fromDiskCache===true,fromServiceWorker:response.fromServiceWorker===true,fromPrefetchCache:response.fromPrefetchCache===true})
    }
    if(message.method==='Network.loadingFailed'&&scripts.has(value.requestId))scripts.get(value.requestId).failed=true
    if(message.method==='Network.loadingFinished'&&scripts.has(value.requestId)){
      const row=scripts.get(value.requestId)
      bodies.push(send('Network.getResponseBody',{requestId:value.requestId}).then(result=>{
        row.body=result.base64Encoded?Buffer.from(result.body,'base64').toString('utf8'):result.body
      }).catch(()=>{row.failed=true}))
    }
  })
  const close=()=>{for(const pending of requests.values())pending.reject(Error('browser CDP capture closed'));requests.clear();socket.close()}
  try{
    const targets=await send('Target.getTargets',{},undefined)
    const pages=targets.targetInfos.filter(row=>row.type==='page'&&row.url==='about:blank')
    if(pages.length!==1)throw Error('one dedicated blank agent-browser page required before capture')
    sessionId=(await send('Target.attachToTarget',{targetId:pages[0].targetId,flatten:true},undefined)).sessionId
    await send('Page.enable')
    await send('Network.enable',{maxTotalBufferSize:16*1024*1024,maxResourceBufferSize:16*1024*1024})
    await send('Network.setCacheDisabled',{cacheDisabled:true})
    await send('Network.setBypassServiceWorker',{bypass:true})
    await send('Network.clearBrowserCache')
    return {close,async snapshot(origin){
      const {frameTree}=await send('Page.getFrameTree')
      if(new URL(frameTree.frame.url).origin!==origin)throw Error('captured document is outside original origin')
      await Promise.all(bodies)
      const rows=[...scripts.values()].filter(row=>row.loaderId===frameTree.frame.loaderId&&row.frameId===frameTree.frame.id)
      if(!rows.length||rows.some(row=>row.failed||typeof row.body!=='string'))throw Error('actual loaded Script response capture incomplete')
      return rows.map(row=>({...row,servedFromCache:cached.has(row.requestId),cacheDisabled:true,serviceWorkerBypassed:true}))
    }}
  }catch(error){close();throw error}
}
