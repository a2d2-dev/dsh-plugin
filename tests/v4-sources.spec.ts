import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import { GitHubSource, SourceError } from '../src/work-sources/github.ts'
import type { GitHubSourcePort, SourceCatalog } from '../src/work-sources/types.ts'
it('persists directory caches across restart and does not erase a separate Issue permission failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'v4-source-')), actor = { operator: true }
  const catalog: SourceCatalog = { observedAt: '2026-10-21T00:00:00Z', pullRequests: [], pullRequestsComplete: true, views: [], fields: [], viewsComplete: true, limitations: [], openIssueCount: 31 }
  let denied = false
  const port: GitHubSourcePort = { list: async () => { throw new SourceError('github-forbidden', 'Issue permission denied') }, detail: async () => { throw Error('unused') }, catalog: async () => { if (denied) throw new SourceError('github-offline', 'Directory offline'); return catalog } }
  const host = { resources: async () => [], sessions: async () => [] }
  const app = new WorkApplication(directory, host, port)
  try {
    const created = await app.execute({ type: 'project.create', commandId: 'p', name: 'Existing' }, actor)
    if (created.status !== 'completed') throw Error('Project failed')
    const configured = await app.execute({ type: 'source.configure', commandId: 's', projectId: created.project!.id, repository: { owner: 'acme', repository: 'app' } }, actor)
    if (configured.status !== 'completed') throw Error('Source failed')
    const scope = { projectId: created.project!.id, sourceId: configured.source!.id }
    await app.query({ type: 'source.issues', ...scope, page: 1, perPage: 20, assignee: '*', state: 'open', refresh: true }, actor)
    expect(await app.query({ type: 'source.catalog', ...scope, refresh: true }, actor)).toMatchObject({ status: 'completed', catalog, source: { lastError: { code: 'github-forbidden' } } })
    denied = true
    expect(await app.query({ type: 'source.catalog', ...scope, refresh: true }, actor)).toMatchObject({ status: 'failed', catalog, error: { code: 'github-offline' } })
    expect(await new WorkApplication(directory, host).query({ type: 'source.catalog', ...scope }, actor)).toMatchObject({ status: 'completed', catalog })
    expect(await app.query({ type: 'project.detail', projectId: scope.projectId }, actor)).toMatchObject({ tasks: [] })
  } finally { if (!directory.startsWith(join(tmpdir(), 'v4-source-'))) throw Error('Unsafe cleanup'); await rm(directory, { recursive: true, force: true }) }
})
it.each(['http://github.com/acme/app','https://github.com.evil.test/acme/app','https://user:pass@github.com/acme/app','https://github.com:444/acme/app','https://github.com/acme/app/issues/1','https://github.com/acme/app?redirect=https://evil.test','https://github.com/acme/%2fapp'])('rejects untrusted or non-source URL %s before external I/O', async url => {
  const adapter = new GitHubSource({ fetch: async () => { throw Error('Unexpected external I/O') }, graphql: async () => { throw Error('Unexpected external I/O') }, credential: async () => { throw Error('Unexpected credential access') } })
  await expect(adapter.identify(url)).rejects.toMatchObject({ code: 'github-invalid-url' })
})
it.each(['org','user'] as const)('preserves %s Project view and slice entry URLs while reusing one source after restart', async type => {
  const directory = await mkdtemp(join(tmpdir(), 'v4-source-')), actor = { operator: true }, host = { resources: async () => [], sessions: async () => [] }
  const base = `https://github.com/${type === 'org' ? 'orgs' : 'users'}/acme/projects/14`
  const adapter = new GitHubSource({ graphql: async () => ({ data: { viewer: { id: 'U', login: 'viewer', name: null }, [type === 'org' ? 'organization' : 'user']: { projectV2: { id: 'P14', title: 'Real title', url: base, closed: false, items: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } }) })
  const app = new WorkApplication(directory, host, adapter)
  try {
    const urls = [`${base}/views/8?filterQuery=assignee%3A%40me`, `${base}/views/9?sliceBy=status&sliceValue=Ready`]
    const first = await app.execute({ type: 'source.connect', commandId: 'view', url: urls[0] }, actor)
    expect(first).toMatchObject({ status: 'completed', source: { entryUrls: [urls[0]], githubProject: { type, number: 14 } } })
    const next = await app.execute({ type: 'source.connect', commandId: 'slice', url: urls[1] }, actor)
    expect(next).toMatchObject({ status: 'completed', source: { id: first.source!.id, entryUrls: urls } })
    expect(await new WorkApplication(directory, host).query({ type: 'source.list', projectId: first.source!.projectId }, actor)).toMatchObject({ sources: [{ id: first.source!.id, entryUrls: urls }] })
  } finally { if (!directory.startsWith(join(tmpdir(), 'v4-source-'))) throw Error('Unsafe cleanup'); await rm(directory, { recursive: true, force: true }) }
})
it('identifies a Repo before confirmation and deduplicates canonical identity without starting work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'v4-source-'))
  const reads: string[] = []
  let repositoryName = 'dsh-plugin'
  const adapter = new GitHubSource({ credential: async () => 'test', fetch: async input => {
    reads.push(String(input))
    return Response.json(String(input).endsWith('/user') ? { login: 'viewer', node_id: 'U1', name: null } : { node_id: 'R1', name: repositoryName, full_name: `a2d2-dev/${repositoryName}`, html_url: `https://github.com/a2d2-dev/${repositoryName}`, owner: { login: 'a2d2-dev' } })
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
    repositoryName = 'renamed-plugin'
    expect(await app.execute({ type: 'source.connect', commandId: 'renamed', url: 'https://github.com/a2d2-dev/renamed-plugin' }, actor)).toMatchObject({ status: 'completed', source: { id: first.source!.id, version: 2, repository: { owner: 'a2d2-dev', repository: 'renamed-plugin' } } })
    expect(reads.every(url => url.startsWith('https://api.github.com/'))).toBe(true)
  } finally {
    if (!directory.startsWith(join(tmpdir(), 'v4-source-'))) throw Error('Unsafe cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})
