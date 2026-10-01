/**
 * The handoff service: the skeleton `prepareHandoff` writes, the summary the
 * handing-off session fills in, and the task `takeHandoff` derives from that
 * session's own membership.
 *
 * @module dsh-a2d2/tests/handoff-service
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service from '../src/index.ts'
import type { Config, PrepareHandoffRequest } from '../src/index.ts'
import { TaskId } from '../src/brand.ts'
import {
  HANDOFF_SUMMARY_END,
  HANDOFF_SUMMARY_PLACEHOLDER,
  HANDOFF_SUMMARY_START,
  HandoffDocumentError,
  parseHandoffDocument,
} from '../src/handoff-document.ts'
import { HANDOFFS_DIRECTORY_SEGMENTS, TaskDocumentStore, handoffsDirectory, newTask } from '../src/store.ts'
import * as commandPlugin from '../src/command.ts'
import { StubCommands } from './stubs.ts'

const roots: string[] = []
const source = SessionId('session-a')
const successor = SessionId('session-b')

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-handoff-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/**
 * Mount the real task service over a project root.
 *
 * The service declares no required service, so a bare context is enough; the
 * store, the document files, and the project-root walk all stay real.
 * @param root - the project root the store is pinned to.
 * @param config - optional plugin configuration under test.
 * @returns the mounted service.
 */
async function mount(root: string, config: Partial<Config> = {}): Promise<A2d2Service> {
  const skillsRoot = config.skillsRoot ?? join(root, '.test-skills')
  if (config.skillsRoot === undefined) {
    const handoff = join(skillsRoot, 'handoff')
    await mkdir(handoff, { recursive: true })
    await writeFile(join(handoff, 'SKILL.md'), 'Write exact test continuation content.\n', 'utf8')
  }
  const ctx = new Context()
  await ctx.plugin(A2d2Service, { ...config, root, skillsRoot })
  return ctx.a2d2
}

/** A prepare request for a handoff of the source session inside one project. */
function request(root: string, overrides: Partial<PrepareHandoffRequest> = {}): PrepareHandoffRequest {
  return {
    source,
    cwd: root,
    focus: undefined,
    taskId: undefined,
    now: new Date('2026-09-21T10:00:00.000Z'),
    ...overrides,
  }
}

/**
 * Fill a document's summary region the way the handing-off session's own agent
 * does, which is the turn the command queues.
 * @param path - the skeleton document to fill in.
 * @param summary - the prose to put between the markers.
 */
async function writeSummary(path: string, summary: string): Promise<void> {
  const skeleton = await readFile(path, 'utf8')
  expect(skeleton).toContain(HANDOFF_SUMMARY_PLACEHOLDER)
  await writeFile(path, skeleton.replace(HANDOFF_SUMMARY_PLACEHOLDER, summary), 'utf8')
}

/** The classified failure a document is refused with, for the states a caller branches on. */
function refusalCode(text: string): string | undefined {
  try {
    parseHandoffDocument(text, source)
  } catch (error) {
    return error instanceof HandoffDocumentError ? error.code : undefined
  }
  return undefined
}

describe('handoff file location', () => {
  it('places handoff documents beside the task documents', () => {
    expect(handoffsDirectory('/proj')).toBe(join('/proj', ...HANDOFFS_DIRECTORY_SEGMENTS))
    expect(HANDOFFS_DIRECTORY_SEGMENTS).toEqual(['.dsh', 'a2d2', 'handoffs'])
  })
})

describe('prepareHandoff', () => {
  it('creates the project\'s first task, registers the source, and writes a skeleton', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root, { focus: 'finish the handoff command' }))

    expect(prepared.source).toBe(source)
    expect(prepared.task.name).toBe('finish the handoff command')
    expect(prepared.task.members).toEqual([{ sessionId: source }])
    expect(prepared.path).toBe(join(handoffsDirectory(root), 'session-a.md'))

    const skeleton = await readFile(prepared.path, 'utf8')
    expect(skeleton).toContain('# Handoff from session-a')
    expect(skeleton).toContain('finish the handoff command')
    expect(skeleton).toContain(`.dsh/a2d2/tasks/${prepared.task.id}.yaml`)
    expect(skeleton).toContain('## Summary')
  })

  it('writes a document a successor cannot take until the summary is written', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root))

    expect(await readFile(prepared.path, 'utf8')).toContain(HANDOFF_SUMMARY_PLACEHOLDER)
    await expect(service.takeHandoff({ source, successor, cwd: root })).rejects.toThrow(HandoffDocumentError)
    expect(refusalCode(await readFile(prepared.path, 'utf8'))).toBe('unwritten')
  })

  it('renders the turn that asks the source session to write the summary', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root, { focus: 'finish the store layer' }))

    expect(prepared.instruction).toContain(prepared.path)
    expect(prepared.instruction).toContain(HANDOFF_SUMMARY_START)
    expect(prepared.instruction).toContain(HANDOFF_SUMMARY_END)
    expect(prepared.instruction).toContain('finish the store layer')
    expect(prepared.instruction).toContain('Write exact test continuation content.')
  })

  it('marks the document and uses the minimal instruction when the skill is missing', async () => {
    const root = await tempRoot()
    const service = await mount(root, { skillsRoot: join(root, 'missing-skills') })
    const prepared = await service.prepareHandoff(request(root))
    const skeleton = await readFile(prepared.path, 'utf8')

    expect(prepared.instruction).toContain('The handoff skill source was not available.')
    expect(prepared.instruction).not.toContain('<handoff-skill-source>')
    expect(skeleton).toContain('skillSource: unavailable')
  })

  it('accepts deprecated suggestedSkills without rendering them', async () => {
    const root = await tempRoot()
    const service = await mount(root, { suggestedSkills: ['legacy-skill'] })
    const prepared = await service.prepareHandoff(request(root))

    expect(await readFile(prepared.path, 'utf8')).not.toContain('Suggested skills')
    expect(await readFile(prepared.path, 'utf8')).not.toContain('legacy-skill')
  })

  it('names the task after the project directory when the handoff has no focus', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root))
    expect(prepared.task.name).toBe(basename(root))
    expect(basename(prepared.path)).toBe('session-a.md')
  })

  it('reuses the newest active task and never registers the member twice', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const existing = await service.create(root, { name: 'Existing task' })
    const first = await service.prepareHandoff(request(root))
    const second = await service.prepareHandoff(request(root, { now: new Date('2026-09-21T11:00:00.000Z') }))
    expect(first.task.id).toBe(existing.id)
    expect(second.task.id).toBe(existing.id)
    expect(second.task.members).toEqual([{ sessionId: source }])
  })

  it('honours an explicit task and fails loudly when it does not exist', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const explicit = await service.create(root, { name: 'Explicit task' })
    const prepared = await service.prepareHandoff(request(root, { taskId: explicit.id }))
    expect(prepared.task.id).toBe(explicit.id)

    await expect(service.prepareHandoff(request(root, { taskId: TaskId('missing-task') })))
      .rejects.toThrow(/missing-task.*does not exist/)
  })

  it('takes the project from the handed-off session rather than from elsewhere', async () => {
    const root = await tempRoot()
    const elsewhere = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root))
    expect(prepared.path.startsWith(handoffsDirectory(root))).toBe(true)
    expect(prepared.path.startsWith(elsewhere)).toBe(false)
  })

  it('fails loudly when the handed-off session records no working directory', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    await expect(service.prepareHandoff(request(root, { cwd: '' }))).rejects.toThrow(/working directory/)
  })

  it('refuses a session id that would escape the handoffs directory', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    await expect(service.prepareHandoff(request(root, { source: SessionId('../../escape') })))
      .rejects.toThrow(/not a usable session id/)
  })

  it('marks a task issue as handing off when its main session prepares a handoff', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const bound = await service.bindMainSession({
      cwd: root,
      issue: 45,
      parentIssue: 41,
      title: 'Main session handoff',
      mainSession: source,
      now: new Date('2026-10-01T10:00:00.000Z'),
    })

    const prepared = await service.prepareHandoff(request(root))

    expect(prepared.task).toEqual({
      ...bound,
      issue: { number: 45, parent: 41, mainSession: source, handoff: { source } },
    })
    expect((await service.readTask(root, bound.id))?.issue).toEqual({
      number: 45,
      parent: 41,
      mainSession: source,
      handoff: { source },
    })
  })

  it('leaves the source usable: prepare records no successor edge', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root))
    expect(service.handedOff(prepared.task, source)).toBe(false)
    expect(service.successors(prepared.task, source)).toEqual([])
  })

})

describe('the skeleton a handoff starts from', () => {
  it('becomes a takeable document once the writing turn has filled the summary in', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root, { focus: 'land the retry guard' }))
    expect(refusalCode(await readFile(prepared.path, 'utf8'))).toBe('unwritten')

    await writeSummary(prepared.path, 'The retry guard landed. Next: the store layer.')

    const taken = await service.takeHandoff({ source, successor, cwd: root })
    expect(taken.document.source).toBe(source)
    expect(taken.document.task).toBe(prepared.task.id)
    expect(taken.document.focus).toBe('land the retry guard')
    expect(taken.document.createdAt).toBe('2026-09-21T10:00:00.000Z')
    expect(taken.document.body).toContain('The retry guard landed.')
    expect(taken.prompt).toContain('The retry guard landed.')
    expect(taken.task.members).toEqual([
      { sessionId: source },
      { sessionId: successor, handoffFrom: source },
    ])
  })

  it('keeps the summary out of the prompt\'s front matter', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root))
    await writeSummary(prepared.path, 'The retry guard landed.')
    const taken = await service.takeHandoff({ source, successor, cwd: root })
    expect(taken.prompt).not.toContain('version:')
    expect(taken.prompt).not.toContain('source: session-a')
    expect(taken.prompt).toContain('Continue the work described below.')
  })
})

describe('takeHandoff', () => {
  it('records the successor with a handoff edge from the source', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root, { focus: 'land the retry guard' }))
    await writeSummary(prepared.path, 'continue the store work')

    const taken = await service.takeHandoff({ source, successor, cwd: root })
    expect(service.successors(taken.task, source)).toEqual([successor])
    expect(service.handedOff(taken.task, successor)).toBe(false)
    expect(taken.document.focus).toBe('land the retry guard')
  })

  it('derives the task from the source session\'s membership, not from project recency', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root, { focus: 'the prepared task' }))
    await writeSummary(prepared.path, 'continue')
    await service.create(root, { name: 'Unrelated newer task' })

    const taken = await service.takeHandoff({ source, successor, cwd: root })
    expect(taken.task.id).toBe(prepared.task.id)
    expect(taken.task.name).toBe('the prepared task')
  })

  it('prefers an active membership over a newer paused one', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const store = new TaskDocumentStore({ root, projectMarkers: ['.git'] })
    const active = await service.create(root, { name: 'Active task' })
    const prepared = await service.prepareHandoff(request(root, { taskId: active.id }))
    await writeSummary(prepared.path, 'continue')
    // A paused task listing the same session, created later, must not win.
    await store.write(root, {
      ...newTask(TaskId('paused-task'), { name: 'Paused task' }, new Date('2099-01-01T00:00:00.000Z')),
      state: 'paused',
      members: [{ sessionId: source }],
    })

    const taken = await service.takeHandoff({ source, successor, cwd: root })
    expect(taken.task.id).toBe(active.id)
  })

  it('falls back to the newest membership when the session belongs to no active task', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const store = new TaskDocumentStore({ root, projectMarkers: ['.git'] })
    const older = await service.create(root, { name: 'Older task' })
    const prepared = await service.prepareHandoff(request(root, { taskId: older.id }))
    await writeSummary(prepared.path, 'continue')
    await store.write(root, { ...prepared.task, state: 'paused' })
    const newer = {
      ...newTask(TaskId('newer-task'), { name: 'Newer task' }, new Date('2099-01-01T00:00:00.000Z')),
      state: 'paused' as const,
      members: [{ sessionId: source }],
    }
    await store.write(root, newer)

    const taken = await service.takeHandoff({ source, successor, cwd: root })
    expect(taken.task.id).toBe(newer.id)
  })

  it('fails loudly when the session belongs to no task in this project', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    await service.create(root, { name: 'Someone else\'s task' })
    await expect(service.takeHandoff({ source, successor, cwd: root }))
      .rejects.toThrow(/belongs to no task/)
  })

  it('fails loudly when the handoff document is missing', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const task = await service.create(root, { name: 'Orphan task' })
    await service.registerMember(root, task.id, source)
    await expect(service.takeHandoff({ source, successor, cwd: root }))
      .rejects.toThrow(/no handoff document/)
  })

  it('rewrites a document whose summary redaction changed, so file and prompt agree', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root))
    const secret = 'sk-live-0123456789abcdef'
    await writeSummary(prepared.path, `The deploy key is API_KEY=${secret}`)
    expect(await readFile(prepared.path, 'utf8')).toContain(secret)

    const taken = await service.takeHandoff({ source, successor, cwd: root })
    const rewritten = await readFile(prepared.path, 'utf8')
    const placeholder = `[redacted ${secret.length} chars]`

    expect(rewritten).not.toContain(secret)
    expect(rewritten).toContain(`API_KEY=${placeholder}`)
    expect(taken.prompt).not.toContain(secret)
    expect(taken.prompt).toContain(`API_KEY=${placeholder}`)
    expect(taken.document.body).toContain(`API_KEY=${placeholder}`)
    // The committed file is itself a document a later take can read, and it
    // carries the same redacted text the successor's prompt carries.
    const fileBody = parseHandoffDocument(rewritten, source).body
    expect(fileBody.trimStart()).toBe(taken.document.body.trimStart())
    expect(parseHandoffDocument(rewritten, source).task).toBe(prepared.task.id)
  })

  it('leaves a clean document alone', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root))
    await writeSummary(prepared.path, 'The store layer is next; the guard landed.')
    const before = await readFile(prepared.path, 'utf8')

    await service.takeHandoff({ source, successor, cwd: root })
    expect(await readFile(prepared.path, 'utf8')).toBe(before)
  })

  it('is idempotent, so a retried take cannot duplicate the member', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const prepared = await service.prepareHandoff(request(root))
    await writeSummary(prepared.path, 'continue the store work')
    const first = await service.takeHandoff({ source, successor, cwd: root })
    const second = await service.takeHandoff({ source, successor, cwd: root })
    expect(second.task).toEqual(first.task)
    expect(second.task.members).toHaveLength(2)
    expect(second.document.body).toContain('continue the store work')
  })
})

describe('plugin composition', () => {
  it('loads the store alone and registers /handoff only with the command half', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(StubCommands)
    await ctx.plugin(A2d2Service, { root })
    const stub = ctx.commands as unknown as StubCommands
    expect(stub.registered()).toEqual([])

    await ctx.plugin(commandPlugin)
    expect(stub.registered().map(definition => definition.name)).toEqual(['handoff'])
    const task = await ctx.a2d2.create(root, { name: 'Store only' })
    expect(task.id).toBe('store-only')
  })
})
