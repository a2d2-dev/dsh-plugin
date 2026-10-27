import { createServer } from 'node:http'
import { createWorkHandler } from '../src/work-route.ts'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import * as atomic from '@deepseek-ai/dsh-atomic-write'
import { WorkApplication } from '../src/work.ts'
import { WorkDao } from '../src/work-store/dao.ts'
import { reconcileProjectSources, startProjectDiscovery } from '../src/work-sources/discovery.ts'

vi.mock('@deepseek-ai/dsh-atomic-write', { spy: true })
vi.mock('../src/work-sources/discovery.ts', { spy: true })

const roots: string[] = []
const operator = { operator: true }
const noHost = { resources: async () => [], sessions: async () => [] }
afterEach(async () => {
  vi.useRealTimers()
  vi.clearAllMocks()
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), 'a2d2-contention-'))) throw new Error('Unsafe cleanup')
    await rm(root, { recursive: true, force: true })
  }
})
async function open() {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-contention-'))
  roots.push(directory)
  return { directory, app: new WorkApplication(directory, noHost) }
}

async function largeStore(directory: string, app: WorkApplication) {
  const result = await app.execute({ type: 'project.create', commandId: 'large-project', name: 'Large Project' }, operator)
  if (result.status !== 'completed' || !result.project) throw new Error('Expected project')
  await app.execute({ type: 'source.configure-project', commandId: 'large-source', projectId: result.project.id,
    githubProject: { owner: 'a2d2-dev', type: 'org', number: 1 } }, operator)
  const file = join(directory, 'work-v3.json'), state = JSON.parse(await readFile(file, 'utf8'))
  const issues = Array.from({ length: 3000 }, (_, index) => ({ nodeId: `I_${index + 1}`, number: index + 1, title: `Issue ${index + 1}`,
    body: 'Accepted observation '.repeat(205), repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' },
    url: `https://github.com/a2d2-dev/dsh-plugin/issues/${index + 1}`, state: 'open', labels: [], assignees: [],
    updatedAt: '2026-10-20T00:00:00Z', observedAt: '2026-10-20T00:00:00Z' }))
  state.sources[0].observations = issues.map(issue => ({ issue, sequence: 1 }))
  state.sources[0].sequence = 1
  state.sources[0].discovery.checkpoint = { sourceVersion: 1, startedAt: '2026-10-20T00:00:00Z', pages: 1, cursor: 'next', items: [], issues }
  const content = JSON.stringify(state)
  expect(Buffer.byteLength(content)).toBeGreaterThanOrEqual(20 * 1024 * 1024)
  await writeFile(file, content)
  return state
}

it('lets an interactive write wait for a live same-PID writer holding the file lock for five seconds', async () => {
  const { directory, app } = await open()
  await largeStore(directory, app)
  const lock = join(directory, 'work-v3.json.lock')
  await writeFile(lock, `${process.pid}\n`, { flag: 'wx' })
  const release = new Promise<void>((resolve, reject) => setTimeout(() => {
    if (lock !== join(directory, 'work-v3.json.lock')) { reject(new Error('Unsafe lock path')); return }
    rm(lock).then(() => resolve(), reject)
  }, 5_000))
  try {
    await expect(app.execute({ type: 'project.create', commandId: 'waited', name: 'Interactive work' }, operator))
      .resolves.toMatchObject({ status: 'completed', project: { name: 'Interactive work' } })
    expect(JSON.parse(await readFile(join(directory, 'work-v3.json'), 'utf8')).projects.map((project: { name: string }) => project.name)).toEqual(['Large Project', 'Interactive work'])
  } finally { await release }
}, 35_000)

it('round-trips all 3000 observations and the large checkpoint within the write budget', async () => {
  const { directory, app } = await open()
  const before = await largeStore(directory, app)
  await expect(new WorkApplication(directory, noHost).execute({ type: 'project.create', commandId: 'large-write', name: 'Smoke write' }, operator))
    .resolves.toMatchObject({ status: 'completed' })
  const after = JSON.parse(await readFile(join(directory, 'work-v3.json'), 'utf8'))
  expect(after.schemaVersion).toBe(3)
  // The control plane stays small; the 3000 observations and the checkpoint
  // move to the source's sidecar on the first write after the split.
  expect(after.sources[0].observations).toEqual([])
  expect(after.sources[0].discovery.checkpoint).toBeUndefined()
  const sidecar = JSON.parse(await readFile(join(directory, 'work-v3.archive', after.storage.sources[before.sources[0].id]), 'utf8'))
  expect(sidecar.observations).toEqual(before.sources[0].observations)
  expect(sidecar.checkpoint).toEqual(before.sources[0].discovery.checkpoint)
  // Full export must also recover the original values through the current reader.
  const exported = await WorkDao.forDirectory(directory).exportSnapshot()
  expect(exported.schemaVersion).toBe(before.schemaVersion)
  expect(exported.sources).toEqual(before.sources)
}, 30_000)

it('completes three interactive large-store writes while background discovery holds the writer for five seconds', async () => {
  const { directory, app: seed } = await open()
  await largeStore(directory, seed)
  const app = new WorkApplication(directory, noHost, { list: vi.fn(), detail: vi.fn(), project: async () => ({
    identity: { login: 'reader', nodeId: 'U_1', name: null },
    project: { nodeId: 'PVT_1', title: 'Large Project', url: 'https://github.com/orgs/a2d2-dev/projects/1', closed: false },
    items: [], issues: [], observedAt: '2026-10-22T00:00:00Z',
  }) })
  const original = await vi.importActual<typeof atomic>('@deepseek-ai/dsh-atomic-write')
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  vi.mocked(atomic.writeFileAtomic).mockImplementationOnce(async (...args) => {
    started()
    await new Promise(resolve => setTimeout(resolve, 5_000))
    await original.writeFileAtomic(...args)
  })
  const background = app.reconcileSources()
  await entered
  try {
    await Promise.all(Array.from({ length: 3 }, (_, index) =>
      expect(app.execute({ type: 'project.create', commandId: `during-discovery-${index}`, name: `Interactive during discovery ${index}` }, operator))
        .resolves.toMatchObject({ status: 'completed' })))
  } finally { await background }
  expect(JSON.parse(await readFile(join(directory, 'work-v3.json'), 'utf8')).projects.map((project: { name: string }) => project.name))
    .toEqual(['Large Project', ...Array.from({ length: 3 }, (_, index) => `Interactive during discovery ${index}`)])
}, 35_000)

it('queues writers across application instances before attempting the cross-process lock', async () => {
  const { directory } = await open()
  let started!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const resource = { ref: { runtimeId: 'host', workspaceId: 'workspace' }, title: 'Workspace' }
  const host = { ...noHost, resources: async () => { started(); await gate; return [resource] } }
  const lock = vi.spyOn(atomic, 'withFileLock')
  const first = new WorkApplication(directory, host).execute({ type: 'project.create', commandId: 'first', name: 'First', resource: resource.ref }, operator)
  await entered
  const second = new WorkApplication(directory, noHost).execute({ type: 'project.create', commandId: 'second', name: 'Second' }, operator)
  try {
    // Let the second request reach its storage boundary while the first is held.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(lock.mock.calls.filter(([file]) => file === join(directory, 'work-v3.json'))).toHaveLength(1)
  } finally { release(); await Promise.allSettled([first, second]); lock.mockRestore() }
  expect(await first).toMatchObject({ status: 'completed' })
  expect(await second).toMatchObject({ status: 'completed' })
  const state = JSON.parse(await readFile(join(directory, 'work-v3.json'), 'utf8'))
  expect(state.projects.map((project: { name: string }) => project.name)).toEqual(['First', 'Second'])
})

it('does not rewrite the store on a reconcile tick while Project observations are not due', async () => {
  const { directory } = await open()
  const projectRead = vi.fn()
  const app = new WorkApplication(directory, noHost, { list: vi.fn(), detail: vi.fn(), project: projectRead })
  const created = await app.execute({ type: 'project.create', commandId: 'idle-project', name: 'Idle' }, operator)
  if (created.status !== 'completed' || !created.project) throw new Error('Expected project')
  await app.execute({ type: 'source.configure-project', commandId: 'idle-source', projectId: created.project.id,
    githubProject: { owner: 'a2d2-dev', type: 'org', number: 1 } }, operator)
  const file = join(directory, 'work-v3.json')
  const state = JSON.parse(await readFile(file, 'utf8'))
  state.sources[0].discovery.nextAttemptAt = new Date(Date.now() + 60_000).toISOString()
  await writeFile(file, JSON.stringify(state))
  const writes = vi.mocked(atomic.writeFileAtomic)
  writes.mockClear()
  await app.reconcileSources()
  expect(projectRead).not.toHaveBeenCalled()
  expect(writes).not.toHaveBeenCalled()
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(state)
})

it('keeps a scheduling-only nextAttemptAt update in memory and honors it on the next tick', async () => {
  const { directory } = await open()
  const projectRead = vi.fn()
  const app = new WorkApplication(directory, noHost, { list: vi.fn(), detail: vi.fn(), project: projectRead })
  const created = await app.execute({ type: 'project.create', commandId: 'schedule-project', name: 'Scheduling' }, operator)
  if (created.status !== 'completed' || !created.project) throw new Error('Expected project')
  await app.execute({ type: 'source.configure-project', commandId: 'schedule-source', projectId: created.project.id,
    githubProject: { owner: 'a2d2-dev', type: 'org', number: 1 } }, operator)
  const file = join(directory, 'work-v3.json'), before = await readFile(file, 'utf8')
  // Isolate the scheduler-to-storage contract: no observation or recovery fact changes.
  vi.mocked(reconcileProjectSources).mockImplementationOnce(async transaction => {
    await transaction(async state => { state.sources[0]!.discovery!.nextAttemptAt = new Date(Date.now() + 60_000).toISOString() })
  })
  const writes = vi.mocked(atomic.writeFileAtomic)
  writes.mockClear()
  await app.reconcileSources()
  expect(writes).not.toHaveBeenCalled()
  expect(await readFile(file, 'utf8')).toBe(before)
  await app.reconcileSources()
  expect(projectRead).not.toHaveBeenCalled()
  expect(writes).not.toHaveBeenCalled()
})

it.each(['bad-json', 'bad-schema', 'lock-timeout', 'EACCES'] as const)('reports a safe storage reason over HTTP for %s', async failure => {
  const { directory, app } = await open()
  if (failure === 'bad-json') await writeFile(join(directory, 'work-v3.json'), '{broken')
  if (failure === 'bad-schema') await writeFile(join(directory, 'work-v3.json'), '{}')
  if (failure === 'lock-timeout') vi.mocked(atomic.withFileLock).mockRejectedValueOnce(new Error(`atomic-write: timed out waiting for the writer lock at ${directory}/work-v3.json.lock`))
  if (failure === 'EACCES') vi.mocked(atomic.writeFileAtomic).mockRejectedValueOnce(Object.assign(new Error(`EACCES: permission denied, open '${directory}/work-v3.json'`), { code: 'EACCES' }))
  const handler = createWorkHandler(app, () => undefined)
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected isolated port')
    const response = await fetch(`http://127.0.0.1:${address.port}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'command', value: { type: 'project.create', commandId: 'diagnose', name: 'Write' } }) })
    expect(response.status).toBe(503)
    const result = await response.json() as { error: { message: string } }
    const reason = failure.startsWith('bad-') ? 'invalid-state' : failure.toLowerCase()
    expect(result).toMatchObject({ status: 'failed', error: { code: 'work-record-unavailable', message: expect.stringContaining(reason) } })
    expect(result.error.message).not.toContain(directory)
    expect(result.error.message).not.toContain('work-v3.json')
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})

it('polls discovery every five minutes by default instead of rewriting pressure every five seconds', async () => {
  vi.useFakeTimers()
  const reconcile = vi.fn(async () => {})
  const stop = startProjectDiscovery({ reconcile })
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(reconcile).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(299_999)
    expect(reconcile).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(reconcile).toHaveBeenCalledTimes(2)
  } finally { await stop() }
})
