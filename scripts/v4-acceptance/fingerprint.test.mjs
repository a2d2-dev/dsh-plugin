import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRelease } from './fingerprint.mjs'

test('缺少可执行回滚宿主或宿主补丁证明时，切换前拒绝', () => {
  const manifest = { pluginCommit: 'b'.repeat(40), hostCommit: 'a'.repeat(40), artifacts: [{ role: 'plugin-tgz', sha256: 'c'.repeat(64) }] }
  assert.throws(() => validateRelease(manifest), /missing/)
  const roles = ['plugin-tgz', 'plugin-client', 'host-cli', 'host-web', 'host-jobs', 'host-session', 'host-smoke', 'rollback-cli', 'rollback-smoke']
  const complete = { ...manifest, hostRoot: '/isolated/new', rollbackHostRoot: '/isolated/old', artifacts: roles.map(role => ({ role, path: '/isolated/'+role, sha256: 'c'.repeat(64) })) }
  assert.doesNotThrow(() => validateRelease(complete))
  assert.throws(() => validateRelease({ ...complete, hostRoot: '/data/src/github.com/deepseek-ai/deepseek-harness-dev' }), /shared/)
  assert.throws(() => validateRelease({ ...complete, artifacts: complete.artifacts.map(a => ({ ...a, sha256: 'unknown' })) }), /sha256/)
})
