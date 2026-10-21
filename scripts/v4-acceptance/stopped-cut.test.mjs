import test from 'node:test'
import assert from 'node:assert/strict'
import { validateJournal, assessStop } from './stopped-cut.mjs'
import { digest } from './live-cut.mjs'

test('停后必须保留已接受事件前缀，拒绝缺行和撕裂journal',()=>{
  const event={type:'user/message',seq:0,time:1,data:{id:'accepted',text:'keep decision'}}
  const accepted={id:'session-old',cwd:'/work',throughSeq:0,eventHashes:[digest(event)]}
  const header={type:'session',id:'session-old',cwd:'/work'}
  const text=JSON.stringify(header)+'\n'+JSON.stringify(event)+'\n'
  assert.equal(validateJournal(text,accepted).ok,true)
  assert.throws(()=>validateJournal(JSON.stringify(header)+'\n',accepted),/accepted/)
  assert.throws(()=>validateJournal(text.slice(0,-1),accepted),/torn/)
})
test('CLI私有日志明确disposer error时即使exit0且静态完整也拒新',()=>{
  assert.throws(()=>assessStop({exit:{code:0,signal:null,forced:false,stopElapsedMs:100,cliLog:{classification:'error',attributable:true}},staticCut:{ok:true},parentReviewedStaticCut:true}),/CLI shutdown log/)
})

test('STOPPED/exit0不能冒充flush；强退拒绝切新，只保留可运行回滚路径',()=>{
  assert.throws(()=>assessStop({exit:{code:0},staticCut:{ok:false}}),/durability/)
  assert.throws(()=>assessStop({exit:{code:0,signal:'SIGKILL'},staticCut:{ok:true},parentReviewedStaticCut:true}),/forced/)
  assert.throws(()=>assessStop({exit:{code:0},staticCut:{ok:true}}),/reviewed/)
  const result=assessStop({exit:{code:0,signal:null,forced:false},staticCut:{ok:true},parentReviewedStaticCut:true})
  assert.equal(result.gracefulAcknowledged,false)
  assert.equal(result.barrier,'accepted-prefix-and-static-integrity')
})
