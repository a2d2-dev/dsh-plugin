import { appendFileSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

export const name = 'a2d2-v3-121-acceptance-guard'
export const inject = ['llm', 'sessions']
export async function apply(ctx, config) {
  const { LlmAdapter } = await import(pathToFileURL(config.llm).href)
  const { root } = config
  const metricsFile = join(root, 'evidence/metrics.jsonl')
  const processId = randomUUID()
  const record = (kind, extra = {}) => appendFileSync(metricsFile, JSON.stringify({ processId, pid: process.pid, time: new Date().toISOString(), kind, ...extra }) + '\n', { mode: 0o600 })
  const counts = () => {
    const rows = readFileSync(metricsFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    return { gateway: rows.filter(row => row.kind === 'gateway').length, adapter: rows.filter(row => row.kind === 'adapter').length, births: rows.filter(row => row.kind === 'session-born').length, bornSessionIds: rows.filter(row => row.kind === 'session-born').map(row => row.sessionId) }
  }
  record('guard-started')
  class DisabledAdapter extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: 'Acceptance disabled' } }
    async listModels(provider) { return [{ provider, id: 'no-model', name: 'No model (acceptance guard)', contextWindow: 128_000 }] }
    async resolveModel(provider, model) {
      if (provider !== 'acceptance-disabled' || model !== 'no-model') throw new Error('Unsupported acceptance model route')
      return { provider, id: model, name: 'No model (acceptance guard)', contextWindow: 128_000 }
    }
    async *stream() {
      record('adapter')
      throw new Error('A2D2_ACCEPTANCE_MODEL_DISABLED')
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['acceptance-disabled'], new DisabledAdapter()), 'acceptance disabled adapter')
  ctx.on('llm/stream', function (options, next) {
    record('gateway')
    if (options.provider !== 'acceptance-disabled') throw new Error('A2D2_ACCEPTANCE_UNEXPECTED_PROVIDER')
    return next()
  }, { global: true })
  ctx.on('session/created', session => record('session-born', { sessionId: session.id }), { global: true })
  // The driver is private filesystem IPC, never a product route or Task store.
  ctx.inject(['sessionController', 'workspaceController', 'agentDefaultModel', 'sessionProjections', 'sandboxPolicy', 'permissionPresets', 'approval'], driver => {
    const ipc = join(root, 'ipc')
    const handled = new Set()
    let busy = false
    async function snapshot() {
      const listed = await driver.sessionController.list({}, AbortSignal.timeout(10_000))
      const sessions = []
      for (const row of listed.items) {
        const inspection = await driver.sessionController.inspect(row.sessionId)
        const live = driver.sessions.get(row.sessionId)
        const projection = live ? driver.sessionProjections.snapshot(live).values : row.projections?.values
        if (!projection?.modelSelection || !projection?.permissions) throw new Error(`Missing public configuration projections for Session ${row.sessionId}`)
        // A missing effective live policy cannot silently pass as an empty object.
        if (!live) throw new Error(`Session ${row.sessionId} is cold; reopen through native navigation before live configuration acceptance`)
        sessions.push({ sessionId: row.sessionId, cwd: inspection.meta.cwd, model: { selection: projection.modelSelection, default: driver.agentDefaultModel.currentSelection() }, permissions: { selection: projection.permissions, sandbox: driver.sandboxPolicy.resolve({ session: live }), approval: driver.approval.overrideOf(live) ?? driver.approval.config.policy } })
      }
      sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId))
      return { processId, pid: process.pid, providers: driver.llm.listProviders().map(provider => provider.id), ...counts(), sessions }
    }
    async function execute(action) {
      const providers = driver.llm.listProviders().map(provider => provider.id)
      if (providers.length !== 1 || providers[0] !== 'acceptance-disabled') throw new Error('Real model adapter remains registered')
      if (action === 'snapshot') return snapshot()
      if (action === 'seed') {
        const created = await driver.workspaceController.create({ path: join(root, 'workspace') })
        const session = await driver.sessionController.create({ workspaceId: created.workspace.id })
        return { workspaceId: created.workspace.id, ...session }
      }
      if (action === 'positive') {
        const before = counts()
        if (before.gateway !== 0 || before.adapter !== 0) throw new Error('Positive control requires a fresh environment with zero model attempts')
        const chunks = []
        for await (const chunk of driver.llm.stream({ provider: 'acceptance-disabled', model: 'no-model', messages: [] })) chunks.push(chunk)
        const after = counts()
        const finish = chunks.find(chunk => chunk.type === 'finish')
        if (after.gateway !== 1 || after.adapter !== 1 || chunks.length !== 1 || finish?.reason?.kind !== 'error' || !JSON.stringify(finish.reason).includes('A2D2_ACCEPTANCE_MODEL_DISABLED')) throw new Error('Double guard positive control failed')
        const result = { processId, before, after, finish }
        writeFileSync(join(root, 'evidence/positive.json'), JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' })
        return result
      }
      throw new Error('Unknown acceptance action')
    }
    const timer = setInterval(async () => {
      if (busy) return
      busy = true
      try {
        for (const file of readdirSync(ipc).filter(file => file.endsWith('.request.json'))) {
          const response = join(ipc, file.replace('.request.json', '.response.json'))
          if (handled.has(file) || existsSync(response)) continue
          let request
          try { request = JSON.parse(readFileSync(join(ipc, file), 'utf8')) } catch { continue }
          handled.add(file)
          let result
          try { result = { ok: true, value: await execute(request.action) } } catch (error) { result = { ok: false, error: error.message } }
          writeFileSync(response, JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' })
        }
      } finally { busy = false }
    }, 100)
    ctx.effect(() => () => clearInterval(timer), 'acceptance IPC timer')
    record('driver-ready')
  })
}
