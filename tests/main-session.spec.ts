/**
 * Main sessions: binding a session as the main session of a task issue, the
 * task document that records it, and the queries other plugins ask about it.
 *
 * Every test goes through the mounted `ctx.a2d2` service over a real temporary
 * project, so the store, the document files, and their validation stay real.
 *
 * @module dsh-a2d2/tests/main-session
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service from '../src/index.ts'
import { TaskId } from '../src/brand.ts'
import { tasksDirectory } from '../src/store.ts'

const roots: string[] = []
const sessionA = SessionId('session-a')
const sessionB = SessionId('session-b')

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-main-session-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/**
 * Mount the real task service over a project root.
 * @param root - the project root the store is pinned to.
 * @returns the mounted service.
 */
async function mount(root: string): Promise<A2d2Service> {
  const ctx = new Context()
  await ctx.plugin(A2d2Service, { root })
  return ctx.a2d2
}

/** Put a hand-written task document into the project, the way a person or an older build left it. */
async function writeDocument(root: string, id: string, text: string): Promise<string> {
  const path = join(tasksDirectory(root), `${id}.yaml`)
  await mkdir(tasksDirectory(root), { recursive: true })
  await writeFile(path, text, 'utf8')
  return path
}

const LEGACY_DOCUMENT = [
  'version: 1',
  'id: legacy',
  'name: Legacy task',
  'state: active',
  'createdAt: 2026-09-20T00:00:00.000Z',
  'sessions:',
  '  - id: session-a',
  '',
].join('\n')

describe('version 1 task documents', () => {
  it('reads as a task bound to no task issue and is written back as version 2', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const path = await writeDocument(root, 'legacy', LEGACY_DOCUMENT)

    const legacy = await service.readTask(root, TaskId('legacy'))
    expect(legacy).toEqual({
      id: 'legacy',
      name: 'Legacy task',
      state: 'active',
      createdAt: '2026-09-20T00:00:00.000Z',
      members: [{ sessionId: sessionA }],
    })

    const rewritten = await service.registerMember(root, TaskId('legacy'), sessionB, sessionA)
    expect(await readFile(path, 'utf8')).toMatch(/^version: 2$/m)
    expect(rewritten).not.toHaveProperty('issue')
    expect(await service.readTask(root, TaskId('legacy'))).toEqual(rewritten)
  })
})

describe('bindMainSession', () => {
  it('writes the task issue\'s document, named after the issue, recording the main session and its parent', async () => {
    const root = await tempRoot()
    const service = await mount(root)

    const task = await service.bindMainSession({
      cwd: root,
      issue: 45,
      parentIssue: 41,
      title: 'Bind the main session',
      mainSession: sessionA,
      now: new Date('2026-10-01T10:00:00.000Z'),
    })

    expect(task).toEqual({
      id: 'issue-45',
      issue: { number: 45, parent: 41, mainSession: sessionA },
      name: 'Bind the main session',
      state: 'active',
      createdAt: '2026-10-01T10:00:00.000Z',
      members: [{ sessionId: sessionA }],
    })
    const document = await readFile(join(tasksDirectory(root), 'issue-45.yaml'), 'utf8')
    expect(document).toContain('mainSession: session-a')
    expect(await service.readTask(root, TaskId('issue-45'))).toEqual(task)
  })

  it('refuses another session while the task issue has a main session, saying which one and why', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const bound = await service.bindMainSession({ cwd: root, issue: 45, mainSession: sessionA, now: new Date() })

    await expect(service.bindMainSession({ cwd: root, issue: 45, mainSession: sessionB, now: new Date() }))
      .rejects.toThrow(/task issue #45 already has main session "session-a".*handoff/)
    expect(await service.readTask(root, TaskId('issue-45'))).toEqual(bound)
  })

  it('accepts the same main session binding again and leaves the document as it was', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    const bound = await service.bindMainSession({ cwd: root, issue: 45, parentIssue: 41, mainSession: sessionA, now: new Date('2026-10-01T10:00:00.000Z') })

    const again = await service.bindMainSession({ cwd: root, issue: 45, parentIssue: 41, mainSession: sessionA, now: new Date('2026-10-02T10:00:00.000Z') })

    expect(again).toEqual(bound)
    expect(await service.readTask(root, TaskId('issue-45'))).toEqual(bound)
  })

  it('refuses a binding again that names a different parent task issue', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 45, parentIssue: 41, mainSession: sessionA, now: new Date() })

    await expect(service.bindMainSession({ cwd: root, issue: 45, parentIssue: 40, mainSession: sessionA, now: new Date() }))
      .rejects.toThrow(/task issue #45 records parent #41, not #40/)
    await expect(service.bindMainSession({ cwd: root, issue: 45, mainSession: sessionA, now: new Date() }))
      .rejects.toThrow(/task issue #45 records parent #41, not none/)
  })

  it('refuses a task issue whose identity a task bound to no task issue already uses', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    await writeDocument(root, 'issue-45', LEGACY_DOCUMENT.replace('id: legacy', 'id: issue-45'))

    await expect(service.bindMainSession({ cwd: root, issue: 45, mainSession: sessionA, now: new Date() }))
      .rejects.toThrow(/task "issue-45" exists but is bound to no task issue/)
  })

  it('refuses a session that is already the main session of another task issue', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 44, mainSession: sessionA, now: new Date() })

    await expect(service.bindMainSession({ cwd: root, issue: 45, mainSession: sessionA, now: new Date() }))
      .rejects.toThrow(/session "session-a" is already the main session of task issue #44/)
    expect(await service.mainSessionOfIssue(root, 45)).toBeUndefined()
  })

  it('refuses a task issue or a parent that is not a positive integer, writing nothing', async () => {
    const root = await tempRoot()
    const service = await mount(root)

    await expect(service.bindMainSession({ cwd: root, issue: 0, mainSession: sessionA, now: new Date() }))
      .rejects.toThrow(/positive integer, received 0/)
    await expect(service.bindMainSession({ cwd: root, issue: 45, parentIssue: -1, mainSession: sessionA, now: new Date() }))
      .rejects.toThrow(/positive integer, received -1/)
    expect(await service.list(root)).toEqual([])
  })

  it('refuses a session that records no working directory, since no project can hold its task', async () => {
    const root = await tempRoot()
    const service = await mount(root)

    await expect(service.bindMainSession({ cwd: '', issue: 45, mainSession: sessionA, now: new Date() }))
      .rejects.toThrow(/records no working directory/)
  })
})

describe('main session queries', () => {
  it('answer which task a session is the main session of, and which session is a task issue\'s main session', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    await writeDocument(root, 'legacy', LEGACY_DOCUMENT)
    const parent = await service.bindMainSession({ cwd: root, issue: 41, mainSession: sessionB, now: new Date() })
    const child = await service.bindMainSession({ cwd: root, issue: 45, parentIssue: 41, mainSession: SessionId('session-c'), now: new Date() })

    expect(await service.taskOfMainSession(root, sessionB)).toEqual(parent)
    expect(await service.taskOfMainSession(root, SessionId('session-c'))).toEqual(child)
    // A member of a task bound to no task issue is not a main session.
    expect(await service.taskOfMainSession(root, sessionA)).toBeUndefined()

    expect(await service.mainSessionOfIssue(root, 41)).toBe(sessionB)
    expect(await service.mainSessionOfIssue(root, 45)).toBe('session-c')
    expect(await service.mainSessionOfIssue(root, 46)).toBeUndefined()
  })
})

/** A version 2 document bound to task issue #45, with the given `issue` mapping lines. */
function boundDocument(id: string, issueLines: readonly string[]): string {
  return [
    'version: 2',
    `id: ${id}`,
    'name: Bind the main session',
    'state: active',
    'createdAt: 2026-10-01T00:00:00.000Z',
    'issue:',
    ...issueLines.map(line => `  ${line}`),
    'sessions:',
    '  - id: session-a',
    '',
  ].join('\n')
}

describe('version 2 task documents', () => {
  it('read the task issue, its parent, its main session, and a prepared handoff', async () => {
    const root = await tempRoot()
    const service = await mount(root)
    await writeDocument(root, 'issue-45', boundDocument('issue-45', [
      'number: 45',
      'parent: 41',
      'mainSession: session-a',
      'handoff:',
      '  source: session-a',
    ]))

    expect((await service.readTask(root, TaskId('issue-45')))?.issue).toEqual({
      number: 45,
      parent: 41,
      mainSession: sessionA,
      handoff: { source: sessionA },
    })
  })

  it.each([
    ['a task issue number that is not a positive integer', 'issue-45', ['number: 4.5', 'mainSession: session-a'], /issue\.number must be a positive integer/],
    ['a parent that is not a positive integer', 'issue-45', ['number: 45', 'parent: "41"', 'mainSession: session-a'], /issue\.parent must be a positive integer/],
    ['an id that is not the task issue identity', 'demo', ['number: 45', 'mainSession: session-a'], /task issue #45 is identified as "issue-45"/],
    ['a main session that is not a member session', 'issue-45', ['number: 45', 'mainSession: session-z'], /main session "session-z" is not one of its sessions/],
    ['a handoff without its source', 'issue-45', ['number: 45', 'mainSession: session-a', 'handoff: {}'], /source must be a non-empty string/],
  ])('refuse %s', async (_case, id, issueLines, message) => {
    const root = await tempRoot()
    const service = await mount(root)
    await writeDocument(root, id, boundDocument(id, issueLines))

    await expect(service.list(root)).rejects.toThrow(message)
  })
})
