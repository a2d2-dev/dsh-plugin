/**
 * The GitHub repository a session's working directory belongs to, read from
 * its `origin` remote. Shared by the GitHub watch (default `repo`) and wait
 * notices (task issue links).
 *
 * @module @a2d2/dsh-a2d2/src/github-remote
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** `owner/name` of the session's `origin` remote on github.com. */
export async function repoOfCwd(cwd: string): Promise<string | undefined> {
  if (cwd === '') return undefined
  try {
    const { stdout } = await run('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { timeout: 10_000 })
    return parseGitHubRemote(stdout.trim())
  } catch {
    return undefined
  }
}

/** Parse `git@github.com:o/n.git`, `https://github.com/o/n`, `ssh://git@github.com/o/n.git`. */
export function parseGitHubRemote(url: string): string | undefined {
  const match = /github\.com[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url)
  return match ? `${match[1]}/${match[2]}` : undefined
}
