import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import * as atomic from '@deepseek-ai/dsh-atomic-write'
import { WorkApplication } from '../src/work.ts'

vi.mock('@deepseek-ai/dsh-atomic-write', { spy: true })

const roots: string[] = []
const operator = { operator: true }
const noHost = { resources: async () => [], sessions: async () => [] }
afterEach(async () => {
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

it('lets an interactive write wait for a live same-PID writer holding the file lock for five seconds', async () => {
  const { directory, app } = await open()
  const lock = join(directory, 'work-v3.json.lock')
  await writeFile(lock, `${process.pid}\n`, { flag: 'wx' })
  const release = new Promise<void>((resolve, reject) => setTimeout(() => {
    if (lock !== join(directory, 'work-v3.json.lock')) { reject(new Error('Unsafe lock path')); return }
    rm(lock).then(() => resolve(), reject)
  }, 5_000))
  try {
    await expect(app.execute({ type: 'project.create', commandId: 'waited', name: 'Interactive work' }, operator))
      .resolves.toMatchObject({ status: 'completed', project: { name: 'Interactive work' } })
    expect(JSON.parse(await readFile(join(directory, 'work-v3.json'), 'utf8')).projects).toHaveLength(1)
  } finally { await release }
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
