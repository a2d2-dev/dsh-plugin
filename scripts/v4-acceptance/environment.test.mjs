import test from 'node:test'
import assert from 'node:assert/strict'
import { environmentPolicyFor } from './prepare-plan.mjs'
import { approvedServiceEnvironment } from './managed-launcher.mjs'
import { createHash } from 'node:crypto'

const hash=value=>createHash('sha256').update(value).digest('hex')
test('候选环境只保留稳定引用和安全覆盖，凭据值不能进入plan或artifact',()=>{
  const secret='fixture-private-service-secret',inherited='fixture-inherited-token'
  const policy=environmentPolicyFor({DEEPSEEK_API_KEY:secret,PROVIDER_TOKEN:inherited,DSH_HOME:'/data/_dsh-dev',NODE_OPTIONS:'--max-old-space-size=4096'},{PROVIDER_TOKEN:hash(inherited)},false)
  assert.equal(JSON.stringify(policy).includes(secret),false)
  assert.equal(JSON.stringify(policy).includes(inherited),false)
  assert.deepEqual(policy.serviceEnvironment,{path:'/data/_dsh-dev/service-env.json',keys:['DEEPSEEK_API_KEY']})
  assert.deepEqual(policy.inherit,['PROVIDER_TOKEN'])
  assert.throws(()=>environmentPolicyFor({OTHER_SECRET:secret},{},false),/stable reference/)
  assert.deepEqual(approvedServiceEnvironment({DEEPSEEK_API_KEY:secret}),{DEEPSEEK_API_KEY:secret})
  assert.throws(()=>approvedServiceEnvironment({DEEPSEEK_API_KEY:secret,PATH:'/unexpected'}),/approved/)
})
