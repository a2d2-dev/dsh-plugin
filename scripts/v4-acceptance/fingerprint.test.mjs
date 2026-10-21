import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRelease, verifyImports } from './fingerprint.mjs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('宿主smoke之后动态入口内容变化必须在stop前拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-v4-fingerprint-'))
  const path = join(root, 'entry.mjs')
  await writeFile(path, 'hello')
  const imports = [{ name: 'accepted', path, ok: true, sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' }]
  await verifyImports(imports, root)
  await writeFile(path, 'changed')
  await assert.rejects(verifyImports(imports, root), /import/)
})

test('缺少可执行回滚宿主或宿主补丁证明时，切换前拒绝', () => {
  const manifest = { pluginCommit: 'b'.repeat(40), hostCommit: 'a'.repeat(40), artifacts: [{ role: 'plugin-tgz', sha256: 'c'.repeat(64) }] }
  assert.throws(() => validateRelease(manifest), /missing/)
  const roles = ['plugin-provenance', 'plugin-tgz', 'plugin-client', 'host-cli', 'host-web', 'host-jobs', 'host-session', 'host-smoke', 'rollback-cli', 'rollback-smoke']
  const complete = { ...manifest, hostRoot: '/isolated/new', rollbackHostRoot: '/isolated/old', artifacts: roles.map(role => ({ role, path: '/isolated/'+role, sha256: 'c'.repeat(64) })) }
  assert.doesNotThrow(() => validateRelease(complete))
  assert.throws(() => validateRelease({ ...complete, hostRoot: '/data/src/github.com/deepseek-ai/deepseek-harness-dev' }), /shared/)
  assert.throws(() => validateRelease({ ...complete, artifacts: complete.artifacts.map(a => ({ ...a, sha256: 'unknown' })) }), /sha256/)
})
