import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { WorkSource } from '../../src/work-sources/types.ts'
it('renders Repo source tabs and unknown aggregate counts without presenting one Issue page as a total', async () => {
  const source: WorkSource = { id: 's', projectId: 'p', provider: 'github', title: 'acme/app', repository: { owner: 'acme', repository: 'app' }, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
  const controller = new WorkPanelController({ command: async () => { throw Error('Unexpected command') }, query: async q => ({ status: 'completed', ...(q.type === 'projects.list' ? { projects: [{ id: 'p', name: 'acme/app', version: 1, defaultAgentId: 'a', resources: [] }] } : q.type === 'source.list' ? { sources: [source] } : q.type === 'source.issues' ? { source, page: { identity: { login: 'viewer', nodeId: 'U', name: null }, items: [], observedAt: '2026-10-21T00:00:00Z', nextPage: 2 } } : { tasks: [] }) }) }, { selectPanel: () => {}, openSession: () => {} })
  await controller.load()
  const html = renderToStaticMarkup(createElement(WorkPanel, { controller }))
  expect(html).toContain('来源标签')
  expect(html).toContain('仓库')
  expect(html).toContain('开放 Issue')
  expect(html).toContain('尚未完整观察')
  expect(html).toContain('PR')
  expect(html).not.toContain('aria-label="Project 视图"')
})
