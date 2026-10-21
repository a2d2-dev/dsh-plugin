import test from 'node:test'
import assert from 'node:assert/strict'
import { permitsSystemGenesis } from './data-genesis.mjs'

test('phase1升级只允许明确的新runtime创生，已有身份不能借创生规则漂移',()=>{
  const path='/data/_dsh-dev/a2d2/work-v3/runtime-v1.json',allowed=[{path,kind:'work-runtime-v1'}]
  const value={schemaVersion:1,runtimeId:'123e4567-e89b-42d3-a456-426614174000'}
  assert.equal(permitsSystemGenesis(path,false,value,allowed),true)
  assert.equal(permitsSystemGenesis(path,true,value,allowed),false)
  assert.equal(permitsSystemGenesis(path,false,{...value,extra:'unapproved'},allowed),false)
  assert.equal(permitsSystemGenesis(path,false,value,[]),false)
})
