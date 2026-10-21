import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {verifyBrowserClients} from './verify-live.mjs'

const origin='http://10.126.126.12:18782'
const sha=value=>createHash('sha256').update(value).digest('hex')
const client='window.__ModuleLoader__.load({id:"dsh-a2d2",factory:()=>"new"});\n//# sourceMappingURL=client.js.map\n//# sourceURL=original.js\n'
const targetUrl=origin+'/plugins/??dsh-a2d2/client.js&rev=111111111111'
const targetBody='window.__ModuleLoader__.load({id:"dsh-a2d2",factory:()=>"new"});\n;\n//# sourceMappingURL=??dsh-a2d2/client.js.map&rev=111111111111\n'
const row=(url,body)=>({url,status:200,contentType:'text/javascript; charset=utf-8',body,source:'cdp-network-script-response',resourceType:'Script',requestId:sha(url),loaderId:'document-1',frameId:'frame-1',cacheDisabled:true,serviceWorkerBypassed:true,servedFromCache:false,fromDiskCache:false,fromServiceWorker:false,fromPrefetchCache:false})
const target=row(targetUrl,targetBody)
const options={origin,client,clientSha256:sha(client),loadedPayloads:[target],modules:[target]}

test('loaded旧响应不能被同URL refetch新响应掩盖',()=>{
  const old=row(targetUrl,targetBody.replace('"new"','"old"'))
  assert.throws(()=>verifyBrowserClients({...options,payloads:[target],loadedPayloads:[old]}),/loaded browser combo/)
})

test('browser收到旧JS即使磁盘client正确也必须拒绝',()=>{
  const old=row(targetUrl,targetBody.replace('"new"','"old"'))
  assert.throws(()=>verifyBrowserClients({...options,loadedPayloads:[old],modules:[old]}),/selected client/)
})

test('正式Host变换接受new/rollback且raw响应SHA不同',()=>{
  for(const version of ['new','rollback']){
    const disk=client.replace('"new"',JSON.stringify(version)),wire=targetBody.replace('"new"',JSON.stringify(version)),payload=row(targetUrl,wire)
    const result=verifyBrowserClients({...options,client:disk,clientSha256:sha(disk),loadedPayloads:[payload],modules:[payload]})
    assert.equal(result[0].clientSha256,sha(disk))
    assert.notEqual(result[0].sha256,sha(disk))
  }
})

test('多模块combo按URI顺序绑定；新singleton不能掩盖旧combo',()=>{
  const peer=row(origin+'/plugins/??peer/client.js&rev=222222222222','peer();\n;\n//# sourceMappingURL=??peer/client.js.map&rev=222222222222\n')
  const loaded=row(origin+'/plugins/??peer/client.js,dsh-a2d2/client.js&rev=333333333333','peer();\n;\nwindow.__ModuleLoader__.load({id:"dsh-a2d2",factory:()=>"new"});\n;\n//# sourceMappingURL=??peer/client.js.map,dsh-a2d2/client.js.map&rev=333333333333\n')
  assert.equal(verifyBrowserClients({...options,loadedPayloads:[loaded],modules:[peer,target]}).length,1)
  assert.throws(()=>verifyBrowserClients({...options,loadedPayloads:[{...loaded,body:loaded.body.replace('"new"','"old"')}],modules:[peer,target]}),/loaded browser combo/)
  assert.throws(()=>verifyBrowserClients({...options,loadedPayloads:[{...loaded,url:loaded.url.replace('peer/client.js,dsh-a2d2','dsh-a2d2/client.js,peer')}],modules:[peer,target]}),/trailer mismatch/)
})

test('实际Script身份与禁缓存证明缺失或来自cache/SW/Fetch必须拒绝',()=>{
  for(const change of [{source:'refetch'},{resourceType:'Fetch'},{requestId:''},{loaderId:''},{frameId:''},{cacheDisabled:false},{serviceWorkerBypassed:false},{servedFromCache:true},{fromDiskCache:true},{fromServiceWorker:true},{fromPrefetchCache:true}]){
    assert.throws(()=>verifyBrowserClients({...options,loadedPayloads:[{...target,...change}]}),/actual loaded Script/)
  }
  assert.throws(()=>verifyBrowserClients({...options,loadedPayloads:undefined,payloads:[target]}),/resource missing/)
  const secondUrl=targetUrl.replace('111111111111','444444444444')
  const second=row(secondUrl,targetBody.replaceAll('111111111111','444444444444'))
  assert.equal(verifyBrowserClients({...options,loadedPayloads:[target,second]}).length,2)
  assert.throws(()=>verifyBrowserClients({...options,loadedPayloads:[target,{...second,loaderId:'other-document'}]}),/document\/request identity/)
})

test('错误module、缺失module、跨origin及非成功JS响应拒绝',()=>{
  const wrong=row(targetUrl.replace('dsh-a2d2','wrong'),targetBody.replaceAll('dsh-a2d2','wrong'))
  assert.throws(()=>verifyBrowserClients({...options,loadedPayloads:[wrong],modules:[wrong]}),/selected client module/)
  assert.throws(()=>verifyBrowserClients({...options,modules:[]}),/selected client module/)
  for(const change of [{status:500},{contentType:'text/html'},{url:targetUrl.replace(origin,'http://other.invalid')},{body:targetBody.replace('"new"','"wrong"')}]){
    assert.throws(()=>verifyBrowserClients({...options,loadedPayloads:[{...target,...change}],modules:[{...target,...change}]}))
  }
})
