import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import { GitHubSource } from '../src/work-sources/github.ts'
it('identifies a Repo before confirmation and deduplicates canonical identity without starting work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'v4-source-'))
  const reads: string[] = []
  const adapter = new GitHubSource({ credential: async () => 'test', fetch: async input => {
    reads.push(String(input))
    return Response.json(String(input).endsWith('/user') ? { login: 'viewer', node_id: 'U1', name: null } : { node_id: 'R1', name: 'dsh-plugin', full_name: 'a2d2-dev/dsh-plugin', html_url: 'https://github.com/a2d2-dev/dsh-plugin', owner: { login: 'a2d2-dev' } })
  } })
  const app = new WorkApplication(directory, { resources: async () => [], sessions: async () => [] }, adapter)
  const actor = { operator: true }
  try {
    expect(await app.query({ type: 'source.identify', url: 'https://github.com/A2D2-DEV/DSH-PLUGIN/' }, actor)).toMatchObject({ status: 'completed', candidate: { kind: 'repository', title: 'a2d2-dev/dsh-plugin', nodeId: 'R1', identity: { login: 'viewer' } } })
    expect(await app.query({ type: 'projects.list' }, actor)).toMatchObject({ projects: [] })
    const first = await app.execute({ type: 'source.connect', commandId: 'repo', url: 'https://github.com/A2D2-DEV/DSH-PLUGIN/' }, actor)
    expect(first).toMatchObject({ status: 'completed', source: { repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' } } })
    if (first.status !== 'completed') throw Error(first.error.message)
    expect(await app.execute({ type: 'source.connect', commandId: 'repo-again', url: 'https://github.com/a2d2-dev/dsh-plugin' }, actor)).toMatchObject({ status: 'completed', source: { id: first.source!.id }, project: { id: first.project!.id } })
    expect(await app.query({ type: 'source.identify', url: 'https://github.com.evil.test/a/b' }, actor)).toMatchObject({ status: 'failed' })
    expect(reads.every(url => url.startsWith('https://api.github.com/'))).toBe(true)
  } finally {
    if (!directory.startsWith(join(tmpdir(), 'v4-source-'))) throw Error('Unsafe cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})
