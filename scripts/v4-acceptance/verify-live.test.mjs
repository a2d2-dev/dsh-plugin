import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {verifyBrowserClients} from './verify-live.mjs'

const origin='http://10.126.126.12:18782'
const sha=value=>createHash('sha256').update(value).digest('hex')
const client='window.__ModuleLoader__.load({id:"dsh-a2d2",factory:()=>"new"});\n//# sourceMappingURL=client.js.map\n//# sourceURL=original.js\n'
const targetUrl=origin+'/plugins/??dsh-a2d2/client.js&rev=111111111111'
const targetBody='window.__ModuleLoader__.load({id:"dsh-a2d2",factory:()=>"new"});\n;\n//# sourceMappingURL=??dsh-a2d2/client.js.map&rev=111111111111\n'
const row=(url,body)=>({url,status:200,contentType:'text/javascript; charset=utf-8',body})
const target=row(targetUrl,targetBody)
const options={origin,client,clientSha256:sha(client),payloads:[target],modules:[target]}

test('browser收到旧JS即使磁盘client正确也必须拒绝',()=>{
  const old=row(targetUrl,targetBody.replace('"new"','"old"'))
  assert.throws(()=>verifyBrowserClients({...options,payloads:[old],modules:[old]}),/selected client/)
})

test('正式Host变换接受new/rollback且raw响应SHA不同',()=>{
  for(const version of ['new','rollback']){
    const disk=client.replace('"new"',JSON.stringify(version)),wire=targetBody.replace('"new"',JSON.stringify(version)),payload=row(targetUrl,wire)
    const result=verifyBrowserClients({...options,client:disk,clientSha256:sha(disk),payloads:[payload],modules:[payload]})
    assert.equal(result[0].clientSha256,sha(disk))
    assert.notEqual(result[0].sha256,sha(disk))
  }
})

test('多模块combo按URI顺序绑定；新singleton不能掩盖旧combo',()=>{
  const peer=row(origin+'/plugins/??peer/client.js&rev=222222222222','peer();\n;\n//# sourceMappingURL=??peer/client.js.map&rev=222222222222\n')
  const loaded=row(origin+'/plugins/??peer/client.js,dsh-a2d2/client.js&rev=333333333333','peer();\n;\nwindow.__ModuleLoader__.load({id:"dsh-a2d2",factory:()=>"new"});\n;\n//# sourceMappingURL=??peer/client.js.map,dsh-a2d2/client.js.map&rev=333333333333\n')
  assert.equal(verifyBrowserClients({...options,payloads:[loaded],modules:[peer,target]}).length,1)
  assert.throws(()=>verifyBrowserClients({...options,payloads:[{...loaded,body:loaded.body.replace('"new"','"old"')}],modules:[peer,target]}),/loaded browser combo/)
  assert.throws(()=>verifyBrowserClients({...options,payloads:[{...loaded,url:loaded.url.replace('peer/client.js,dsh-a2d2','dsh-a2d2/client.js,peer')}],modules:[peer,target]}),/trailer mismatch/)
})

test('错误module、缺失module、跨origin及非成功JS响应拒绝',()=>{
  const wrong=row(targetUrl.replace('dsh-a2d2','wrong'),targetBody.replaceAll('dsh-a2d2','wrong'))
  assert.throws(()=>verifyBrowserClients({...options,payloads:[wrong],modules:[wrong]}),/selected client module/)
  assert.throws(()=>verifyBrowserClients({...options,modules:[]}),/selected client module/)
  for(const change of [{status:500},{contentType:'text/html'},{url:targetUrl.replace(origin,'http://other.invalid')},{body:targetBody.replace('"new"','"wrong"')}]){
    assert.throws(()=>verifyBrowserClients({...options,payloads:[{...target,...change}],modules:[{...target,...change}]}))
  }
})
