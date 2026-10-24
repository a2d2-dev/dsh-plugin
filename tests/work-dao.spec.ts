import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import * as syncFs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import * as atomic from '@deepseek-ai/dsh-atomic-write'
import { WorkDao } from '../src/work-store/dao.ts'
import { commandSchema } from '../src/work-schema.ts'
import type { WorkExecution } from '../src/work-types.ts'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkApplication } from '../src/work.ts'

vi.mock('node:fs/promises', { spy: true })
vi.mock('node:fs', { spy: true })
vi.mock('@deepseek-ai/dsh-atomic-write', { spy: true })
const roots: string[] = []
const host = { resources: async () => [], sessions: async () => [] }
const actor = { operator: true }
afterEach(async () => { vi.restoreAllMocks(); vi.clearAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function open() {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-dao-')); roots.push(directory)
  return { directory, app: new WorkApplication(directory, host) }
}
it('shares one committed read across application instances and concurrent cold queries', async () => {
  const { directory, app } = await open()
  await app.execute({ type: 'project.create', commandId: 'seed', name: 'Original' }, actor)
  const reads = vi.mocked(fs.readFile); reads.mockClear()
  const apps = Array.from({ length: 12 }, () => new WorkApplication(directory, host))
  await Promise.all(apps.map(app => app.query({ type: 'projects.list' }, actor)))
  expect(reads.mock.calls.filter(([file]) => file === join(directory, 'work-v3.json')).length).toBeLessThanOrEqual(1)
})
it.each(['unknown-version', 'valid-update'] as const)('preserves a same-size in-place %s when filesystem timestamps collide', async change => {
  const { directory, app } = await open(), file = join(directory, 'work-v3.json')
  const originalFs = await vi.importActual<typeof fs>('node:fs/promises')
  // Some filesystems report the same timestamps for several same-inode writes.
  // Keep real file I/O and identity; pin only that external clock resolution.
  vi.mocked(fs.stat).mockImplementation((async (...args: Parameters<typeof fs.stat>) => {
    const info = await originalFs.stat(...args)
    return args[0] === file ? Object.assign(info, { mtimeNs: 0n, ctimeNs: 0n }) : info
  }) as typeof fs.stat)
  await app.execute({ type: 'project.create', commandId: 'seed', name: 'Original' }, actor)
  const before = await readFile(file, 'utf8')
  const updated = change === 'unknown-version' ? before.replace('"schemaVersion":3', '"schemaVersion":9') : before.replace('"name":"Original"', '"name":"External"')
  expect(updated).not.toBe(before)
  expect(Buffer.byteLength(updated)).toBe(Buffer.byteLength(before))
  const identity = await fs.stat(file, { bigint: true })
  await fs.writeFile(file, updated)
  expect(await fs.stat(file, { bigint: true })).toMatchObject({ dev: identity.dev, ino: identity.ino, size: identity.size, mtimeNs: identity.mtimeNs, ctimeNs: identity.ctimeNs })
  const command = { type: 'project.create', commandId: 'after-external-write', name: 'Additional' }
  if (change === 'unknown-version') {
    await expect(app.query({ type: 'projects.list' }, actor)).rejects.toThrow()
    await expect(app.execute(command, actor)).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe(updated)
  } else {
    // The command itself must reload; no preceding query may refresh the cache.
    expect(await app.execute(command, actor)).toMatchObject({ status: 'completed' })
    expect(await app.query({ type: 'projects.list' }, actor)).toMatchObject({ projects: [{ name: 'External' }, { name: 'Additional' }] })
  }
})

it('does not let a returned query object change the committed read snapshot', async () => {
  const { app } = await open()
  await app.execute({ type: 'project.create', commandId: 'seed', name: 'Original' }, actor)
  const first = await app.query({ type: 'projects.list' }, actor)
  if (first.status !== 'completed' || !first.projects) throw new Error('Expected projects')
  try { first.projects[0]!.name = 'Uncommitted' } catch { /* Immutable snapshots reject mutation. */ }
  expect(await app.query({ type: 'projects.list' }, actor)).toMatchObject({ projects: [{ name: 'Original' }] })
})

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
it('publishes only after the control commit and isolates rollback, notifications and command retries', async () => {
  const { directory, app } = await open()
  await app.execute({ type: 'project.create', commandId: 'seed', name: 'Original' }, actor)
  const original = await vi.importActual<typeof atomic>('@deepseek-ai/dsh-atomic-write')
  const file = join(directory, 'work-v3.json'), before = await readFile(file, 'utf8')
  const entered = deferred(), release = deferred(), changed = vi.fn()
  const unsubscribe = app.onChange(changed)
  vi.mocked(atomic.writeFileAtomic).mockImplementation(async (...args) => {
    if (args[0] === file) { entered.resolve(); await release.promise; throw new Error('injected control rename failure') }
    return original.writeFileAtomic(...args)
  })
  const command = { type: 'project.create', commandId: 'retry', name: 'Committed later' }
  const failed = app.execute(command, actor)
  const rejected = expect(failed).rejects.toThrow('injected control rename failure')
  await entered.promise
  try {
    expect(await new WorkApplication(directory, host).query({ type: 'projects.list' }, actor)).toMatchObject({ projects: [{ name: 'Original' }] })
  } finally { release.resolve() }
  await rejected
  expect(await readFile(file, 'utf8')).toBe(before)
  expect(changed).not.toHaveBeenCalled()
  vi.mocked(atomic.writeFileAtomic).mockImplementation(original.writeFileAtomic)
  const result = await app.execute(command, actor)
  expect(result.status).toBe('completed')
  expect(changed).toHaveBeenCalledTimes(1)
  expect(await new WorkApplication(directory, host).execute(command, actor)).toEqual(result)
  expect(changed).toHaveBeenCalledTimes(1)
  unsubscribe()
})

it('detects a commit from another process and reloads only the changed control revision', async () => {
  const { directory, app } = await open()
  await app.execute({ type: 'project.create', commandId: 'seed', name: 'Original' }, actor)
  const changed = vi.fn(), stop = app.onChange(changed)
  await runNode(`
    import { readFile } from 'node:fs/promises';
    import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
    const file = process.argv[1];
    await withFileLock(file, async () => { const state = JSON.parse(await readFile(file, 'utf8')); state.projects[0].name = 'External'; state.projects[0].version++; await writeFileAtomic(file, JSON.stringify(state), { mode: 0o600, dirMode: 0o700 }); });
  `, join(directory, 'work-v3.json'))
  const reads = vi.mocked(fs.readFile); reads.mockClear()
  const results = await Promise.all(Array.from({ length: 8 }, () => app.query({ type: 'projects.list' }, actor)))
  expect(results.every(result => result.status === 'completed' && result.projects?.[0]?.name === 'External')).toBe(true)
  expect(reads.mock.calls.filter(([file]) => file === join(directory, 'work-v3.json'))).toHaveLength(1)
  expect(changed).toHaveBeenCalledTimes(1)
  stop()
})

it('keeps live writes from separate processes serialized without losing either update', async () => {
  const { directory, app } = await open()
  await app.execute({ type: 'project.create', commandId: 'seed', name: 'Original' }, actor)
  const module = pathToFileURL(resolve('src/work-store/dao.ts')).href
  const script = `import { WorkDao } from ${JSON.stringify(module)};
    await WorkDao.forDirectory(process.argv[1]).transaction(async state => { const name = state.projects[0].name; await new Promise(resolve => setTimeout(resolve, 80)); state.projects[0].name = name + process.argv[2]; state.projects[0].version++; });`
  await Promise.all([runNode(script, directory, ' A'), runNode(script, directory, ' B')])
  const result = await app.query({ type: 'projects.list' }, actor)
  expect(result.status === 'completed' && result.projects?.[0]?.version).toBe(3)
  expect(result.status === 'completed' && result.projects?.[0]?.name).toMatch(/^Original (A B|B A)$/)
})

async function largeLegacy(directory: string, app: WorkApplication) {
  const created = await app.execute({ type: 'project.create', commandId: 'seed', name: 'Original' }, actor)
  if (created.status !== 'completed' || !created.project) throw new Error('Expected project')
  const state = JSON.parse(await readFile(join(directory, 'work-v3.json'), 'utf8'))
  delete state.storage
  const execution: WorkExecution = {
    id: randomUUID(), ref: { projectId: created.project.id, taskId: randomUUID() }, agentId: created.project.defaultAgentId, owner: randomUUID(), epoch: 1,
    resource: { runtimeId: 'host', workspaceId: 'workspace' }, session: { runtimeId: 'host', sessionId: 'session' }, sessionMode: 'create',
    agentPreset: 'contract', model: { provider: 'contract', model: 'test' }, permissionPreset: 'workspace-write',
    policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'waiting', events: [],
    history: Array.from({ length: 32_000 }, (_, index) => ({ state: 'waiting', commandId: `${index}-${'h'.repeat(100)}` })),
  }
  state.executions = [execution]
  state.commands = Array.from({ length: 6 }, (_, index) => ({ commandId: `legacy-${index}`, fingerprint: JSON.stringify(commandSchema.parse({ type: 'project.create', commandId: `legacy-${index}`, name: 'Legacy' })), result: { status: 'completed', execution } }))
  const content = JSON.stringify(state)
  expect(Buffer.byteLength(content)).toBeGreaterThan(30_000_000)
  await fs.writeFile(join(directory, 'work-v3.json'), content)
  return state
}
it('migrates 30 MB without data loss and keeps small writes and history appends independent of archived bytes', async () => {
  const { directory, app } = await open()
  const before = await largeLegacy(directory, app)
  await app.ensureSourceSplit()
  const file = join(directory, 'work-v3.json'), persisted = JSON.parse(await readFile(file, 'utf8'))
  expect(Buffer.byteLength(JSON.stringify(persisted))).toBeLessThan(20_000)
  expect(persisted.storage.version).toBe(1)
  const dao = WorkDao.forDirectory(directory)
  const effective = JSON.parse(JSON.stringify(await dao.read())); delete effective.storage
  expect(effective).toEqual(before)
  // Also recover in another process: no in-memory archive metadata or result cache survives.
  const module = pathToFileURL(resolve('src/work-store/dao.ts')).href
  const output = await runNode(`import { WorkDao } from ${JSON.stringify(module)}; const state = await WorkDao.forDirectory(process.argv[1]).read(); process.stdout.write(JSON.stringify({ length: state.executions[0].history.length, last: state.commands[5].result.execution.history.at(-1) }));`, directory)
  expect(JSON.parse(output)).toEqual({ length: 32_000, last: before.executions[0].history.at(-1) })
  const asyncReads = vi.mocked(fs.readFile), syncReads = vi.mocked(syncFs.readFileSync), writes = vi.mocked(atomic.writeFileAtomic)
  asyncReads.mockClear(); syncReads.mockClear(); writes.mockClear()
  for (let i = 0; i < 3; i++) await app.execute({ type: 'project.create', commandId: `small-${i}`, name: `Small ${i}` }, actor)
  await dao.transaction(async state => { dao.appendHistory(state.executions[0]!, { state: 'ready', commandId: 'increment' }) })
  expect(syncReads.mock.calls.filter(([file]) => String(file).includes('work-v3.archive'))).toHaveLength(0)
  expect(asyncReads.mock.calls.length).toBeGreaterThan(0)
  expect(asyncReads.mock.calls.every(([path]) => path === file)).toBe(true)
  for (const result of asyncReads.mock.results) expect(Buffer.byteLength(String(await result.value))).toBeLessThan(30_000)
  expect(writes.mock.calls.every(([, data]) => Buffer.byteLength(String(data)) < 30_000)).toBe(true)
  expect((await dao.read()).executions[0]!.history).toHaveLength(32_001)
  const replay = await app.execute({ type: 'project.create', commandId: 'legacy-5', name: 'Legacy' }, actor)
  expect(replay).toEqual(before.commands[5].result)
  expect(replay.status === 'completed' && replay.execution?.history).toHaveLength(32_000)
}, 30_000)

it('rejects writes through frozen history/source accessors and preserves lazy committed contents', async () => {
  const { directory, app } = await open()
  await largeLegacy(directory, app); await app.ensureSourceSplit()
  const dao = WorkDao.forDirectory(directory), state = await dao.read(), execution = state.executions[0]!
  expect(() => { execution.history = [] }).toThrow('committed')
  expect(() => { state.commands[0]!.result.execution!.history = [] }).toThrow('committed')
  expect(execution.history).toHaveLength(32_000)
  const project = state.projects[0]!
  await app.execute({ type: 'source.configure-project', commandId: 'source', projectId: project.id, githubProject: { owner: 'a2d2-dev', type: 'org', number: 1 } }, actor)
  const source = (await dao.read()).sources[0]!
  expect(() => { source.observations = [] }).toThrow('committed')
  expect(() => { source.discovery!.checkpoint = undefined }).toThrow('committed')
}, 30_000)

async function runNode(script: string, ...args: string[]): Promise<string> {
  const result = await promisify(execFile)(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', script, ...args], { cwd: process.cwd() })
  return result.stdout
}

it('keeps source bulk atomic with live facts and persists deletion of an unread checkpoint', async () => {
  const { directory, app } = await open()
  const created = await app.execute({ type: 'project.create', commandId: 'project', name: 'Source' }, actor)
  if (created.status !== 'completed' || !created.project) throw new Error('Expected project')
  await app.execute({ type: 'source.configure-project', commandId: 'source', projectId: created.project.id, githubProject: { owner: 'a2d2-dev', type: 'org', number: 1 } }, actor)
  const dao = WorkDao.forDirectory(directory)
  await dao.transaction(async state => { state.sources[0]!.discovery!.checkpoint = { sourceVersion: 1, startedAt: '2026-10-24T00:00:00Z', pages: 1, items: [], issues: [] } })
  const original = await vi.importActual<typeof atomic>('@deepseek-ai/dsh-atomic-write')
  vi.mocked(atomic.writeFileAtomic).mockImplementation(async (...args) => {
    if (args[0] === join(directory, 'work-v3.json')) throw new Error('source commit failure')
    return original.writeFileAtomic(...args)
  })
  await expect(dao.transaction(async state => { state.sources[0]!.discovery!.checkpoint!.pages = 2 })).rejects.toThrow('source commit failure')
  expect((await dao.read()).sources[0]!.discovery!.checkpoint!.pages).toBe(1)
  vi.mocked(atomic.writeFileAtomic).mockImplementation(original.writeFileAtomic)
  await dao.transaction(async state => { delete state.sources[0]!.discovery!.checkpoint })
  expect((await dao.read()).sources[0]!.discovery!.checkpoint).toBeUndefined()
  const exported = await dao.exportSnapshot()
  expect(exported.storage).toBeUndefined()
  expect(exported.sources[0]!.discovery!.checkpoint).toBeUndefined()
})

it.each(['__proto__', 'constructor'])('preserves exact replay for prototype-shaped command ID %s', async commandId => {
  const { directory, app } = await open()
  const command = { type: 'project.create', commandId, name: 'Safe receipt' }
  const result = await app.execute(command, actor)
  expect(result.status).toBe('completed')
  const disk = JSON.parse(await readFile(join(directory, 'work-v3.json'), 'utf8'))
  expect(Object.hasOwn(disk.storage.receipts, commandId)).toBe(true)
  expect(await new WorkApplication(directory, host).execute(command, actor)).toEqual(result)
})

it('rechecks under the writer lock after a pre-lock read captured the old file identity', async () => {
  const { directory, app } = await open()
  await app.execute({ type: 'project.create', commandId: 'seed', name: 'Original' }, actor)
  const dao = WorkDao.forDirectory(directory), file = join(directory, 'work-v3.json')
  const originalFs = await vi.importActual<typeof fs>('node:fs/promises')
  const originalAtomic = await vi.importActual<typeof atomic>('@deepseek-ai/dsh-atomic-write')
  const captured = deferred(), release = deferred(), locked = deferred()
  let intercept = true
  vi.mocked(fs.stat).mockImplementation((async (...args: Parameters<typeof fs.stat>) => {
    const result = await originalFs.stat(...args)
    if (intercept && args[0] === file) { intercept = false; captured.resolve(); await release.promise }
    return result
  }) as typeof fs.stat)
  const staleRead = dao.read()
  await captured.promise
  const external = JSON.parse(await originalFs.readFile(file, 'utf8')); external.projects[0].name = 'External'
  await originalAtomic.writeFileAtomic(file, JSON.stringify(external), { mode: 0o600, dirMode: 0o700 })
  vi.mocked(atomic.withFileLock).mockImplementation(async (file, apply, options) => originalAtomic.withFileLock(file, async () => { locked.resolve(); return apply() }, options))
  const transaction = dao.transaction(async state => { state.projects[0]!.name += ' + local' })
  await locked.promise; release.resolve(); await staleRead; await transaction
  expect((await dao.read()).projects[0]!.name).toBe('External + local')
})

it('validates archived source contents on demand rather than replacing invalid data with empty fields', async () => {
  const { directory, app } = await open()
  const created = await app.execute({ type: 'project.create', commandId: 'project', name: 'Source' }, actor)
  if (created.status !== 'completed' || !created.project) throw new Error('Expected project')
  await app.execute({ type: 'source.configure-project', commandId: 'source', projectId: created.project.id, githubProject: { owner: 'a2d2-dev', type: 'org', number: 1 } }, actor)
  const persisted = JSON.parse(await readFile(join(directory, 'work-v3.json'), 'utf8'))
  await fs.writeFile(join(directory, 'work-v3.archive', persisted.storage.sources[persisted.sources[0].id]), JSON.stringify({ observations: [], pages: [], checkpoint: { pages: 'invalid' } }))
  const source = (await WorkDao.forDirectory(directory).read()).sources[0]!
  expect(() => source.observations).toThrow()
})

it.each([false, true])('rejects a missing committed source reference without fallback or writes (legacy sidecar: %s)', async legacySidecar => {
  const { directory, app } = await open()
  const created = await app.execute({ type: 'project.create', commandId: 'project', name: 'Source' }, actor)
  if (created.status !== 'completed' || !created.project) throw new Error('Expected project')
  await app.execute({ type: 'source.configure-project', commandId: 'source', projectId: created.project.id, githubProject: { owner: 'a2d2-dev', type: 'org', number: 1 } }, actor)
  const file = join(directory, 'work-v3.json'), persisted = JSON.parse(await readFile(file, 'utf8'))
  const sourceId = persisted.sources[0].id
  if (legacySidecar) {
    await fs.mkdir(join(directory, 'work-v3.sources'))
    await fs.writeFile(join(directory, 'work-v3.sources', `${sourceId}.json`), JSON.stringify({ observations: [], pages: [], checkpoint: { sourceVersion: 1, startedAt: '2026-10-24T00:00:00Z', pages: 99, items: [], issues: [] } }))
  }
  delete persisted.storage.sources[sourceId]
  const corrupt = JSON.stringify(persisted)
  await fs.writeFile(file, corrupt)
  const writes = vi.mocked(atomic.writeFileAtomic); writes.mockClear()
  await expect(app.query({ type: 'projects.list' }, actor)).rejects.toThrow('Missing source archive reference')
  await expect(app.execute({ type: 'project.create', commandId: 'after-corruption', name: 'Must not commit' }, actor)).rejects.toThrow('Missing source archive reference')
  expect(writes).not.toHaveBeenCalled()
  expect(await readFile(file, 'utf8')).toBe(corrupt)
})
