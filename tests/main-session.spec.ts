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
