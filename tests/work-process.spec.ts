import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import type { WorkResult } from '../src/work-types.ts'

const roots: string[] = []
const children = new Set<ChildProcess>()
const operator = { operator: true }
const host = { resources: async () => [], sessions: async () => [] }
afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
  }
  children.clear()
  for (const path of roots.splice(0)) {
    if (!path.startsWith(join(tmpdir(), 'a2d2-work-process-'))) throw new Error('Unexpected cleanup path')
    await rm(path, { recursive: true, force: true })
  }
})
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'a2d2-work-process-'))
  roots.push(path)
  return path
}
async function worker(directory: string, command: unknown, mode: 'execute' | 'lose-reply' | 'hold-lock' = 'execute') {
  const script = `
    import { WorkApplication } from ${JSON.stringify(new URL('../src/work.ts', import.meta.url).href)};
    import { withFileLock } from '@deepseek-ai/dsh-atomic-write';
    import { join } from 'node:path';
    const app = new WorkApplication(process.argv[1], { resources: async () => [], sessions: async () => [] });
    const command = JSON.parse(process.argv[2]);
    process.on('message', () => {});
    if (process.argv[3] === 'hold-lock') {
      await withFileLock(join(process.argv[1], 'work-v3.json'), async () => {
        process.send({ ready: true });
        await new Promise(() => {});
      });
    } else {
      const start = new Promise(resolve => process.once('message', resolve));
      process.send({ ready: true });
      await start;
      const result = await app.execute(command, { operator: true });
      process.send({ result });
      if (process.argv[3] === 'lose-reply') await new Promise(() => {});
      else process.disconnect();
    }
  `
  const child = spawn(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', script, directory, JSON.stringify(command), mode],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  children.add(child)
  let stderr = ''
  child.stderr!.on('data', chunk => { stderr += String(chunk) })
  await new Promise<void>((resolve, reject) => {
    child.once('message', () => { child.off('exit', onExit); resolve() })
    const onExit = (code: number | null) => { reject(new Error(`Writer exited before ready (${code}): ${stderr}`)) }
    child.once('exit', onExit)
    child.once('error', reject)
  })
  return {
    child,
    async execute(): Promise<WorkResult> {
      const reply = once(child, 'message')
      child.send({ go: true })
      return (await reply)[0].result as WorkResult
    },
  }
}

it('serializes independent process writers with one durable command identity and no same-name overwrites', async () => {
  const directory = await root()
  const command = { type: 'project.create', commandId: 'process-create', name: 'Concurrent name' }
  const [one, two] = await Promise.all([worker(directory, command), worker(directory, command)])
  const [left, right] = await Promise.all([one.execute(), two.execute()])
  expect(left).toEqual(right)
  expect(left.status).toBe('completed')
  const [three, four] = await Promise.all([worker(directory, { ...command, commandId: 'unique-one' }), worker(directory, { ...command, commandId: 'unique-two' })])
  expect((await Promise.all([three.execute(), four.execute()])).every(result => result.status === 'completed')).toBe(true)
  expect(await new WorkApplication(directory, host).query({ type: 'projects.list' }, operator))
    .toMatchObject({ status: 'completed', projects: [expect.anything(), expect.anything(), expect.anything()] })
})

it('recovers a committed command after its writer dies before the caller receives the response', async () => {
  const directory = await root()
  const command = { type: 'project.create', commandId: 'lost-response', name: 'Committed once' }
  const crashed = await worker(directory, command, 'lose-reply')
  const committed = await crashed.execute()
  const exited = once(crashed.child, 'exit')
  crashed.child.kill('SIGKILL')
  await exited
  const app = new WorkApplication(directory, host)
  expect(await app.execute(command, operator)).toEqual(committed)
  const result = await app.query({ type: 'projects.list' }, operator)
  expect(result.status === 'completed' && result.projects).toHaveLength(1)
})

it('refuses a live foreign writer and recovers its dead PID lock without losing accepted records', async () => {
  const directory = await root()
  const app = new WorkApplication(directory, host)
  const command = { type: 'project.create', commandId: 'after-lock', name: 'After lock' }
  await app.execute({ ...command, commandId: 'before-lock' }, operator)
  const holder = await worker(directory, {}, 'hold-lock')
  await expect(app.execute(command, operator)).rejects.toThrow('timed out waiting for the writer lock')
  const unchanged = await app.query({ type: 'projects.list' }, operator)
  expect(unchanged.status === 'completed' && unchanged.projects).toHaveLength(1)
  const exited = once(holder.child, 'exit')
  holder.child.kill('SIGKILL')
  await exited
  expect(await app.execute(command, operator)).toMatchObject({ status: 'completed' })
  const reloaded = await new WorkApplication(directory, host).query({ type: 'projects.list' }, operator)
  expect(reloaded.status === 'completed' && reloaded.projects).toHaveLength(2)
}, 10_000)

it('fails closed on unknown records and preserves the file rather than resetting accepted data', async () => {
  const directory = await root()
  const app = new WorkApplication(directory, host)
  await app.execute({ type: 'project.create', commandId: 'accepted', name: 'Accepted' }, operator)
  const file = join(directory, 'work-v3.json')
  const accepted = await readFile(file, 'utf8')
  const invalid = JSON.stringify({ ...JSON.parse(accepted), schemaVersion: 99 })
  await writeFile(file, invalid)
  await expect(app.execute({ type: 'project.create', commandId: 'must-not-write', name: 'Denied' }, operator)).rejects.toThrow()
  expect(await readFile(file, 'utf8')).toBe(invalid)
  await writeFile(file, accepted)
  const reloaded = await new WorkApplication(directory, host).query({ type: 'projects.list' }, operator)
  expect(reloaded.status === 'completed' && reloaded.projects).toHaveLength(1)
})
