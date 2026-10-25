import { describe, expect, it, vi } from 'vitest'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { WorkClient } from '../../src/client/work-api.ts'
import type { WorkSource } from '../../src/work-sources/types.ts'
import type { TaskProgressView } from '../../src/work-progress.ts'
import { mountProductionComponent } from './production-component-harness.ts'

const source: WorkSource = { id: 's', projectId: 'p', provider: 'github', repository: { owner: 'acme', repository: 'app' }, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
const catalog = { openIssueCount: 4, observedAt: '2026-10-25T15:00:00Z', pullRequests: [], pullRequestsComplete: true, views: [], fields: [], viewsComplete: true, limitations: [] }
function progress(number: number, state: TaskProgressView['processingState']): TaskProgressView {
  return { ref: { projectId: 'p', taskId: `task-${number}` }, title: `Work ${number}`, children: [], stage: 'in-progress', summary: `Progress ${number}`, next: `Next ${number}`, blockers: [], criteria: { passed: 0, total: 1, assessed: 0, current: true }, breakdown: [], processingState: state, updatedAt: `2026-10-25T15:0${number}:00Z`, source: { nodeId: `I${number}`, number, url: `https://github.com/acme/app/issues/${number}`, state: 'open', observedAt: catalog.observedAt } }
}
async function setup(items: TaskProgressView[], known = true) {
  const client: WorkClient = { command: async () => { throw Error('No browsing writes') }, query: async query => {
    if (query.type === 'source.list') return { status: 'completed', sources: [source] }
    if (query.type === 'source.catalog') return { status: 'completed', source, ...(known ? { catalog } : {}), progressItems: items }
    if (query.type === 'source.issues') return { status: 'completed', source, page: { identity: { nodeId: 'U1', login: 'reader', name: null }, items: [], observedAt: catalog.observedAt } }
    return { status: 'completed', tasks: [], progressItems: items }
  } }
  const controller = new WorkPanelController(client, { selectPanel() {}, openSession() {} })
  await controller.selectProject('p'); await controller.browseDirectory(false)
  const h = mountProductionComponent({ controller, issues: null, panel: 'none', onPanel() {} }, 'SourceDirectory', new URL('../../src/client/source-directory.tsx', import.meta.url))
  return { controller, h }
}

describe('overview activity without accordions', () => {
  it('shows one actionable empty state instead of three empty disclosures', async () => {
    const { controller, h } = await setup([])
    try {
      expect(h.nodes('details')).toHaveLength(0)
      expect(h.nodes('summary')).toHaveLength(0)
      expect(h.text()).toContain('还没有关联的工作')
      expect(h.text()).not.toContain('当前没有已关联的匹配工作')
      expect(h.text()).not.toContain('最近外部更新')
      expect(h.nodes('button').filter(button => button.props['data-work-view'])).toHaveLength(3)
      h.click('查看 Issue'); await Promise.resolve(); await Promise.resolve()
      expect(controller.getSnapshot().source.tab).toBe('issues')
    } finally { h.unmount() }
  })
  it('switches attention, active and recent work without changing navigation or writing', async () => {
    const { controller, h } = await setup([progress(1, 'waiting'), progress(2, 'processing')])
    const openTask = vi.spyOn(controller, 'openTask').mockResolvedValue()
    try {
      expect(h.text()).toContain('Work 1'); expect(h.text()).not.toContain('Work 2')
      h.nodes('button').find(button => button.props['data-work-view'] === 'processing')!.props.onClick()
      expect(h.text()).toContain('Work 2'); expect(h.text()).not.toContain('Work 1')
      h.click('#2 Work 2')
      expect(openTask).toHaveBeenCalledWith({ projectId: 'p', taskId: 'task-2' })
      h.nodes('button').find(button => button.props['data-work-view'] === 'recent')!.props.onClick()
      expect(h.text()).toContain('Work 1'); expect(h.text()).toContain('Work 2')
      expect(controller.getSnapshot().source.tab).toBe('overview')
    } finally { h.unmount() }
  })
  it('keeps an unread activity source distinct from an empty one', async () => {
    const { h } = await setup([], false)
    try {
      expect(h.text()).toContain('工作进展尚未读取')
      expect(h.text()).not.toContain('还没有关联的工作')
    } finally { h.unmount() }
  })
})
