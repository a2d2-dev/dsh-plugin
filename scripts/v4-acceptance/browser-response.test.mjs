import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {captureScriptResponses} from './browser-response.mjs'

// Real offline Chrome/CDP via agent-browser: no HTTP server, no live origin, no route mocks.
test('真实data Script捕获保留loaded旧体；后续Fetch新体不能替换，下一document单独归因',async t=>{
  const root=await mkdtemp('/dev/shm/a2d2-v4-154-browser-'),session='a2d2-v4-offline-'+root.split('-').at(-1)
  const browser=(args,input)=>{
    const result=spawnSync('agent-browser',['--session',session,...args],{input,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024})
    assert.equal(result.status,0,'offline agent-browser command must succeed')
    return result.stdout
  }
  let capture
  t.after(()=>{capture?.close();browser(['close'])})
  browser(['open','about:blank'])
  capture=await captureScriptResponses(browser(['get','cdp-url']).trim())
  const old='globalThis.fixtureVersion="old";',fresh='globalThis.fixtureVersion="new";'
  const document=body=>'data:text/html,'+encodeURIComponent('<script src="data:text/javascript,'+encodeURIComponent(body)+'"></script>')
  browser(['open',document(old)])
  const first=await capture.snapshot('null')
  assert.equal(first.length,1);assert.equal(first[0].body,old)
  const fetched=JSON.parse(browser(['--json','eval','--stdin'],`fetch(${JSON.stringify('data:text/javascript,'+encodeURIComponent(fresh))}).then(r=>r.text())`))
  assert.equal(fetched.success,true);assert.equal(fetched.data.result,fresh)
  const afterFetch=await capture.snapshot('null')
  assert.equal(afterFetch.length,1);assert.equal(afterFetch[0].body,old)
  assert.equal(afterFetch[0].requestId,first[0].requestId)
  browser(['open',document(fresh)])
  const second=await capture.snapshot('null')
  assert.equal(second.length,1);assert.equal(second[0].body,fresh)
  assert.notEqual(second[0].loaderId,first[0].loaderId)
  t.diagnostic(JSON.stringify([...first,...second].map(({requestId,servedFromCache,fromDiskCache,fromServiceWorker,fromPrefetchCache})=>({requestId,servedFromCache,fromDiskCache,fromServiceWorker,fromPrefetchCache}))))
  for(const row of [...first,...second]){
    assert.equal(row.resourceType,'Script');assert.ok(row.requestId);assert.ok(row.loaderId);assert.ok(row.frameId)
    assert.equal(row.cacheDisabled,true);assert.equal(row.serviceWorkerBypassed,true)
    // Chrome emits requestServedFromCache for data: even with cacheDisabled acknowledged.
    // This is an offline protocol fixture, deliberately ineligible for HTTP live verification.
    assert.equal(row.servedFromCache,true);assert.equal(row.fromDiskCache,false);assert.equal(row.fromServiceWorker,false)
  }
  const summarize=row=>({requestId:row.requestId,loaderId:row.loaderId,frameId:row.frameId,bodySha256:createHash('sha256').update(row.body).digest('hex'),status:row.status,resourceType:row.resourceType,cacheDisabled:row.cacheDisabled,serviceWorkerBypassed:row.serviceWorkerBypassed})
  const proof={scope:'offline about:blank/data only; not live acceptance',oldLoaded:summarize(first[0]),freshLoaded:summarize(second[0]),refetchFreshDidNotReplaceLoadedBody:true}
  const path=join(root,'offline-cdp-proof.json');await writeFile(path,JSON.stringify(proof,null,2)+'\n',{mode:0o600})
  t.diagnostic(JSON.stringify({path,...proof}))
})
