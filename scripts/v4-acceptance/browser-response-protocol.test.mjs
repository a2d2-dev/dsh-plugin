import test from 'node:test'
import assert from 'node:assert/strict'
import {setImmediate as nextTurn} from 'node:timers/promises'
import {captureScriptResponses} from './browser-response.mjs'
import {mkdtemp,readFile,stat} from 'node:fs/promises'
import {join} from 'node:path'

const origin='http://10.126.126.12:18782'
// CDP wire fixture at the external WebSocket boundary. No HTTP service or own-module mock.
function protocolFixture(t){
  const Native=globalThis.WebSocket,bodyRequests=new Map();let socket,frame={id:'frame',loaderId:'document',url:origin+'/'}
  globalThis.WebSocket=class extends EventTarget{
    constructor(){super();socket=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')))}
    send(text){
      const command=JSON.parse(text)
      if(command.method==='Network.getResponseBody'){bodyRequests.set(command.params.requestId,command);return}
      const result=command.method==='Target.getTargets'?{targetInfos:[{type:'page',url:'about:blank',targetId:'page'}]}:command.method==='Target.attachToTarget'?{sessionId:'cdp-session'}:command.method==='Page.getFrameTree'?{frameTree:{frame}}:{}
      queueMicrotask(()=>message({id:command.id,result}))
    }
    close(){}
  }
  t.after(()=>{globalThis.WebSocket=Native})
  function message(value){socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}))}
  const event=(method,params)=>message({sessionId:'cdp-session',method,params})
  return {
    response(requestId,response={}){event('Network.responseReceived',{requestId,loaderId:frame.loaderId,frameId:frame.id,type:'Script',response:{url:origin+'/plugins/??dsh-a2d2/client.js&rev=111111111111',status:200,headers:{'Content-Type':'text/javascript'},fromDiskCache:false,...response}})},
    navigate(loaderId,url=origin+'/'){frame={...frame,loaderId,url};event('Page.frameNavigated',{frame})},
    fail(requestId){event('Network.loadingFailed',{requestId,errorText:'net::ERR_FAILED',canceled:false})},
    finish(requestId){event('Network.loadingFinished',{requestId,encodedDataLength:12})},
    bodyError(requestId){const command=bodyRequests.get(requestId);assert.ok(command);message({id:command.id,error:{code:-32000,message:'No resource with given identifier found'}})},
    body(requestId,body){const command=bodyRequests.get(requestId);assert.ok(command,'getResponseBody must follow loadingFinished');message({id:command.id,result:{body,base64Encoded:false}})},
  }
}

test('response已收到但loadingFinished/body延迟时snapshot必须等待真实完成',async t=>{
  const wire=protocolFixture(t),capture=await captureScriptResponses('ws://127.0.0.1/protocol-fixture')
  t.after(()=>capture.close())
  wire.response('script-1')
  let settled=false
  const outcome=capture.snapshot(origin).then(rows=>{settled=true;return{rows}},error=>{settled=true;return{error}})
  await nextTurn()
  assert.equal(settled,false,'snapshot must not reject a current Script before loadingFinished')
  wire.finish('script-1')
  await nextTurn()
  assert.equal(settled,false,'snapshot must wait for the actual getResponseBody result')
  wire.body('script-1','actual loaded body')
  const result=await outcome
  assert.ifError(result.error)
  assert.equal(result.rows.length,1)
  assert.equal(result.rows[0].body,'actual loaded body')
  assert.equal(result.rows[0].requestId,'script-1')
})

test('当前Script getResponseBody失败必须拒绝并在抛错前保存完整无秘密元数据',async t=>{
  const wire=protocolFixture(t),root=await mkdtemp('/dev/shm/a2d2-v4-cdp-meta-'),metadataPath=join(root,'capture.jsonl')
  const capture=await captureScriptResponses('ws://127.0.0.1/protocol-fixture',{metadataPath})
  t.after(()=>capture.close())
  wire.response('script-failed')
  const snapshot=capture.snapshot(origin)
  const rejected=assert.rejects(snapshot,/actual loaded Script response capture incomplete/)
  await nextTurn();wire.finish('script-failed');await nextTurn();wire.bodyError('script-failed')
  await rejected
  const metadata=JSON.parse((await readFile(metadataPath,'utf8')).trim().split('\n').at(-1))
  assert.equal(metadata.status,'failed');assert.equal(metadata.frame.id,'frame');assert.equal(metadata.frame.loaderId,'document')
  const row=metadata.scripts.find(row=>row.requestId==='script-failed')
  assert.equal(row.state,'failed');assert.equal(row.bodyError.code,-32000);assert.equal(row.bodyError.message,'No resource with given identifier found')
  assert.equal(row.frameId,'frame');assert.equal(row.loaderId,'document');assert.equal(row.resourceType,'Script')
  assert.equal(row.url,origin+'/plugins/??dsh-a2d2/client.js&rev=111111111111');assert.equal(Object.hasOwn(row,'body'),false)
  assert.equal((await stat(metadataPath)).mode&0o777,0o600)
})

test('未完成Script在原10000ms预算硬失败且保留pending证据',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']})
  const wire=protocolFixture(t),root=await mkdtemp('/dev/shm/a2d2-v4-cdp-meta-'),metadataPath=join(root,'capture.jsonl')
  const capture=await captureScriptResponses('ws://127.0.0.1/protocol-fixture',{metadataPath});t.after(()=>capture.close())
  wire.response('pending-target')
  const rejected=assert.rejects(capture.snapshot(origin),/pending beyond original budget/)
  await nextTurn();t.mock.timers.tick(10000);await rejected
  const metadata=JSON.parse((await readFile(metadataPath,'utf8')).trim())
  assert.equal(metadata.budgetMs,10000);assert.equal(metadata.status,'failed')
  assert.equal(metadata.scripts[0].requestId,'pending-target');assert.equal(metadata.scripts[0].pending,true)
})

test('等待中document漂移硬拒绝，失败target也不能被成功peer掩盖',async t=>{
  const wire=protocolFixture(t),capture=await captureScriptResponses('ws://127.0.0.1/protocol-fixture');t.after(()=>capture.close())
  wire.response('old-target')
  const drift=assert.rejects(capture.snapshot(origin),/document identity changed/)
  await nextTurn();wire.navigate('new-document');await drift
  wire.response('failed-target');wire.response('good-peer',{url:origin+'/assets/peer.js'})
  const failed=assert.rejects(capture.snapshot(origin),/capture incomplete/)
  await nextTurn();wire.finish('good-peer');wire.body('good-peer','peer');wire.fail('failed-target');await failed
})

test('成功也保存字节/flags而不落body、Cookie/header或token URL',async t=>{
  const wire=protocolFixture(t),root=await mkdtemp('/dev/shm/a2d2-v4-cdp-meta-'),metadataPath=join(root,'capture.jsonl')
  const capture=await captureScriptResponses('ws://127.0.0.1/protocol-fixture',{metadataPath});t.after(()=>capture.close())
  wire.navigate('document',origin+'/?token=fixture-secret')
  wire.response('script',{url:origin+'/assets/test.js?token=fixture-secret',headers:{'Content-Type':'text/javascript','Set-Cookie':'fixture-cookie'}})
  const snapshot=capture.snapshot(origin)
  await nextTurn();wire.finish('script');wire.body('script','PRIVATE BODY FIXTURE')
  await snapshot
  const text=await readFile(metadataPath,'utf8'),metadata=JSON.parse(text.trim())
  for(const secret of ['fixture-secret','fixture-cookie','PRIVATE BODY FIXTURE','Set-Cookie'])assert.equal(text.includes(secret),false)
  assert.equal(metadata.status,'complete');assert.equal(metadata.scripts[0].state,'complete')
  assert.equal(metadata.scripts[0].bodyBytes,20);assert.equal(metadata.scripts[0].servedFromCache,false)
  assert.equal(metadata.bufferLimits.maxTotalBufferSize,16777216)
})
