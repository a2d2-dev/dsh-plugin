/**
 * Counts synchronous filesystem accesses per path, for tests that pin how many
 * times one system prompt assembly touches each configuration file.
 *
 * Use from a spec with a hoisted partial mock:
 * `vi.mock('node:fs', async importOriginal => (await import('./fs-access.ts')).spyFs(await importOriginal()))`
 *
 * @module dsh-a2d2/tests/fs-access
 */

const WATCHED = ['existsSync', 'readFileSync', 'openSync', 'statSync', 'lstatSync', 'accessSync'] as const

const accesses: string[] = []

/** Wrap the watched `node:fs` functions so each call records its path argument. */
export function spyFs<T extends Record<string, unknown>>(actual: T): T {
  const spied: Record<string, unknown> = { ...actual }
  for (const name of WATCHED) {
    const original = actual[name] as (...args: unknown[]) => unknown
    spied[name] = (...args: unknown[]) => {
      accesses.push(String(args[0]))
      return original(...args)
    }
  }
  return spied as T
}

/** Forget every recorded access. */
export function resetAccesses(): void {
  accesses.length = 0
}

/** How many watched calls named this path since the last reset. */
export function accessCount(path: string): number {
  return accesses.filter(entry => entry === path).length
}
