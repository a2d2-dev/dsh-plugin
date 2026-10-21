import { expect, it } from 'vitest'
import { buildExecutionGraph } from '../src/work-execution/observation.ts'
import type { WorkExecution, WorkTask } from '../src/work-types.ts'

const ref = { projectId: 'project', taskId: 'parent' }
const session = { runtimeId: 'runtime', sessionId: 'current' }
const task: WorkTask = { id: 'parent', projectId: 'project', title: 'Same title', goal: 'Goal', version: 1, agentId: 'agent', specification: { version: 1, text: 'Spec', acceptance: [] }, specificationHistory: [], breakdown: [], children: [{ ...ref, taskId: 'child' }], sessions: [{ session: { ...session, sessionId: 'review' }, purpose: 'review' }], activity: [] }
const execution: WorkExecution = { id: 'execution', ref, agentId: 'agent', owner: 'real-owner', epoch: 2, resource: { runtimeId: 'runtime', workspaceId: 'workspace' }, session, sessionMode: 'create', agentPreset: 'agent', model: { provider: 'p', model: 'm' }, permissionPreset: 'read-only', policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'ready', history: [], events: [], retired: [{ session: { ...session, sessionId: 'old' }, epoch: 1, operationId: 'rotation' }] }

it('keeps independent Task entry, native lineage, real owner and retired pending results separate', () => {
  const child = { ...task, id: 'child', parent: ref, children: [], sessions: [] }
  const graph = buildExecutionGraph({ task, execution, children: [{ task: child, execution: { ...execution, id: 'child-execution', ref: task.children[0]!, session: { ...session, sessionId: 'child-control' }, retired: [] } }], observation: {
    settlement: 'unknown',
    sessions: [{ session, role: 'current', status: 'idle', children: [{ session: { ...session, sessionId: 'native-child' }, mode: 'continuable', status: 'idle', result: 'consumed' }], jobs: [] },
      { session: { ...session, sessionId: 'old' }, role: 'retired', status: 'inactive', children: [], jobs: [{ id: 'bash-1', owner: { ...session, sessionId: 'old' }, kind: 'bash', label: 'checks', status: 'completed', result: 'unknown', delivery: 'unknown', acceptance: 'unassessed', persistence: 'process-local' }] }], blockers: [{ code: 'job-result-unknown', session: { ...session, sessionId: 'old' }, jobId: 'bash-1' }], limitations: [] },
  })
  expect(graph.owner).toEqual({ id: 'real-owner', epoch: 2, agentId: 'agent' })
  expect(graph.childTasks[0]).toMatchObject({ ref: { projectId: 'project', taskId: 'child' }, executionId: 'child-execution', currentSession: { sessionId: 'child-control' } })
  expect(graph.sessions.find(row => row.role === 'current')?.children[0]?.session.sessionId).toBe('native-child')
  expect(graph.sessions.find(row => row.role === 'retired')?.jobs[0]).toMatchObject({ owner: { sessionId: 'old' }, result: 'unknown' })
  expect(graph.blockers).toHaveLength(1)
})

export { execution, task }
