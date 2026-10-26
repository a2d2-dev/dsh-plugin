import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { WorkApplication } from '../src/work.ts'
import { installWorkTools } from '../src/work-execution/tools.ts'
import type { GitHubIssue, GitHubSourcePort } from '../src/work-sources/types.ts'
import type { WorkResult, WorkTask } from '../src/work-types.ts'
const operator = { operator: true }
const ok = (result: WorkResult) => { if (result.status !== 'completed') throw Error(JSON.stringify(result)); return result }
const repository = { owner: 'example', repository: 'repo' }
const identity = { login: 'developer', nodeId: 'U_developer', name: null }
const issue = (number: number): GitHubIssue => ({ nodeId: `I_${number}`, number, title: `Work ${number}`, body: 'verify', url: `https://github.com/example/repo/issues/${number}`, repository, state: 'open', labels: [], assignees: [], observedAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', subIssues: { items: [], totalCount: 0, hasNextPage: false } })
const reference = ({ nodeId, number, title, url, repository, state }: GitHubIssue) => ({ nodeId, number, title, url, repository, state })
async function setup(fixtures: ExecutionFixtures) {
  const h = await fixtures.mount(await fixtures.root(), 'read-only')
  const parent = issue(1), child = issue(2)
  const source: GitHubSourcePort = { list: async () => ({ identity, items: [parent, child], observedAt: parent.observedAt }), detail: async (_, number) => ({ identity, issue: number === 1 ? parent : child }) }
  const app = new WorkApplication(h.app.directory, h.host, source)
  installWorkTools(h.ctx, app, 'runtime')
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const project = ok(await app.execute({ type: 'project.create', commandId: 'project', name: 'freeze', resource }, operator)).project!
  const configured = ok(await app.execute({ type: 'source.configure', commandId: 'source', projectId: project.id, repository }, operator)).source!
  const refresh = async () => ok(await app.query({ type: 'source.issues', projectId: project.id, sourceId: configured.id, page: 1, perPage: 20, assignee: '*', state: 'all', refresh: true }, operator))
  await refresh()
  const imported = async (issue: GitHubIssue, commandId: string) => ok(await app.execute({ type: 'source.import', commandId, projectId: project.id, sourceId: configured.id, nodeId: issue.nodeId }, operator))
  const detail = async (task: WorkTask) => ok(await app.query({ type: 'task.detail', ref: { projectId: task.projectId, taskId: task.id } }, operator))
  const start = async (task: WorkTask) => {
    const execution = ok(await app.execute({ type: 'task.start', commandId: `start:${task.id}`, ref: { projectId: task.projectId, taskId: task.id }, expectedVersion: task.version, agentId: task.agentId, resource, agentPreset: 'contract', model: { provider: 'contract', model: 'default' }, permissionPreset: 'read-only' }, operator)).execution!
    await fixtures.run(() => h.ctx.agents.get(SessionId(execution.session.sessionId))!.whenIdle())
    ok(await app.sessionOrganize(execution.session, 'specification', { kind: 'specification', expectedVersion: (await detail(task)).task!.version, goal: 'verify', specification: 'verify', acceptance: ['verified'] }))
    return execution
  }
  const relate = async () => { parent.subIssues = { items: [reference(child)], totalCount: 1, hasNextPage: false }; child.parent = reference(parent); await refresh() }
  return { ...h, app, parent, child, project, configured, refresh, imported, detail, start, relate }
}
it('imports a real native child after parent acceptance without changing either frozen business edge', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await setup(fixtures)
    const parent = (await h.imported(h.parent, 'parent')).task!
    const execution = await h.start(parent)
    ok(await h.app.sessionReport(execution.session, 'accepted', { specificationVersion: 2, stage: 'done', summary: 'verified', next: '', blockers: [], criteria: [{ index: 0, passed: true, evidence: ['verified'] }] }))
    const before = (await h.detail(parent)).task!
    await h.relate()
    const imported = await h.imported(h.child, 'child-after-done')
    expect((await h.detail(parent)).task).toEqual(before)
    expect(imported.task!.parent).toBeUndefined()
    expect(imported.binding!.lastObserved.parent!.nodeId).toBe(h.parent.nodeId)
    expect(imported.binding!.hierarchyWarnings).toContainEqual(expect.objectContaining({ code: 'source-hierarchy-frozen', reason: 'task-completed' }))
    expect((await h.detail(parent)).executionGraph!.limitations.join('\n')).toContain('source-hierarchy-frozen')
    expect((await h.detail(parent)).execution).toMatchObject({ id: execution.id, owner: execution.owner, session: execution.session })
    const replay = await h.imported(h.child, 'child-after-done')
    expect(replay.task!.id).toBe(imported.task!.id)
    expect(ok(await h.app.query({ type: 'project.detail', projectId: h.project.id }, operator)).tasks).toHaveLength(2)
  } finally { await fixtures.close() }
})

it('imports the native parent of an accepted child while retaining child completion and both original business edges', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await setup(fixtures)
    const child = (await h.imported(h.child, 'child')).task!
    const execution = await h.start(child)
    ok(await h.app.sessionReport(execution.session, 'accepted', { specificationVersion: 2, stage: 'done', summary: 'verified', next: '', blockers: [], criteria: [{ index: 0, passed: true, evidence: ['verified'] }] }))
    const before = (await h.detail(child)).task!
    await h.relate()
    const imported = await h.imported(h.parent, 'parent-after-child-done')
    expect((await h.detail(child)).task).toEqual(before)
    expect(imported.task!.children).toEqual([])
    expect(imported.binding!.lastObserved.subIssues!.items[0]!.nodeId).toBe(h.child.nodeId)
    expect(imported.binding!.hierarchyWarnings).toContainEqual(expect.objectContaining({ code: 'source-hierarchy-frozen', reason: 'task-completed' }))
    expect((await h.detail(child)).execution).toMatchObject({ id: execution.id, owner: execution.owner, session: execution.session })
  } finally { await fixtures.close() }
})
it.for(['parent', 'child'] as const)('preserves both relation endpoints while the %s is handing off and still imports the other canonical Task', async (side, { signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await setup(fixtures)
    const frozen = (await h.imported(h[side], 'frozen')).task!
    const execution = await h.start(frozen)
    const continuing = ok(await h.app.execute({ type: 'task.continue', commandId: 'continue', ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }, operator)).execution!
    expect(continuing.continuation!.phase).not.toBe('delivered')
    await fixtures.run(() => h.ctx.agents.get(SessionId(execution.session.sessionId))!.whenIdle())
    const before = (await h.detail(frozen)).task!
    await h.relate()
    const other = await h.imported(h[side === 'parent' ? 'child' : 'parent'], 'import-during-handoff')
    expect((await h.detail(frozen)).task).toEqual(before)
    expect(other.task!.parent).toBeUndefined()
    expect(other.task!.children).toEqual([])
    expect(other.binding!.hierarchyWarnings).toContainEqual(expect.objectContaining({ code: 'source-hierarchy-frozen', reason: 'continuation-in-progress' }))
    expect(await h.app.execute({ type: 'source.link', commandId: 'link-during-handoff', ref: execution.ref, expectedVersion: before.version, sourceId: h.configured.id, nodeId: h[side].nodeId }, operator)).toMatchObject({ status: 'failed', error: { code: 'continuation-in-progress' } })
    const after = (await h.detail(frozen)).execution!
    expect(after).toMatchObject({ id: execution.id, owner: execution.owner, epoch: execution.epoch, session: execution.session, continuation: { operationId: continuing.continuation!.operationId, successor: continuing.continuation!.successor } })
    expect((await h.imported(h[side === 'parent' ? 'child' : 'parent'], 'replay-during-handoff')).task!.id).toBe(other.task!.id)
    ok(await h.app.sessionContinuationMaterial(execution.session, 'material', { body: 'Preserve the accepted native source scope.', decisions: 'Keep the original Task and required scope.', evidence: 'Source relation observed while handoff was frozen.', unfinished: 'Accept the observed relation after takeover.', next: 'Re-import the related canonical Task.' }))
    await h.app.reconcileControls()
    const successor = (await h.detail(frozen)).execution!
    expect(successor.continuation!.phase).toBe('delivered')
    await h.imported(h[side], 'observe-before-readable')
    expect((await h.detail(frozen)).executionGraph!.limitations.join('\n')).toContain('source-hierarchy-frozen')
    await fixtures.run(() => h.ctx.agents.get(SessionId(successor.session.sessionId))!.whenIdle())
    await fixtures.run(() => h.app.reconcileControls())
    expect((await h.detail(frozen)).execution!.continuation!.phase).toBe('received')
    await fixtures.run(() => h.ctx.agents.get(SessionId(successor.session.sessionId))!.whenIdle())
    await h.imported(h[side], 'accept-after-handoff')
    expect((await h.detail(frozen)).executionGraph!.limitations.join('\n')).not.toContain('source-hierarchy-frozen')
    expect((await h.detail(other.task!)).executionGraph!.limitations.join('\n')).not.toContain('source-hierarchy-frozen')
  } finally { await fixtures.close() }
})
it('keeps normal mutable native relations atomic and idempotent on repeated accepted observations', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await setup(fixtures)
    const parent = (await h.imported(h.parent, 'parent')).task!, child = (await h.imported(h.child, 'child')).task!
    await h.relate()
    await h.imported(h.child, 'accept-relationship')
    const linkedParent = (await h.detail(parent)).task!, linkedChild = (await h.detail(child)).task!
    expect(linkedParent.children).toEqual([{ projectId: child.projectId, taskId: child.id }])
    expect(linkedChild.parent).toEqual({ projectId: parent.projectId, taskId: parent.id })
    await h.imported(h.child, 'accept-relationship')
    await h.imported(h.parent, 'reobserve-relationship')
    expect((await h.detail(parent)).task).toEqual(linkedParent)
    expect((await h.detail(child)).task).toEqual(linkedChild)
    expect((await h.detail(parent)).bindings![0]!.hierarchyWarnings).toBeUndefined()
  } finally { await fixtures.close() }
})
it('applies the same child handoff guard to an explicit local link command', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await setup(fixtures)
    const parent = (await h.imported(h.parent, 'parent')).task!, child = (await h.imported(h.child, 'child')).task!
    const execution = await h.start(child)
    ok(await h.app.execute({ type: 'task.continue', commandId: 'continue', ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }, operator))
    const current = (await h.detail(child)).task!
    expect(await h.app.execute({ type: 'task.link-child', commandId: 'local-link', ref: { projectId: parent.projectId, taskId: parent.id }, expectedVersion: parent.version, child: execution.ref, childExpectedVersion: current.version }, operator)).toMatchObject({ status: 'failed', error: { code: 'continuation-in-progress' } })
    expect((await h.detail(parent)).task!.children).toEqual([])
    expect((await h.detail(child)).task!.parent).toBeUndefined()
  } finally { await fixtures.close() }
})
