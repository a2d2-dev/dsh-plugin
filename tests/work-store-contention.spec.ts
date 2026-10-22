import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'

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
