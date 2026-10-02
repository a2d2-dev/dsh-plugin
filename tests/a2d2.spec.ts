import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service, { DEFAULT_HANDOFF_WARN_TOKENS } from '../src/index.ts'
import { TaskId } from '../src/brand.ts'
import { handedOff, memberOf, successorsOf } from '../src/derive.ts'
import {
  TaskDocumentError,
  parseTaskDocument,
  renderTaskDocument,
  taskIdFromFilename,
} from '../src/document.ts'
import { DEFAULT_STAGE_AGENTS, validateStageAgentsSettings } from '../src/stage-agents.ts'
import { TaskDocumentStore, newTask, resolveProjectRoot, tasksDirectory, withMember } from '../src/store.ts'
import type { Task } from '../src/types.ts'

class StubSettings extends Service {
  readonly presentations: Array<{ readonly auto?: boolean }> = []

  constructor(ctx: Context) {
    super(ctx, 'settings')
  }

  configure(presentation: { auto?: boolean }): () => void {
    this.presentations.push(presentation)
    return () => {}
  }
}

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const sessionA = SessionId('session-a')
const sessionB = SessionId('session-b')

function taskWith(members: Task['members']): Task {
  return {
    id: TaskId('demo'),
    name: 'Demo',
    state: 'active',
    createdAt: '2026-09-20T00:00:00.000Z',
    members,
  }
}

describe('task document validation', () => {
  it('round-trips a task through render and parse', () => {
    const task = taskWith([{ sessionId: sessionA }, { sessionId: sessionB, handoffFrom: sessionA }])
    const reparsed = parseTaskDocument(renderTaskDocument(task), task.id)
    expect(reparsed).toEqual(task)
  })

  it('omits an absent goal and keeps a present one', () => {
    expect(renderTaskDocument(taskWith([]))).not.toContain('goal')
    expect(renderTaskDocument({ ...taskWith([]), goal: 'ship it' })).toContain('ship it')
  })

  it('rejects a document that is not a mapping', () => {
    expect(() => parseTaskDocument('- 1\n', TaskId('demo'))).toThrow(TaskDocumentError)
  })

  it('rejects invalid YAML', () => {
    expect(() => parseTaskDocument('a: [', TaskId('demo'))).toThrow(/not valid YAML/)
  })

  it('rejects an unsupported version, naming the declared and the readable versions', () => {
    const text = renderTaskDocument(taskWith([])).replace('version: 2', 'version: 3')
    expect(() => parseTaskDocument(text, TaskId('demo'))).toThrow(/version 3.*version 2 or 1/)
  })

  it('rejects an id that disagrees with the filename', () => {
    expect(() => parseTaskDocument(renderTaskDocument(taskWith([])), TaskId('other')))
      .toThrow(/filename is authoritative/)
  })

  it('rejects an unknown state', () => {
    const text = renderTaskDocument(taskWith([])).replace('state: active', 'state: dormant')
    expect(() => parseTaskDocument(text, TaskId('demo'))).toThrow(/active, paused, done/)
  })

  it('rejects sessions that are not a sequence', () => {
    const text = renderTaskDocument(taskWith([])).replace('sessions: []', 'sessions: {}')
    expect(() => parseTaskDocument(text, TaskId('demo'))).toThrow(/sessions must be a sequence/)
  })

  it('rejects a blank name and a blank member id', () => {
    expect(() => parseTaskDocument(renderTaskDocument(taskWith([])).replace('name: Demo', 'name: ""'), TaskId('demo')))
      .toThrow(/name must be a non-empty string/)
    const blank = taskWith([{ sessionId: sessionA }]).members
    const text = renderTaskDocument({ ...taskWith(blank), name: 'Demo' }).replace('id: session-a', 'id: ""')
    expect(() => parseTaskDocument(text, TaskId('demo'))).toThrow(/id must be a non-empty string/)
  })

  it('derives the id from a .yaml or .yml filename', () => {
    expect(taskIdFromFilename('demo.yaml')).toBe('demo')
    expect(taskIdFromFilename('demo.yml')).toBe('demo')
  })
})

describe('task id', () => {
  it('rejects ids that are not safe filename tokens', () => {
    expect(() => TaskId('../escape')).toThrow(/kebab-case/)
    expect(() => TaskId('Demo')).toThrow(/kebab-case/)
    expect(TaskId('demo-task-2')).toBe('demo-task-2')
  })
})

describe('derived handoff edges', () => {
  const task = taskWith([
    { sessionId: sessionA },
    { sessionId: sessionB, handoffFrom: sessionA },
    { sessionId: SessionId('session-c'), handoffFrom: sessionA },
  ])

  it('lists every successor of one session', () => {
    expect(successorsOf(task, sessionA)).toEqual([sessionB, SessionId('session-c')])
    expect(successorsOf(task, sessionB)).toEqual([])
  })

  it('reports a continuation without claiming the source is finished', () => {
    expect(handedOff(task, sessionA)).toBe(true)
    expect(handedOff(task, sessionB)).toBe(false)
  })

  it('finds a member entry', () => {
    expect(memberOf(task, sessionB)?.handoffFrom).toBe(sessionA)
    expect(memberOf(task, SessionId('session-z'))).toBeUndefined()
  })
})

describe('appending a member', () => {
  it('appends once and is idempotent afterwards', () => {
    const once = withMember(taskWith([]), sessionA)
    expect(once.members).toEqual([{ sessionId: sessionA }])
    expect(withMember(once, sessionA)).toBe(once)
  })

  it('records the handoff edge', () => {
    const joined = withMember(taskWith([]), sessionB, sessionA)
    expect(joined.members).toEqual([{ sessionId: sessionB, handoffFrom: sessionA }])
  })
})

describe('project root resolution', () => {
  it('finds the nearest ancestor carrying a marker', async () => {
    const root = await tempRoot()
    await mkdir(join(root, '.git'), { recursive: true })
    const nested = join(root, 'a', 'b')
    await mkdir(nested, { recursive: true })
    expect(await resolveProjectRoot(nested, ['.git'])).toBe(root)
  })

  it('treats a markerless cwd as its own project root', async () => {
    const root = await tempRoot()
    expect(await resolveProjectRoot(root, ['.git'])).toBe(root)
  })

  it('reads a file marker as not a marker', async () => {
    const root = await tempRoot()
    await writeFile(join(root, '.git'), 'not a directory')
    expect(await resolveProjectRoot(root, ['.git'])).toBe(root)
  })

  it('places documents under the plugin namespace', async () => {
    expect(tasksDirectory('/proj')).toBe(join('/proj', '.dsh', 'a2d2', 'tasks'))
  })
})

describe('task document store', () => {
  it('reports no tasks when the directory is absent', async () => {
    const root = await tempRoot()
    const store = new TaskDocumentStore({ root, projectMarkers: ['.git'] })
    expect(await store.list(root)).toEqual([])
    expect(await store.read(root, TaskId('demo'))).toBeUndefined()
  })

  it('writes and reads a document through the store', async () => {
    const root = await tempRoot()
    const store = new TaskDocumentStore({ root, projectMarkers: ['.git'] })
    const task = newTask(TaskId('demo'), { name: 'Demo' }, new Date('2026-09-20T00:00:00.000Z'))
    await store.write(root, task)
    expect(await store.read(root, task.id)).toEqual(task)
    expect(await store.list(root)).toEqual([task])
  })

  it('fails loudly on a malformed document instead of dropping it', async () => {
    const root = await tempRoot()
    const store = new TaskDocumentStore({ root, projectMarkers: ['.git'] })
    await mkdir(tasksDirectory(root), { recursive: true })
    await writeFile(join(tasksDirectory(root), 'demo.yaml'), 'version: 99\nid: demo\n')
    await expect(store.list(root)).rejects.toThrow(TaskDocumentError)
  })

  it('mints a kebab-case id and avoids collisions', async () => {
    const root = await tempRoot()
    const store = new TaskDocumentStore({ root, projectMarkers: ['.git'] })
    expect(await store.mintId(root, 'Fix the Flaky Test')).toBe('fix-the-flaky-test')
    await store.write(root, newTask(TaskId('fix-the-flaky-test'), { name: 'x' }, new Date()))
    expect(await store.mintId(root, 'Fix the Flaky Test')).toBe('fix-the-flaky-test-2')
  })

  it('mints a timestamp id for a name with no ASCII stem', async () => {
    const root = await tempRoot()
    const store = new TaskDocumentStore({ root, projectMarkers: ['.git'] })
    expect(await store.mintId(root, '实现交接插件')).toMatch(/^task-[a-z0-9]+$/)
  })

  it('prefers the configured root over the cwd', async () => {
    const root = await tempRoot()
    const elsewhere = await tempRoot()
    const store = new TaskDocumentStore({ root, projectMarkers: ['.git'] })
    await store.write(elsewhere, newTask(TaskId('demo'), { name: 'Demo' }, new Date()))
    expect(await readFile(join(tasksDirectory(root), 'demo.yaml'), 'utf8')).toContain('name: Demo')
  })
})

describe('a2d2 service', () => {
  // The store declares no services, so it mounts on a bare context; the service
  // itself stays real.
  async function mount(root: string): Promise<A2d2Service> {
    const ctx = new Context()
    await ctx.plugin(A2d2Service, { root })
    return ctx.a2d2
  }

  it('defaults the smart-zone warning threshold to 150k tokens', () => {
    expect(DEFAULT_HANDOFF_WARN_TOKENS).toBe(150_000)
  })

  it('creates a task and resolves it for the project', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const created = await service.create(root, { name: 'Ship the store', goal: 'land phase one' })
    expect(created.id).toBe('ship-the-store')
    expect(created.goal).toBe('land phase one')
    expect((await service.resolve(root))?.id).toBe('ship-the-store')
    expect(await service.list(root)).toEqual([created])
  })

  it('does not create an unbound task with a task issue identity', async () => {
    const root = await tempRoot()
    const service = await mount(root)

    const created = await service.create(root, { name: 'Issue 45' })

    expect(created.id).not.toBe('issue-45')
    expect(created.id).toBe('issue-45-2')
    expect(created).not.toHaveProperty('issue')
  })

  it('resolves the newest active task and ignores non-active ones', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const older = newTask(TaskId('older'), { name: 'Older' }, new Date('2026-01-01T00:00:00.000Z'))
    const newer = newTask(TaskId('newer'), { name: 'Newer' }, new Date('2026-02-01T00:00:00.000Z'))
    const paused = { ...newTask(TaskId('paused'), { name: 'Paused' }, new Date('2026-03-01T00:00:00.000Z')), state: 'paused' as const }
    const store = new TaskDocumentStore({ root, projectMarkers: ['.git'] })
    for (const task of [older, newer, paused]) await store.write(root, task)
    expect((await service.resolve(root))?.id).toBe('newer')
  })

  it('returns undefined when the project has no active task', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    expect(await service.resolve(root)).toBeUndefined()
  })

  it('registers members idempotently and keeps the handoff edge', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const created = await service.create(root, { name: 'Handoff chain' })
    await service.registerMember(root, created.id, sessionA)
    const linked = await service.registerMember(root, created.id, sessionB, sessionA)
    expect(linked.members).toEqual([
      { sessionId: sessionA },
      { sessionId: sessionB, handoffFrom: sessionA },
    ])
    // A retried registration must not duplicate the member or lose the edge.
    expect(await service.registerMember(root, created.id, sessionB, sessionA)).toEqual(linked)
    expect(await service.registerMember(root, created.id, sessionB)).toEqual(linked)
  })

  it('exposes the derived edge facts', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const created = await service.create(root, { name: 'Derived' })
    await service.registerMember(root, created.id, sessionA)
    const task = await service.registerMember(root, created.id, sessionB, sessionA)
    expect(service.successors(task, sessionA)).toEqual([sessionB])
    expect(service.handedOff(task, sessionA)).toBe(true)
    expect(service.handedOff(task, sessionB)).toBe(false)
    expect(service.memberOf(task, sessionB)?.handoffFrom).toBe(sessionA)
  })

  it('fails loudly when registering into a task that does not exist', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    await expect(service.registerMember(root, TaskId('missing'), sessionA)).rejects.toThrow(/does not exist/)
  })

  it('rejects a relative configured root at load', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(A2d2Service, { root: 'relative/path' })).rejects.toThrow(/absolute path/)
  })

  it('rejects an empty marker list at load', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(A2d2Service, { projectMarkers: [] })).rejects.toThrow(/at least one/)
  })

  it('declares the stage Agent table as a volatile Config field with the package defaults', () => {
    const field = A2d2Service.Config.dict?.stageAgents
    expect(field?.meta.volatile).toBe(true)
    expect(A2d2Service.Config({}).stageAgents?.get()).toEqual(DEFAULT_STAGE_AGENTS)
    expect(() => validateStageAgentsSettings({
      ...DEFAULT_STAGE_AGENTS,
      consult: [],
    })).toThrow(/array length >= 1/u)
  })

  it('turns off the generated settings page in favour of its own A2D2 config page', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(StubSettings)
    await ctx.plugin(A2d2Service, { root })
    const settings = ctx.get('settings') as unknown as StubSettings
    expect(settings.presentations).toEqual([{ auto: false }])
  })
})

describe('boundary failures', () => {
  it('rejects a present but non-string optional field', () => {
    const text = `${renderTaskDocument(taskWith([]))}goal: 7\n`
    expect(() => parseTaskDocument(text, TaskId('demo')))
      .toThrow(/goal must be a non-empty string when present/)
  })

  it('accepts a document that omits the sessions key entirely', () => {
    const text = 'version: 1\nid: demo\nname: Demo\nstate: active\ncreatedAt: 2026-01-01T00:00:00.000Z\n'
    expect(parseTaskDocument(text, TaskId('demo')).members).toEqual([])
  })

  it('propagates a directory failure that is not a missing directory', async () => {
    const root = await tempRoot()
    await mkdir(join(root, '.dsh', 'a2d2'), { recursive: true })
    await writeFile(join(root, '.dsh', 'a2d2', 'tasks'), 'not a directory')
    const store = new TaskDocumentStore({ root, projectMarkers: ['.git'] })
    await expect(store.list(root)).rejects.toThrow(/ENOTDIR/)
  })

  it('propagates a document read failure that is not a missing file', async () => {
    const root = await tempRoot()
    await mkdir(join(tasksDirectory(root), 'demo.yaml'), { recursive: true })
    const store = new TaskDocumentStore({ root, projectMarkers: ['.git'] })
    await expect(store.read(root, TaskId('demo'))).rejects.toThrow(/EISDIR/)
  })

  it('rejects a blank task name', () => {
    expect(() => newTask(TaskId('demo'), { name: '   ' }, new Date()))
      .toThrow(/must not be blank/)
  })

  it('applies package defaults when the service is constructed without Schemastery', async () => {
    const root = await tempRoot()
    await mkdir(join(root, '.git'), { recursive: true })
    // Direct construction bypasses the schema, so the package must still supply
    // its own marker default and marker-derived root.
    const service = new A2d2Service(new Context(), {})
    expect((await service.create(root, { name: 'Marker derived' })).id).toBe('marker-derived')
    expect(await readFile(join(tasksDirectory(root), 'marker-derived.yaml'), 'utf8'))
      .toContain('Marker derived')
  })
})
