import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join, dirname, basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import WorkspaceController from '@deepseek-ai/dsh-api-workspace-controller'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import * as guard from '../scripts/a2d2-v3-121/guard.mjs'

async function fixture(t, parent, prefix) {
  assert.equal(await realpath(parent), parent, 'fixture parent must already be canonical')
  const path = await mkdtemp(join(parent, prefix))
  const exact = resolve(parent, basename(path))
  assert.equal(path, exact)
  t.after(async () => {
    assert.equal(path, exact)
    assert.equal(dirname(path), parent)
    assert.ok(basename(path).startsWith(prefix))
    assert.equal(await realpath(path), exact, 'refuse cleanup of a replaced fixture root')
    await rm(exact, { recursive: true, force: true })
  })
  return path
}

async function namespaceFixture(t) {
  const namespace = '/tmp/a2d2-v3-121'
  assert.equal(await realpath('/tmp'), '/tmp')
  try { assert.equal(await realpath(namespace), namespace) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(namespace, { mode: 0o700 })
  }
  assert.equal(await realpath(namespace), namespace)
  return fixture(t, namespace, 'root-regression-')
}

test('prepare rejects a symlink escape before creating anything in the external fixture', async t => {
  const external = await fixture(t, '/tmp', 'a2d2-v3-121-external-fixture-')
  const inside = await namespaceFixture(t)
  await symlink(external, join(inside, 'link'), 'dir')
  await assert.rejects(() => prepare({ host: '/some/host', root: join(inside, 'link/new-root/nested'), hostOnly: true }), /symlink|canonical/)
  assert.deepEqual(await readdir(external), [], 'rejecting the root must leave no new external directories or files')
})

test('prepare rejects noncanonical and dangling/internal symlink roots without new children', async t => {
  const inside = await namespaceFixture(t)
  const target = join(inside, 'target')
  await mkdir(target)
  await symlink(target, join(inside, 'alias'), 'dir')
  await symlink(join(inside, 'absent'), join(inside, 'dangling'), 'dir')
  for (const root of [`${inside}/./new-root`, `${inside}//new-root`, `${inside}/new-root/`, join(inside, 'alias/new-root'), join(inside, 'dangling/new-root')]) {
    await assert.rejects(() => prepare({ host: '/some/host', root, hostOnly: true }), /canonical|symlink/)
  }
  assert.deepEqual(await readdir(target), [])
  assert.deepEqual((await readdir(inside)).sort(), ['alias', 'dangling', 'target'])
})

test('prepare completes for a brand-new canonical root using a test-owned host layout fixture', async t => {
  const inside = await namespaceFixture(t)
  const host = join(inside, 'host-fixture')
  const write = async (relative, text) => {
    const path = join(host, relative)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  await write('apps/cli/lib/bin.js', "console.log('fixture-cli')\n")
  await write('packages/bundle/web-app/package.json', '{}')
  await write('packages/bundle/base/package.json', '{}')
  for (const name of ['dsh-llm', 'dsh-api-session-controller', 'dsh-api-workspace-controller', 'dsh-client-modules']) {
    await write(`node_modules/@deepseek-ai/${name}/package.json`, '{"main":"index.js"}')
    await write(`node_modules/@deepseek-ai/${name}/index.js`, 'module.exports = {}\n')
  }
  // Only this test-owned layout fixture gets an empty Git identity; no user checkout.
  for (const args of [['init', '-q', host], ['-C', host, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--allow-empty', '-qm', 'fixture']]) {
    const result = spawnSync('git', args, { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  const root = join(inside, 'brand-new/nested-run')
  const manifest = await prepare({ host, root, hostOnly: true })
  assert.equal(manifest.root, root)
  assert.equal(manifest.cliVersion, 'fixture-cli')
  assert.equal(await realpath(root), root)
  assert.deepEqual((await readdir(root)).sort(), ['acceptance.patch.yml', 'browser-profile', 'config', 'evidence', 'guard', 'home', 'ipc', 'logs', 'manifest.json', 'state', 'workspace'])
})

test('real host counts both model boundaries and turns the disabled adapter throw into finish error', { skip: !process.env.A2D2_ACCEPTANCE_POSITIVE_ROOT }, async () => {
  const result = await request(process.env.A2D2_ACCEPTANCE_POSITIVE_ROOT, 'positive')
  assert.equal(result.before.gateway, 0)
  assert.equal(result.before.adapter, 0)
  assert.equal(result.after.gateway, 1)
  assert.equal(result.after.adapter, 1)
  assert.equal(result.finish.reason.kind, 'error')
  assert.equal(result.finish.reason.failure.message, 'A2D2_ACCEPTANCE_MODEL_DISABLED')
})

test('fresh real host has real Session configuration and no model invocation', { skip: !process.env.A2D2_ACCEPTANCE_ZERO_ROOT }, async () => {
  const result = await request(process.env.A2D2_ACCEPTANCE_ZERO_ROOT, 'snapshot')
  assert.deepEqual(result.providers, ['acceptance-disabled'])
  assert.equal(result.gateway, 0)
  assert.equal(result.adapter, 0)
  assert.ok(result.sessions.length > 0)
  assert.equal(result.sessions[0].model.default.provider, 'acceptance-disabled')
  assert.equal(result.sessions[0].model.default.model, 'no-model')
  assert.equal(result.sessions[0].permissions.sandbox.mode, 'workspace-write')
  assert.equal(result.sessions[0].permissions.approval, 'ask')
})
test('guard seed passes the public Workspace identity and creates a real Session in the selected resource cwd', async t => {
  const ctx = new Context()
  // Register disposal before the fixture cleanup, including the IPC timer.
  t.after(async () => { await ctx.fiber.dispose() })
  const root = await namespaceFixture(t)
  for (const name of ['workspace', 'evidence', 'ipc']) await mkdir(join(root, name))
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  class Query extends SessionQuery {
    async searchSessions() { throw Error('search is outside seed acceptance') }
    async searchEvents() { throw Error('search is outside seed acceptance') }
  }
  await ctx.plugin(Query)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: join(root, 'workspace') })
  // Only unrelated RPC plumbing and unused capabilities are controlled. Both
  // controllers, the registry, Agent/Session creation and persistence are real.
  ctx.provide('typert', { lookups: { configure: () => () => {} }, contexts: { configureHost: () => () => {} } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'acceptance-disabled', model: 'no-model' }) })
  ctx.provide('fileUploads', { registerAgentResolver: () => () => {} })
  ctx.provide('attachments', { imageLimits: {} })
  for (const name of ['sandboxPolicy', 'permissionPresets', 'approval']) ctx.provide(name, {})
  new WorkspaceController(ctx, { documentsDirectory: join(root, 'workspace') })
  new SessionController(ctx, { nativeOpen: false })
  const selected = (await ctx.workspaceController.create({ path: join(root, 'workspace') })).workspace
  assert.equal(typeof selected.workspaceId, 'string')
  assert.equal(selected.id, undefined, 'the public Workspace projection has no id field')
  const calls = []
  const create = ctx.sessionController.create.bind(ctx.sessionController)
  ctx.sessionController.create = async request => { calls.push(request); return create(request) }
  await ctx.plugin(guard, { root, llm: fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-llm')) }).await()
  const seeded = await request(root, 'seed')
  const live = ctx.sessions.get(seeded.sessionId)
  assert.ok(live, 'seed must create an actual live Session')
  assert.equal(live.header.cwd, selected.path, 'Session cwd must match the selected resource, not the process default')
  assert.equal((await ctx.sessionController.inspect(seeded.sessionId)).meta.cwd, selected.path)
  assert.deepEqual(calls, [{ workspaceId: selected.workspaceId }])
  assert.equal(seeded.workspaceId, selected.workspaceId)
  assert.ok(ctx.workspaceRegistry.get(selected.workspaceId).sessionIds.includes(seeded.sessionId))
  const rows = (await readFile(join(root, 'evidence/metrics.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(rows.filter(row => ['gateway', 'adapter'].includes(row.kind)).length, 0)
})

import { isolatedEnvironment, assertUnchanged, prepare, request } from '../scripts/a2d2-v3-121/acceptance.mjs'

test('prepare refuses a relative host and any root outside the ticket temporary namespace', async () => {
  await assert.rejects(() => prepare({ host: '.', root: '/tmp/a2d2-v3-121/test', hostOnly: true }), /absolute/)
  await assert.rejects(() => prepare({ host: '/some/host', root: '/tmp/elsewhere', hostOnly: true }), /namespace/)
})

test('isolated launch environment does not inherit credentials or HOME', () => {
  const env = isolatedEnvironment('/tmp/a2d2-v3-121/test', { PATH: '/bin', HOME: '/root', OPENAI_API_KEY: 'secret', DSH_HOME: '/real' })
  assert.deepEqual(env, { PATH: '/bin', DSH_HOME: '/tmp/a2d2-v3-121/test/home', XDG_CONFIG_HOME: '/tmp/a2d2-v3-121/test/config', XDG_STATE_HOME: '/tmp/a2d2-v3-121/test/state', DSH_TELEMETRY_DISABLED: '1' })
})

test('acceptance rejects replaced Session identities, configuration drift and any model call', () => {
  const baseline = { sessions: [{ sessionId: 'a', cwd: '/tmp/work', model: { provider: 'acceptance-disabled', model: 'no-model' }, permissions: { mode: 'workspace-write' } }], births: 1 }
  const clean = { ...baseline, gateway: 0, adapter: 0 }
  assert.doesNotThrow(() => assertUnchanged(baseline, clean))
  assert.throws(() => assertUnchanged(baseline, { ...clean, sessions: [{ ...baseline.sessions[0], sessionId: 'b' }] }), /Session/)
  assert.throws(() => assertUnchanged(baseline, { ...clean, sessions: [{ ...baseline.sessions[0], cwd: '/elsewhere' }] }), /Session/)
  assert.throws(() => assertUnchanged(baseline, { ...clean, gateway: 1 }), /model/)
  assert.throws(() => assertUnchanged(baseline, { ...clean, adapter: 1 }), /model/)
  assert.throws(() => assertUnchanged(baseline, { ...clean, births: 2 }), /birth/)
  const first = { ...baseline, processId: 'first' }
  const reloaded = { ...clean, processId: 'second', births: 2, bornSessionIds: ['a', 'a'] }
  assert.doesNotThrow(() => assertUnchanged(first, reloaded))
  assert.throws(() => assertUnchanged(first, { ...reloaded, bornSessionIds: ['a', 'unknown'] }), /birth/)
})
