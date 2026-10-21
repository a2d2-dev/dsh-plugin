import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprintTree, replaceProfile } from './profile-actions.mjs'

test('离线profile切换拒绝原配置漂移，成功切换保留旧profile与外部Session数据', async () => {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-v4-switch-'))
  const target = join(root, 'web'), staged = join(root, 'staged'), backup = join(root, 'web.previous')
  await mkdir(target); await mkdir(staged)
  await writeFile(join(target, 'package.json'), '{"version":"old"}')
  await writeFile(join(staged, 'package.json'), '{"version":"new"}')
  await writeFile(join(root, 'session.private'), 'existing decision')
  const before = await fingerprintTree(target)
  await writeFile(join(target, 'package.json'), '{"version":"drift"}')
  await assert.rejects(replaceProfile({ target, staged, backup, expected: before }), /changed/)
  await assert.rejects(access(backup))
  assert.equal(await readFile(join(target, 'package.json'), 'utf8'), '{"version":"drift"}')
  const reviewed = await fingerprintTree(target)
  await replaceProfile({ target, staged, backup, expected: reviewed })
  assert.equal(await readFile(join(target, 'package.json'), 'utf8'), '{"version":"new"}')
  assert.equal(await readFile(join(backup, 'package.json'), 'utf8'), '{"version":"drift"}')
  assert.equal(await readFile(join(root, 'session.private'), 'utf8'), 'existing decision')
})
