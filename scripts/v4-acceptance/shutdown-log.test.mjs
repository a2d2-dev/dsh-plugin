import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,open,writeFile,readFile,rename,stat} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {beginShutdownLog,finishShutdownLog} from './shutdown-log.mjs'
import {assessStop} from './stopped-cut.mjs'

async function fixture(t,initial='previous log\n'){
  const root=await mkdtemp('/dev/shm/a2d2-v4-154-log-'),path=join(root,'cli.private.log')
  await writeFile(path,initial,{mode:0o600})
  const writer=await open(path,'a');t.after(()=>writer.close())
  const bound=await beginShutdownLog(path,process.pid);t.after(()=>bound.handle.close())
  return {root,path,writer,bound,finish:()=>finishShutdownLog(bound,root)}
}
const assess=cliLog=>assessStop({exit:{source:'original-launcher-child-exit',code:0,signal:null,forced:false,stopElapsedMs:100,cliLog},staticCut:{ok:true},parentReviewedStaticCut:true})

test('真实CLI写明确error但exit0；私有窗口保留且静态完整也只可回滚',async t=>{
  const f=await fixture(t)
  const result=spawnSync(process.execPath,['-e','process.stderr.write("\\u001b[31m[E] cordis Error: disposer failed SECRET-FIXTURE\\u001b[0m\\n")'],{stdio:['ignore',f.writer.fd,f.writer.fd]})
  assert.equal(result.status,0)
  const proof=await f.finish()
  assert.equal(proof.classification,'error');assert.equal(proof.attributable,true)
  assert.throws(()=>assess(proof),/CLI shutdown log/)
  const raw=await readFile(proof.rawPath)
  assert.match(raw.toString(),/SECRET-FIXTURE/)
  assert.equal(proof.windowSha256,createHash('sha256').update(raw).digest('hex'))
  assert.equal((await stat(proof.rawPath)).mode&0o777,0o600)
  assert.equal(JSON.stringify(proof).includes('SECRET-FIXTURE'),false)
})

test('只分类本次窗口；正常/空日志不依赖不存在的正式marker',async t=>{
  for(const tail of ['[I] web listener closed\n','']){
    const f=await fixture(t,'[E] historical unrelated failure\n')
    await f.writer.write(tail)
    const proof=await f.finish()
    assert.equal(proof.classification,'no-known-error');assert.equal(proof.attributable,true)
    assert.equal(assess(proof).gracefulAcknowledged,false)
  }
})

test('替换、截断、截断后长回原大小及半行都不能声称无错误',async t=>{
  for(const drift of ['replace','truncate','regrow','partial']){
    const f=await fixture(t)
    if(drift==='replace'){
      // Both exact fixture paths are siblings under this test's unique tmpfs root.
      assert.equal(f.path,join(f.root,'cli.private.log'))
      await rename(f.path,join(f.root,'old.private.log'));await writeFile(f.path,'replacement\n')
      await f.writer.write('[E] old inode disposer failed\n')
    }else if(drift==='truncate')await f.writer.truncate(0)
    else if(drift==='regrow')await writeFile(f.path,'changed prior prefix plus regrowth\n')
    else await f.writer.write('[I] partial')
    const proof=await f.finish()
    assert.equal(proof.attributable,false,drift)
    assert.throws(()=>assess(proof),/CLI shutdown log/)
    if(drift==='replace')assert.match((await readFile(proof.rawPath)).toString(),/old inode disposer failed/)
  }
})

test('归因未知、缺证、已知强退与窗口超预算均拒新',async t=>{
  const f=await fixture(t)
  await f.writer.write('shutdown timeout: forceExit\n')
  const proof=await f.finish()
  assert.equal(proof.classification,'known-forced');assert.throws(()=>assess(proof),/CLI shutdown log/)
  assert.throws(()=>assess(undefined),/evidence missing/)
  assert.throws(()=>assess({classification:'no-known-error',attributable:false}),/CLI shutdown log/)
  const large=await fixture(t);await large.writer.write('x'.repeat(1024*1024+1)+'\n')
  const over=await large.finish();assert.equal(over.attributable,false);assert.equal(over.reason,'log-window-over-budget')
  assert.throws(()=>assess(over),/CLI shutdown log/)
})

test('信号前日志边界不完整或无launcher append fd时拒绝绑定',async t=>{
  const root=await mkdtemp('/dev/shm/a2d2-v4-154-log-'),path=join(root,'cli.private.log')
  await writeFile(path,'partial',{mode:0o600})
  const writer=await open(path,'a');t.after(()=>writer.close())
  await assert.rejects(beginShutdownLog(path,process.pid),/boundary is incomplete/)
  const other=join(root,'other.private.log');await writeFile(other,'normal\n',{mode:0o600})
  await assert.rejects(beginShutdownLog(other,process.pid),/does not hold/)
})
