/**
 * Guarded reads of project-local and global plugin files.
 *
 * Every file the plugin reads from a project tree or the user's `~/.dsh`
 * (task documents, handoff documents, the session Agent ledger, CEO method and
 * SOUL files, engineer/reviewer configuration) goes through this module. A
 * project tree is checked-out content the plugin does not control, so a read
 * is bounded in size and each problem comes back as a named result rather than
 * an exception from deep inside prompt assembly or a silent empty string.
 *
 * @module @deepseek-ai/dsh-a2d2/src/local-file
 */

import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { lstat, open } from 'node:fs/promises'

/**
 * Largest file the plugin reads, in bytes (1 MiB).
 *
 * The biggest legitimate files are handoff documents and prompt markdown, which
 * stay in the tens of kilobytes; 1 MiB leaves an order of magnitude of headroom
 * while keeping a stray or hostile file from being loaded into memory or into
 * every system prompt.
 */
export const LOCAL_FILE_MAX_BYTES = 1024 * 1024

/** Why an existing path could not be read as a plugin file. */
export type LocalFileProblem = 'too-large' | 'symlink' | 'error'

/** Outcome of one guarded read. */
export type LocalFileRead =
  | { readonly kind: 'file'; readonly text: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly problem: LocalFileProblem; readonly message: string }

/** A plugin file that exists but must not be used, raised by {@link requireLocalFile}. */
export class LocalFileError extends Error {
  override readonly name = 'LocalFileError'
  readonly path: string
  readonly problem: LocalFileProblem

  constructor(path: string, problem: LocalFileProblem, message: string) {
    super(`a2d2: cannot read "${path}": ${message}`)
    this.path = path
    this.problem = problem
  }
}

/** Options of a guarded read. */
export interface LocalFileReadOptions {
  /** Size limit in bytes; defaults to {@link LOCAL_FILE_MAX_BYTES}. */
  readonly maxBytes?: number
}

/**
 * Open flags: read-only, never through a symbolic link as the last path
 * component, and never blocking on a FIFO planted where a file is expected.
 * Platforms without `O_NOFOLLOW` (Windows) fall back to an `lstat` check.
 */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
const CHECK_LINK_BEFORE_OPEN = constants.O_NOFOLLOW === undefined

const SYMLINK: LocalFileRead = { kind: 'unreadable', problem: 'symlink', message: 'path is a symbolic link; the plugin only reads regular files' }

function tooLarge(maxBytes: number): LocalFileRead {
  return { kind: 'unreadable', problem: 'too-large', message: `file is too large (over ${maxBytes} bytes)` }
}

function fromOpenError(error: unknown): LocalFileRead {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' }
  // O_NOFOLLOW on a symbolic link fails with ELOOP (Linux, macOS) or EMLINK (FreeBSD).
  if (code === 'ELOOP' || code === 'EMLINK') return SYMLINK
  return { kind: 'unreadable', problem: 'error', message: (error as Error).message }
}

/**
 * Read one plugin file synchronously, for callers such as system prompt text
 * providers that cannot await.
 * @param path - absolute file path.
 * @param options - optional size limit.
 * @returns the text, `missing`, or the named reason it is unreadable.
 */
export function readLocalFileSync(path: string, options: LocalFileReadOptions = {}): LocalFileRead {
  const maxBytes = options.maxBytes ?? LOCAL_FILE_MAX_BYTES
  let fd: number
  try {
    if (CHECK_LINK_BEFORE_OPEN && lstatSync(path).isSymbolicLink()) return SYMLINK
    fd = openSync(path, OPEN_FLAGS)
  } catch (error) {
    return fromOpenError(error)
  }
  try {
    if (fstatSync(fd).size > maxBytes) return tooLarge(maxBytes)
    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let length = 0
    for (;;) {
      const read = readSync(fd, buffer, length, buffer.length - length, null)
      if (read === 0) break
      length += read
      if (length > maxBytes) return tooLarge(maxBytes)
    }
    return { kind: 'file', text: buffer.toString('utf8', 0, length) }
  } catch (error) {
    return { kind: 'unreadable', problem: 'error', message: (error as Error).message }
  } finally {
    closeSync(fd)
  }
}

/**
 * Read one plugin file.
 * @param path - absolute file path.
 * @param options - optional size limit.
 * @returns the text, `missing`, or the named reason it is unreadable.
 */
export async function readLocalFile(path: string, options: LocalFileReadOptions = {}): Promise<LocalFileRead> {
  const maxBytes = options.maxBytes ?? LOCAL_FILE_MAX_BYTES
  let handle: Awaited<ReturnType<typeof open>>
  try {
    if (CHECK_LINK_BEFORE_OPEN && (await lstat(path)).isSymbolicLink()) return SYMLINK
    handle = await open(path, OPEN_FLAGS)
  } catch (error) {
    return fromOpenError(error)
  }
  try {
    if ((await handle.stat()).size > maxBytes) return tooLarge(maxBytes)
    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let length = 0
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
      if (bytesRead === 0) break
      length += bytesRead
      if (length > maxBytes) return tooLarge(maxBytes)
    }
    return { kind: 'file', text: buffer.toString('utf8', 0, length) }
  } catch (error) {
    return { kind: 'unreadable', problem: 'error', message: (error as Error).message }
  } finally {
    await handle.close()
  }
}

/**
 * Turn a guarded read into the text or `undefined` for a missing file, raising
 * every other outcome so a broken file is never mistaken for an absent one.
 * @param path - the path that was read, named in the error.
 * @param result - the guarded read.
 * @returns the text, or `undefined` when the file does not exist.
 * @throws LocalFileError when the path exists but is unreadable.
 */
export function requireLocalFile(path: string, result: LocalFileRead): string | undefined {
  if (result.kind === 'file') return result.text
  if (result.kind === 'missing') return undefined
  throw new LocalFileError(path, result.problem, result.message)
}
