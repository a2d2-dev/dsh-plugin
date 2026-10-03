/**
 * Shared project-local file reader: every plugin read of a project or global
 * file goes through one guarded function, so oversized files, symbolic links,
 * and directories surface as named problems instead of crashes or silent data.
 *
 * @module dsh-a2d2/tests/local-file
 */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskId } from '../src/brand.ts'
import {
  LOCAL_FILE_MAX_BYTES,
  LocalFileError,
  readLocalFile,
  readLocalFileSync,
} from '../src/local-file.ts'
import { SessionAgentStore, sessionAgentsFile } from '../src/session-agents.ts'
import { TaskDocumentStore, readHandoffDocument, tasksDirectory } from '../src/store.ts'
import { handoffDocumentName } from '../src/handoff-document.ts'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-local-file-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function store(root: string): TaskDocumentStore {
  return new TaskDocumentStore({ root, projectMarkers: ['.git'] })
}

async function writeOversized(path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, 'x'.repeat(LOCAL_FILE_MAX_BYTES + 1), 'utf8')
}

describe('oversized local files', () => {
  it('reports a file over the size limit as too large, sync and async', async () => {
    const root = await tempRoot()
    const path = join(root, 'big.md')
    await writeOversized(path)

    for (const result of [readLocalFileSync(path), await readLocalFile(path)]) {
      expect(result.kind).toBe('unreadable')
      if (result.kind !== 'unreadable') continue
      expect(result.problem).toBe('too-large')
      expect(result.message).toContain(String(LOCAL_FILE_MAX_BYTES))
    }
  })

  it('refuses an oversized task document instead of parsing it', async () => {
    const root = await tempRoot()
    await writeOversized(join(tasksDirectory(root), 'big.yaml'))

    await expect(store(root).read(root, TaskId('big'))).rejects.toBeInstanceOf(LocalFileError)
    await expect(store(root).list(root)).rejects.toThrow(/too large/)
  })

  it('refuses an oversized session Agent ledger', async () => {
    const root = await tempRoot()
    await writeOversized(sessionAgentsFile(root))

    await expect(new SessionAgentStore().read(root)).rejects.toThrow(LocalFileError)
  })

  it('refuses an oversized handoff document', async () => {
    const root = await tempRoot()
    const directory = join(root, 'handoffs')
    await writeOversized(join(directory, handoffDocumentName(SessionId('session-big'))))

    await expect(readHandoffDocument(directory, SessionId('session-big'))).rejects.toThrow(LocalFileError)
  })
})

describe('symbolic links', () => {
  it('reports a symbolic link as a symlink rather than following it, sync and async', async () => {
    const root = await tempRoot()
    const target = join(root, 'target.md')
    await writeFile(target, 'secret elsewhere', 'utf8')
    const link = join(root, 'link.md')
    await symlink(target, link)

    for (const result of [readLocalFileSync(link), await readLocalFile(link)]) {
      expect(result).toMatchObject({ kind: 'unreadable', problem: 'symlink' })
    }
  })

  it('reports a dangling symbolic link as a symlink, not as a missing file', async () => {
    const root = await tempRoot()
    const link = join(root, 'dangling.md')
    await symlink(join(root, 'nowhere.md'), link)

    for (const result of [readLocalFileSync(link), await readLocalFile(link)]) {
      expect(result).toMatchObject({ kind: 'unreadable', problem: 'symlink' })
    }
  })

  it('refuses a symlinked task document and session Agent ledger', async () => {
    const root = await tempRoot()
    const outside = join(root, 'outside.yaml')
    await writeFile(outside, 'version: 1\nsessions: []\n', 'utf8')
    await mkdir(tasksDirectory(root), { recursive: true })
    await symlink(outside, join(tasksDirectory(root), 'linked.yaml'))
    await symlink(outside, sessionAgentsFile(root))

    await expect(store(root).read(root, TaskId('linked'))).rejects.toThrow(/symbolic link/)
    await expect(new SessionAgentStore().read(root)).rejects.toThrow(/symbolic link/)
  })
})

describe('directories', () => {
  it('reports a directory as unreadable rather than throwing, sync and async', async () => {
    const root = await tempRoot()
    const path = join(root, 'SOUL.md')
    await mkdir(path)

    for (const result of [readLocalFileSync(path), await readLocalFile(path)]) {
      expect(result).toMatchObject({ kind: 'unreadable', problem: 'directory' })
      if (result.kind === 'unreadable') expect(result.message).toContain('path is a directory')
    }
  })

  it('refuses a task document path that is a directory with a named problem', async () => {
    const root = await tempRoot()
    await mkdir(join(tasksDirectory(root), 'folder.yaml'), { recursive: true })

    await expect(store(root).read(root, TaskId('folder'))).rejects.toMatchObject({ name: 'LocalFileError', problem: 'directory' })
  })

  it('reports a FIFO as not a regular file without blocking on it', async () => {
    const root = await tempRoot()
    const path = join(root, 'pipe.yaml')
    execFileSync('mkfifo', [path])

    for (const result of [readLocalFileSync(path), await readLocalFile(path)]) {
      expect(result).toMatchObject({ kind: 'unreadable', problem: 'not-regular-file' })
    }
  })
})
