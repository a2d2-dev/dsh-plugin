import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { GitHubPullRequest, SourceCatalog, WorkSource } from '../../src/work-sources/types.ts'
import type { TaskProgressView } from '../../src/work-progress.ts'

it('shows PR repository facts and resolves sessions from full related Issue identities across repositories', async () => {
  const observedAt = '2026-10-23T00:00:00Z'
  const progress = (repository: string, sessionId: string): TaskProgressView => ({
    ref: { projectId: 'p', taskId: repository }, title: repository, children: [],
    stage: 'in-progress', summary: 'Working', next: '', blockers: [], breakdown: [],
    criteria: { passed: 0, total: 1, assessed: 0, current: true },
    execution: { id: repository, session: { runtimeId: 'host', sessionId }, state: 'ready', runtime: 'idle' },
    source: { number: 5, url: `https://github.com/acme/${repository}/issues/5`, state: 'open', observedAt },
  })
  const pull = (repository: string, number: number, issueURL: string): GitHubPullRequest => ({
    nodeId: `PR-${number}`, number, title: `Change ${number}`, url: `https://github.com/acme/${repository}/pull/${number}`,
    repository: { owner: 'acme', repository }, state: 'open', draft: number === 1, updatedAt: observedAt,
    issues: [{ number: 5, url: issueURL, title: 'Related Issue' }], issuesComplete: true,
    checks: 'SUCCESS', review: 'APPROVED', membership: 'project',
  })
  const catalog: SourceCatalog = {
    observedAt, pullRequestsComplete: true, views: [], fields: [], viewsComplete: true, limitations: [],
    pullRequests: [
      pull('app', 1, 'https://github.com/ACME/APP/issues/5/'),
      pull('untracked', 2, 'https://github.com/acme/untracked/issues/5'),
      pull('contributor', 3, 'https://github.com/acme/app/issues/5'),
    ],
  }
  const source: WorkSource = { id: 's', projectId: 'p', provider: 'github', githubProject: { owner: 'acme', type: 'org', number: 9 }, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [], catalog }
  const command = vi.fn(async () => { throw Error('PR browsing must not write or start work') })
  const controller = new WorkPanelController({ command, query: async query => ({ status: 'completed',
    ...(query.type === 'projects.list' ? { projects: [{ id: 'p', name: 'Project', version: 1, defaultAgentId: 'a', resources: [] }] }
      : query.type === 'source.list' ? { sources: [source] }
      : query.type === 'source.catalog' ? { source, catalog }
      : query.type === 'project.detail' ? { tasks: [], progressItems: [progress('other', 'wrong'), progress('app', 'right')] }
      : {}),
  }) }, { selectPanel: () => {}, openSession: () => {} })
  await controller.load()
  await controller.selectSourceTab('prs')
  const html = renderToStaticMarkup(createElement(WorkPanel, { controller }))
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []
  const own = rows.find(row => row.includes('Change 1'))
  const unrelated = rows.find(row => row.includes('Change 2'))
  const crossRepository = rows.find(row => row.includes('Change 3'))
  expect(own).toContain('>acme/app #1 Change 1</a>')
  expect(own).toContain('session-right')
  expect(own).not.toContain('session-wrong')
  expect(own).toContain('草稿')
  expect(own).toContain('SUCCESS')
  expect(own).toContain('APPROVED')
  expect(unrelated).toContain('acme/untracked')
  expect(unrelated).not.toContain('session-right')
  expect(unrelated).not.toContain('session-wrong')
  expect(crossRepository).toContain('acme/contributor')
  expect(crossRepository).toContain('session-right')
  expect(html).toContain('引用不等于验收')
  expect(command).not.toHaveBeenCalled()
})
