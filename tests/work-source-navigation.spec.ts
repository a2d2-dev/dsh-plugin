import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import { createWorkClient } from '../src/client/work-api.ts'
import { WorkPanelController } from '../src/client/work-panel-controller.ts'
import type { GitHubIssue, GitHubSourcePort } from '../src/work-sources/types.ts'
import type { WorkCommand, WorkRequest, WorkResult } from '../src/work-types.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

// Real controller, HTTP codec, WorkApplication transactions and disk. Delay only
// delivery of a completed command response; the authorized write still commits.
async function withSource(run: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-source-navigation-'))
  const expected = resolve(directory)
  const fixture = await setup(directory)
  try { await run(fixture) } finally {
    fixture.release()
    expect(await realpath(directory)).toBe(expected)
    expect(directory.startsWith(join(tmpdir(), 'a2d2-source-navigation-'))).toBe(true)
    await rm(directory, { recursive: true, force: true })
  }
}
async function setup(directory: string) {
  const identity = { login: 'source-reader', nodeId: 'U1', name: null }
  const issue: GitHubIssue = { nodeId: 'I124', number: 124, title: 'Issue A', body: 'Accepted specification A', url: 'https://github.com/a2d2-dev/dsh-plugin/issues/124', repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' }, state: 'open', assignees: [], labels: [], updatedAt: '2026-10-20T00:00:00Z', observedAt: '2026-10-20T00:01:00Z' }
  const github: GitHubSourcePort = { list: async () => ({ identity, items: [issue], observedAt: issue.observedAt }), detail: async () => ({ identity, issue }) }
  const app = new WorkApplication(directory, { resources: async () => [], sessions: async () => [] }, github)
  const requests: WorkRequest[] = [], navigationEvents: unknown[] = []
  let delayed: { type: WorkCommand['type']; saved: ReturnType<typeof deferred<WorkResult>>; response: ReturnType<typeof deferred<void>> } | undefined
  const client = createWorkClient(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as WorkRequest
    requests.push(request)
    const result = request.kind === 'command' ? await app.execute(request.value, { operator: true }) : await app.query(request.value, { operator: true })
    if (request.kind === 'command' && request.value.type === delayed?.type) {
      delayed.saved.resolve(result)
      await delayed.response.promise
    }
    return Response.json(result)
  })
  const panel = new WorkPanelController(client, { selectPanel: id => { navigationEvents.push(['panel', id]) }, openSession: id => { navigationEvents.push(['session', id]) } })
  const project = (await panel.submit({ type: 'project.create', name: 'Navigation regression' })).project!
  const taskB = (await panel.submit({ type: 'task.create', projectId: project.id, title: 'Task B', goal: 'Keep B', specification: 'Local specification B', acceptance: ['Keep local acceptance'] })).task!
  await panel.load()
  await panel.configureSource('a2d2-dev', 'dsh-plugin')
  await panel.openIssue(124)
  return {
    panel, client, requests, navigationEvents, project, taskB,
    delay(type: WorkCommand['type']) {
      delayed = { type, saved: deferred<WorkResult>(), response: deferred<void>() }
      return { saved: delayed.saved.promise, release: () => { delayed?.response.resolve() } }
    },
    release: () => { delayed?.response.resolve() },
  }
}

describe('source receipts respect the latest public navigation', () => {
  it.each(['source.import', 'source.link', 'source.configure'] as const)('%s does not undo a newer selection or reload of the same project', async type => {
    for (const navigate of ['select', 'load'] as const) await withSource(async ({ panel, client, project, taskB, delay }) => {
      const receipt = delay(type)
      const pending = type === 'source.configure' ? panel.configureSource('another-owner', 'another-repo') : panel.acceptIssue(type === 'source.link' ? taskB : undefined)
      expect(await receipt.saved).toMatchObject({ status: 'completed' })
      if (navigate === 'select') await panel.selectProject(project.id)
      else await panel.load()
      const selected = panel.getSnapshot()
      receipt.release()
      await pending
      expect(panel.getSnapshot()).toMatchObject({ object: selected.object, detail: selected.detail, source: selected.source, error: selected.error, loading: false })
      if (type !== 'source.configure') expect(panel.getSnapshot().tasks).toEqual((await client.query({ type: 'project.detail', projectId: project.id })).tasks)
    })
  })
  it.each(['source.import', 'source.link', 'source.configure'] as const)('%s finishes saving without changing a closed panel or a native Session navigation', async type => {
    for (const exit of ['close', 'session'] as const) await withSource(async ({ panel, client, requests, navigationEvents, project, taskB, delay }) => {
      const receipt = delay(type)
      const pending = type === 'source.configure' ? panel.configureSource('another-owner', 'another-repo') : panel.acceptIssue(type === 'source.link' ? taskB : undefined)
      expect(await receipt.saved).toMatchObject({ status: 'completed' })
      if (exit === 'close') panel.close()
      else panel.openSession({ runtimeId: 'host-A', sessionId: 'native-session' })
      receipt.release()
      await pending
      expect(panel.getSnapshot()).toMatchObject({ object: 'issues', detail: null, loading: false, source: { issue: { number: 124 }, loading: false } })
      expect(navigationEvents).toEqual([exit === 'close' ? ['panel', null] : ['session', 'native-session']])
      if (type === 'source.configure') {
        expect((await client.query({ type: 'source.list', projectId: project.id })).sources).toHaveLength(2)
      } else {
        const tasks = (await client.query({ type: 'project.detail', projectId: project.id })).tasks!
        expect(tasks).toHaveLength(type === 'source.import' ? 2 : 1)
        const accepted = tasks.find(task => type === 'source.import' ? task.title === 'Issue A' : task.id === taskB.id)!
        expect((await client.query({ type: 'task.detail', ref: { projectId: project.id, taskId: accepted.id } })).bindings).toMatchObject([{ nodeId: 'I124' }])
      }
      const commands = requests.filter(request => request.kind === 'command' && request.value.type === type)
      expect(commands).toHaveLength(type === 'source.configure' ? 2 : 1)
    })
  })
  it('keeps same-project Task B when import A is saved but its response arrives after navigation', async () => {
    await withSource(async ({ panel, client, requests, project, taskB, delay }) => {
      const receipt = delay('source.import')
      const accepting = panel.acceptIssue()
      expect(await receipt.saved).toMatchObject({ status: 'completed', task: { title: 'Issue A' } })
      panel.setObject('projects')
      await panel.openTask({ projectId: project.id, taskId: taskB.id })
      panel.setDetailTab('sessions')
      receipt.release()
      await accepting
      expect(panel.getSnapshot()).toMatchObject({ object: 'projects', detail: { task: { id: taskB.id } }, detailTab: 'sessions', loading: false, error: null })
      expect(panel.getSnapshot().tasks.map(task => task.title)).toEqual(['Task B', 'Issue A'])
      expect((await client.query({ type: 'project.detail', projectId: project.id })).tasks?.map(task => task.title)).toEqual(['Task B', 'Issue A'])
      expect(requests.filter(request => request.value.type === 'source.import')).toHaveLength(1)
    })
  })
})
