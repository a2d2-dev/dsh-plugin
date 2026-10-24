import { expect, it, vi } from 'vitest'
import { WorkPanelController } from '../src/client/work-panel-controller.ts'
import type { WorkClient } from '../src/client/work-api.ts'
import type { WorkTask, WorkCommand, WorkCompleted } from '../src/work-types.ts'
import type { WorkSource } from '../src/work-sources/types.ts'

const task = (id: string): WorkTask => ({ id, projectId: 'p', title: id, goal: id, agentId: 'a', version: 1, specification: { version: 1, text: id, acceptance: [] }, specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [] })
const query: WorkClient['query'] = async q => q.type === 'task.detail' ? { status: 'completed', task: task(q.ref.taskId) } : q.type === 'project.detail' ? { status: 'completed', tasks: [] } : { status: 'completed', sources: [] }
const navigation = { selectPanel: () => {}, openSession: () => {} }
it('keeps the same completion-sync command identity after an unknown receipt', async () => {
  const sent: WorkCommand[] = []
  const client = { query, command: vi.fn(async command => { sent.push(command); if (sent.length === 1) throw new TypeError('Receipt lost'); return { status: 'completed' } }) } as WorkClient
  const controller = new WorkPanelController(client, navigation)
  await controller.openTask({ projectId: 'p', taskId: 't' })
  const command: WorkCommand = { type: 'task.completion-sync', commandId: 'component-click-1', ref: { projectId: 'p', taskId: 't' }, executionId: 'e', owner: 'o', epoch: 1 }
  await controller.syncCompletion(command)
  await controller.syncCompletion({ ...command, commandId: 'component-click-2' })
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(sent[0]!.type).toBe('task.completion-sync')
})

it('does not let a late native Issue read replace a newer selected Task', async () => {
  let release!: (result: WorkCompleted) => void
  const command = vi.fn(() => new Promise<WorkCompleted>(resolve => { release = resolve }))
  const controller = new WorkPanelController({ query, command }, navigation)
  await controller.openTask({ projectId: 'p', taskId: 'parent' })
  const pending = controller.openNativeIssue({ nodeId: 'native', number: 99, title: 'Native', repository: { owner: 'acme', repository: 'repo' }, url: 'https://github.com/acme/repo/issues/99', state: 'open' })
  await controller.openTask({ projectId: 'p', taskId: 'newer' })
  release({ status: 'completed', source: { id: 's', projectId: 'p', repository: { owner: 'acme', repository: 'repo' }, provider: 'github', enabled: true, version: 1, sequence: 0, requests: {}, observations: [], pages: [] } satisfies WorkSource })
  await pending
  expect(controller.getSnapshot().detail?.task?.id).toBe('newer')
  expect(command).toHaveBeenCalledTimes(1)
})
