import { appendFileSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { ModelBoundary, PROVIDER, MODEL, REPLY } from './model.mjs'

export const name = 'a2d2-v3-122-host-guard'
export const inject = ['llm', 'sessions']
export async function apply(ctx, config) {
  const { LlmAdapter } = await import(pathToFileURL(config.llm).href)
  const { root } = config
  const metricsFile = join(root, 'evidence/metrics.jsonl')
  const processId = randomUUID()
  const record = (kind, extra = {}) => appendFileSync(metricsFile, JSON.stringify({ processId, pid: process.pid, time: new Date().toISOString(), kind, ...extra }) + '\n', { mode: 0o600 })
  const counts = () => {
    const rows = readFileSync(metricsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    return { gateway: rows.filter(row => row.kind === 'gateway').length, adapter: rows.filter(row => row.kind === 'adapter').length }
  }
  record('guard-started')
  const boundary = new ModelBoundary(record, query => {
    const application = ctx.get('a2d2Work')
    if (!application || typeof application.query !== 'function') throw Object.assign(new Error('Public WorkApplication unavailable'), { code: 'WORK_APPLICATION_UNAVAILABLE' })
    return application.query(query, { operator: true })
  })
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], boundary.adapter(LlmAdapter)), 'deterministic external model boundary')
  ctx.on('llm/stream', (options, next) => boundary.gateway(options, next), { global: true })
  ctx.on('session/created', session => record('session-born', { sessionId: session.id }), { global: true })
  ctx.inject(['sessionController', 'workspaceController', 'agentDefaultModel', 'agentPresets', 'agents', 'sessionProjections', 'sandboxPolicy', 'approval'], driver => {
    const handled = new Set()
    let busy = false
    const route = { provider: PROVIDER, model: MODEL }
    async function snapshot() {
      const listed = await driver.sessionController.list({}, AbortSignal.timeout(10000))
      const sessions = []
      for (const row of listed.items) {
        const inspected = await driver.sessionController.inspect(row.sessionId)
        const live = driver.agents.get(row.sessionId)
        sessions.push({ sessionId: row.sessionId, meta: inspected.meta, eventTypes: inspected.events.map(event => event.type), live: Boolean(live), projections: await driver.sessionController.projections({ sessionId: row.sessionId }), ...(live ? { sandbox: driver.sandboxPolicy.resolve({ session: live.session }), approval: driver.approval.overrideOf(live.session) ?? driver.approval.config.policy } : {}) })
      }
      return { processId, pid: process.pid, ...counts(), defaultModel: driver.agentDefaultModel.currentSelection(), sessions: sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId)) }
    }
    async function fixture() {
      const before = counts()
      const workspace = (await driver.workspaceController.create({ path: join(root, 'workspace') })).workspace
      const preset = await driver.agentPresets.resolve()
      assert.ok(!preset.error, JSON.stringify(preset))
      const sessions = {}
      for (const role of ['positive', 'current', 'retired', 'review']) {
        const request = { sessionId: `session-a2d2-122-${role}`, workspaceId: workspace.workspaceId, agentPreset: preset.id }
        const first = await driver.sessionController.create(request)
        const retry = await driver.sessionController.create(request)
        assert.deepEqual(retry, first)
        assert.equal((await driver.sessionController.inspect(first.sessionId)).meta.cwd, join(root, 'workspace'))
        sessions[role] = first
      }
      assert.deepEqual(counts(), before)
      return { workspaceId: workspace.workspaceId, preset, sessions, before, after: counts(), scope: 'host Session fixtures only; no Task ownership assigned' }
    }
    async function execute(action) {
      assert.deepEqual(driver.llm.listProviders().map(row => row.id), [PROVIDER], 'Only deterministic model may be registered')
      if (action?.type === 'grant-task') return boundary.authorizeTask(action)
      if (action === 'snapshot') return snapshot()
      if (action === 'fixture') return fixture()
      if (action === 'positive') {
        const fixtures = await fixture()
        const sessionId = fixtures.sessions.positive.sessionId
        const agent = driver.agents.get(sessionId)
        const before = counts()
        const defaultBefore = driver.agentDefaultModel.currentSelection()
        await driver.sessionController.selectLocalModel({ sessionId, ...route })
        const assemblies = []
        const dispose = agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
          const result = await next()
          assemblies.push({ provider: result.variables.provider, model: result.variables.model })
          record('assembly', { sessionId, ...assemblies.at(-1) })
          return result
        }, { prepend: true })
        const requestId = randomUUID()
        boundary.authorize({ sessionId, calls: 1, phase: 'host-positive' })
        record('prompt-submitted', { sessionId, requestId, phase: 'host-positive' })
        try {
          await driver.sessionController.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: 'Explicit host positive control; respond with the deterministic acceptance marker.' }] }, AbortSignal.timeout(10000))
          await Promise.race([agent.whenIdle(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Host positive loop timed out')), 15000); timer.unref() })])
        } finally { dispose() }
        const inspected = await driver.sessionController.inspect(sessionId)
        const header = agent.session.requestHeader()
        const reply = inspected.events.find(event => event.type === 'assistant/message' && JSON.stringify(event.data).includes(REPLY))
        const end = inspected.events.filter(event => event.type === 'turn/end').at(-1)
        assert.ok(reply, 'Actual persisted assistant reply required')
        assert.equal(end?.data.reason.kind, 'completed')
        assert.equal(header.config.provider, PROVIDER)
        assert.equal(header.config.model, MODEL)
        assert.ok(assemblies.some(row => row.provider === PROVIDER && row.model === MODEL), 'Actual assembly must match request')
        assert.deepEqual(driver.agentDefaultModel.currentSelection(), defaultBefore)
        assert.deepEqual(counts(), { gateway: before.gateway + 1, adapter: before.adapter + 1 })
        return { scope: 'real host loop positive; not product task.start', processId, sessionId, requestId, before, after: counts(), assemblies, request: { provider: header.config.provider, model: header.config.model }, defaultBefore, defaultAfter: driver.agentDefaultModel.currentSelection(), reply: { seq: reply.seq, text: REPLY }, end, fixtures }
      }
      throw new Error('Unknown acceptance action')
    }
    const timer = setInterval(async () => {
      if (busy) return
      busy = true
      try {
        for (const file of readdirSync(join(root, 'ipc')).filter(file => file.endsWith('.request.json'))) {
          const response = join(root, 'ipc', file.replace('.request.json', '.response.json'))
          if (handled.has(file) || existsSync(response)) continue
          handled.add(file)
          let result
          try { result = { ok: true, value: await execute(JSON.parse(readFileSync(join(root, 'ipc', file), 'utf8')).action) } } catch (error) { result = { ok: false, error: error.stack } }
          writeFileSync(response, JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' })
        }
      } finally { busy = false }
    }, 100)
    ctx.effect(() => () => clearInterval(timer), 'host acceptance IPC timer')
    record('driver-ready')
  })
}
