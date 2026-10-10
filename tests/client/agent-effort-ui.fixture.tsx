import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { A2d2ConfigSection } from '../../src/client/config-page.tsx'
import { DEFAULT_STAGE_AGENTS } from '../../src/stage-agent-data.ts'

const route = 'claude-bray/claude-opus-5-5'
let settings = structuredClone(DEFAULT_STAGE_AGENTS)
let revision = 1
const requests: unknown[] = []
const efforts = { [route]: ['low', 'medium', 'high'].map(id => ({ id, name: id })) }
settings = { ...settings, agents: {
  ...settings.agents, engineer: [route], reviewer: [{ route, reasoningEffort: 'high' }],
} }
Object.assign(window, { effortSmoke: { requests, settings: () => settings } })
const mockFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body))
  requests.push(body)
  if (body.method === 'settings.update') {
    if (body.payload.expectedRevision !== revision) throw new Error('stale revision')
    settings = body.payload.settings
    revision += 1
  }
  const value = body.method === 'probe' ? { status: 'normal', reason: 'OK' }
    : { settings, revision, warnings: [], efforts }
  return new Response(JSON.stringify({ ok: true, value }), { headers: { 'content-type': 'application/json' } })
}
createRoot(document.getElementById('root')!).render(createElement(A2d2ConfigSection, {
  fetch: mockFetch, loadModelRoutes: async () => [route],
}))
