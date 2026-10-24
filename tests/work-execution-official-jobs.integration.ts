import { expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RuntimeHost } from '../src/task-runtime/host.ts'
import { installOfficialJobReceipts } from '../src/work-execution/official-job-receipts.ts'
import { observeJobs, settleUncollectedJob } from '../src/work-execution/job-observation.ts'
import type { Context as PluginContext } from '@deepseek-ai/cordis'
import type { SessionId as PluginSessionId } from '@deepseek-ai/dsh-session'

// Every Host implementation comes from the explicit official build. Plugin
// imports retain their normal immutable dependencies; no install or relinking.
const officialHead = process.env.DSH_OFFICIAL_HOST_COMMIT ?? '22ddee3792402c3e70ec5f86a63c3e3e895a2f60'
const officialVersion = process.env.DSH_OFFICIAL_HOST_VERSION ?? '0.2.1-rc.3'
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(fulfill => { resolve = fulfill })
  return { promise, resolve }
}
async function officialModules() {
  const root = process.env.DSH_OFFICIAL_HOST_ROOT
  if (!root) throw Error('DSH_OFFICIAL_HOST_ROOT must name the built official checkout')
  expect(officialHead).toMatch(/^[0-9a-f]{40}$/u)
  expect(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(officialHead)
  expect(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('')
  const load = async (directory: string) => {
    const manifest = JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8'))
    expect(manifest.version).toBe(officialVersion)
    return import(/* @vite-ignore */ pathToFileURL(join(root, directory, 'lib/index.js')).href)
  }
  const requireOfficial = createRequire(join(root, 'packages/jobs/jobs-local/package.json'))
  const cordis = await import(/* @vite-ignore */ pathToFileURL(requireOfficial.resolve('@deepseek-ai/cordis')).href)
  const pipeline = await import(/* @vite-ignore */ pathToFileURL(join(root, 'packages/core/tools/lib/pipeline.js')).href)
  const [session, projection, query, persistence, prompt, tools, executor, agents, loop, llm, jobs, toolJobs, catalog] = await Promise.all([
    'packages/core/session', 'packages/session/session-projection', 'packages/session-query/session-query', 'packages/session/session-persistence-jsonl',
    'packages/core/system-prompt', 'packages/core/tools', 'packages/core/tool-executor-native', 'packages/core/agent', 'packages/core/agent-loop',
    'packages/llm/llm', 'packages/jobs/jobs-local', 'packages/jobs/tool-jobs', 'packages/session/session-format-catalog',
  ].map(load))
  console.log('Official jobs fixture provenance', JSON.stringify({ root, head: officialHead, node: process.version, jobs: join(root, 'packages/jobs/jobs-local/lib/index.js'), toolJobs: join(root, 'packages/jobs/tool-jobs/lib/index.js') }))
  return { cordis, pipeline, session, projection, query, persistence, prompt, tools, executor, agents, loop, llm, jobs, toolJobs, catalog }
}

it('uses built official registry, job_output, committed Session results and cold journal without model activation during observation', async () => {
  const m = await officialModules()
  const base = resolve(tmpdir())
  expect(base).toBe(resolve('.local/tmp'))
  const directory = await mkdtemp(join(base, 'official-jobs-'))
  const contexts: any[] = []
  const producers: Array<{ resolve: (value: unknown) => void }> = []
  let handle: any
  class Query extends m.query.default {
    async searchSessions() { throw Error('Search is outside this exact-read fixture') }
    async searchEvents() { throw Error('Search is outside this exact-read fixture') }
  }
  class ScriptedAdapter extends m.llm.LlmAdapter {
    requests: unknown[] = []
    script: any[][] = []
    async *stream(request: unknown) {
      this.requests.push(request)
      const chunks = this.script.shift()
      if (!chunks) throw Error('Deterministic adapter exhausted')
      yield* chunks
    }
  }
  const mount = async (withLoop: boolean, inlineOutputBytes = 0) => {
    const ctx = new m.cordis.Context()
    contexts.push(ctx)
    if (withLoop) await ctx.plugin(m.llm.default)
    await ctx.plugin(m.session.default)
    await ctx.plugin(m.projection.default)
    await ctx.plugin(m.persistence, { root: join(directory, 'sessions') })
    await ctx.plugin(Query)
    await ctx.plugin(m.agents.default)
    if (withLoop) {
      await ctx.plugin(m.prompt.default)
      await ctx.plugin(m.tools.default)
      await ctx.plugin(m.executor)
      await ctx.plugin(m.loop.default, { agents: [] })
    }
    await ctx.plugin(m.jobs.default)
    if (withLoop) {
      await ctx.plugin(m.toolJobs, { completionDelivery: 'quiet', inlineOutputBytes })
      installOfficialJobReceipts(ctx as PluginContext, m.session.appendPluginRecord)
    }
    return ctx
  }
  try {
    const ctx = await mount(true)
    const adapter = new ScriptedAdapter()
    ctx.llm.registerAdapter(['official-fixture'], adapter)
    handle = await ctx.agents.create({ sessionId: m.session.SessionId('official-jobs-owner'), agentOptions: { provider: 'official-fixture', model: 'deterministic' } })
    const agent = handle.agent
    expect(typeof ctx.jobs.observe).toBe('undefined')
    expect(typeof agent.session.appendIgnorable).toBe('undefined')
    const runtime = new RuntimeHost(ctx as PluginContext)
    const facts = () => runtime.executionFacts(agent.id as PluginSessionId, 'official-fixture', 'current')
    const produce = (owner?: string, text = 'stream evidence\n', outputLimitBytes?: number) => {
      const done = deferred<any>()
      producers.push(done)
      const id = ctx.jobs.start({ kind: 'bash', label: 'official deterministic checks', ...(owner ? { owner } : {}), ...(outputLimitBytes === undefined ? {} : { outputLimitBytes }), run(job: any) {
        job.append(text)
        return { done: done.promise, cancel() { done.resolve({ status: 'killed' }) } }
      } })
      return { id, done }
    }
    const runRead = async (id: string, callId: string, wait = false, reader = { agent, adapter }) => {
      const args = JSON.stringify({ job_id: id, wait, timeout_ms: 1000 })
      reader.adapter.script.push([
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 0, id: m.llm.ToolCallId(callId), name: 'job_output', argumentsDelta: args },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id: m.llm.ToolCallId(callId), name: 'job_output', arguments: args } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ], [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'Result available for independent acceptance.' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'Result available for independent acceptance.' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ])
      reader.agent.followup(m.llm.createUserMessage({ content: [{ type: 'text', text: 'Perform the scripted terminal read.' }], source: { kind: 'user' } }))
      await reader.agent.whenIdle()
    }
    const own = produce(agent.id)
    const shared = produce()
    const read = vi.spyOn(ctx.jobs, 'read')
    const readAt = vi.spyOn(ctx.jobs, 'readAt')
    const before = adapter.requests.length
    const running = await facts()
    expect(running.jobObservation).toBe('available')
    expect(running.jobs.map(job => job.id)).toEqual([own.id])
    expect(ctx.jobs.list(agent.id).map((job: any) => job.id)).toContain(shared.id)
    expect(() => ctx.jobs.get(own.id, m.session.SessionId('foreign'))).toThrow()
    own.done.resolve({ status: 'completed', result: 'terminal evidence' })
    await ctx.jobs.wait(own.id, 1000, agent.id)
    const terminal = await facts()
    await facts()
    expect(terminal.jobs[0]).toMatchObject({ status: 'completed', delivery: 'pending', result: 'unknown', acceptance: 'unassessed' })
    expect(settleUncollectedJob(terminal.jobs[0]!)).toEqual({ blocker: 'job-unsettled' })
    expect(read).not.toHaveBeenCalled()
    expect(readAt).not.toHaveBeenCalled()
    expect(adapter.requests).toHaveLength(before)
    await runRead(own.id, 'terminal-read')
    expect(read).toHaveBeenCalledOnce()
    expect(read.mock.results[0]!.value).toMatchObject({ result: 'terminal evidence', chunks: [{ text: 'stream evidence\n' }] })
    await expect.poll(async () => (await facts()).jobs[0]!.delivery).toBe('delivered')
    expect((await facts()).jobs[0]).toMatchObject({ delivery: 'delivered', result: 'unknown', acceptance: 'unassessed' })
    await runRead(own.id, 'duplicate-read')
    expect((await facts()).jobs[0]!.delivery).toBe('delivered')

    const consumed = produce(agent.id)
    consumed.done.resolve({ status: 'completed', result: 'one-shot evidence' })
    await ctx.jobs.wait(consumed.id, 1000, agent.id)
    const failAfterRead = ctx.on('tools/post-execute', async (exec: any, _result: any, next: any) => {
      if (exec.callId === 'consumed-then-failed') throw Error('fixture post-execute failure after consumption')
      return next()
    })
    await runRead(consumed.id, 'consumed-then-failed')
    failAfterRead()
    expect((await facts()).jobs.find(job => job.id === consumed.id)!.delivery).toBe('pending')
    await runRead(consumed.id, 'consumed-empty-repeat')
    expect(read.mock.results.at(-1)!.value).toMatchObject({ chunks: [] })
    expect(read.mock.results.at(-1)!.value).not.toHaveProperty('result')
    expect((await facts()).jobs.find(job => job.id === consumed.id)!.delivery).toBe('pending')

    for (const [kind, content] of [
      ['empty', []],
      ['replacement', [{ type: 'text', text: 'policy replacement with no job payload' }]],
    ] as const) {
      const hidden = produce(agent.id)
      hidden.done.resolve({ status: 'completed', result: 'canonical evidence must reach the committed result' })
      await ctx.jobs.wait(hidden.id, 1000, agent.id)
      const callId = `policy-${kind}`
      let canonicalText: string | undefined
      const replace = ctx.on('tools/post-execute', async (exec: any, _result: any, next: any) =>
        exec.callId === callId ? { kind: 'accept', content: [...content] } : next())
      const capture = ctx.on('tools/result', (exec: any, result: any) => {
        if (exec.callId === callId) canonicalText = result.value?.text
      })
      await runRead(hidden.id, callId)
      replace(); capture()
      expect(canonicalText).toContain('canonical evidence must reach the committed result')
      using committed = await ctx.sessionQuery.observeSession(agent.id)
      const row = committed.events.findLast((event: any) => event.type === 'tool/result' && event.data.message.toolCallId === callId)
      expect(row.data.message).toMatchObject({ isError: false, content: [...content] })
      expect((await facts()).jobs.find(job => job.id === hidden.id)!.delivery).toBe('pending')
    }

    const limited = produce(agent.id, 'payload '.repeat(256), 128)
    limited.done.resolve({ status: 'completed', result: 'final evidence' })
    await ctx.jobs.wait(limited.id, 1000, agent.id)
    let fullText = '', presented = ''
    const captureLimited = ctx.on('tools/result', (exec: any, result: any) => {
      if (exec.callId === 'limited-presentation') {
        fullText = result.value.text
        presented = result.content.map((block: any) => block.text ?? '').join('')
      }
    })
    await runRead(limited.id, 'limited-presentation')
    captureLimited()
    expect(Buffer.byteLength(fullText)).toBeGreaterThan(128)
    expect(Buffer.byteLength(presented)).toBeLessThanOrEqual(128)
    expect((await facts()).jobs.find(job => job.id === limited.id)!.delivery).toBe('pending')

    const rawCall = (id: string, callId: string, signal = new AbortController().signal) => ctx.tools.execute({
      agent, signal, calls: [{ type: 'tool-call', id: m.llm.ToolCallId(callId), name: 'job_output', arguments: JSON.stringify({ job_id: id }) }],
      // The official public no-log path returns canonical output without a Session commit.
    })
    const uncommitted = produce(agent.id)
    uncommitted.done.resolve({ status: 'completed', result: 'uncommitted evidence' })
    await ctx.jobs.wait(uncommitted.id, 1000, agent.id)
    const raw = await rawCall(uncommitted.id, 'no-session-result')
    expect(raw.results[0].result).toMatchObject({ isError: false, value: { job: { status: 'completed' } } })
    expect((await facts()).jobs.find(job => job.id === uncommitted.id)!.delivery).toBe('pending')
    await runRead(uncommitted.id, 'empty-after-no-commit')
    expect((await facts()).jobs.find(job => job.id === uncommitted.id)!.delivery).toBe('pending')

    const failedCommit = produce(agent.id)
    failedCommit.done.resolve({ status: 'completed', result: 'canonical but failed commit' })
    await ctx.jobs.wait(failedCommit.id, 1000, agent.id)
    const append = agent.session.append.bind(agent.session)
    let rejectedCommit = false
    const failCommit = vi.spyOn(agent.session, 'append').mockImplementation((type: any, data: any, ...rest: any[]) => {
      if (type === 'tool/result' && data.message?.toolCallId === 'failed-success-commit' && data.message.isError === false) {
        rejectedCommit = true
        throw Error('fixture rejects successful Session result commit')
      }
      return append(type, data, ...rest)
    })
    await runRead(failedCommit.id, 'failed-success-commit')
    failCommit.mockRestore()
    expect(rejectedCommit).toBe(true)
    expect(adapter.script).toHaveLength(1) // The failed turn never requests its scripted continuation.
    adapter.script.shift()
    expect((await facts()).jobs.find(job => job.id === failedCommit.id)!.delivery).toBe('pending')
    await runRead(failedCommit.id, 'empty-after-failed-commit')
    expect((await facts()).jobs.find(job => job.id === failedCommit.id)!.delivery).toBe('pending')

    const cancelled = produce(agent.id)
    cancelled.done.resolve({ status: 'completed', result: 'cancelled evidence' })
    await ctx.jobs.wait(cancelled.id, 1000, agent.id)
    const abort = new AbortController()
    const cancelAfterRead = ctx.on('tools/post-execute', async (exec: any, _result: any, next: any) => {
      if (exec.callId === 'cancel-after-consumption') abort.abort()
      return next()
    })
    const cancelledRead = await rawCall(cancelled.id, 'cancel-after-consumption', abort.signal)
    cancelAfterRead()
    expect(cancelledRead.results[0].result).toMatchObject({ isError: true, error: { info: { code: 'ABORTED' } } })
    await runRead(cancelled.id, 'empty-after-cancellation')
    expect((await facts()).jobs.find(job => job.id === cancelled.id)!.delivery).toBe('pending')

    const nested = produce(agent.id)
    nested.done.resolve({ status: 'completed', result: 'nested evidence' })
    await ctx.jobs.wait(nested.id, 1000, agent.id)
    // Exercise the public PTC sub-dispatch seam, using the real shared pipeline
    // and its parent token. This does not claim to run the PTC language runtime.
    const pipeline = new m.pipeline.ToolExecutionPipeline(ctx)
    const prepared = await pipeline.prepare({ agent, callId: m.llm.ToolCallId('nested-consumption'), rootCallId: m.llm.ToolCallId('outer-program'),
      parent: Symbol('outer-execution'), name: 'job_output', arguments: { job_id: nested.id }, signal: new AbortController().signal })
    expect(prepared.kind).toBe('dispatch')
    const nestedRead = await pipeline.complete(prepared.exec, await pipeline.dispatch(prepared.exec))
    expect(nestedRead).toMatchObject({ isError: false, value: { job: { status: 'completed' } } })
    await runRead(nested.id, 'empty-after-nested')
    expect((await facts()).jobs.find(job => job.id === nested.id)!.delivery).toBe('pending')

    const concurrent = produce(agent.id)
    concurrent.done.resolve({ status: 'completed', result: 'concurrent evidence' })
    await ctx.jobs.wait(concurrent.id, 1000, agent.id)
    const atPost = deferred<void>(), releasePost = deferred<void>()
    const holdRead = ctx.on('tools/post-execute', async (exec: any, _result: any, next: any) => {
      if (exec.callId === 'concurrent-payload') { atPost.resolve(); await releasePost.promise }
      return next()
    })
    const firstRead = rawCall(concurrent.id, 'concurrent-payload')
    await atPost.promise
    const secondRead = await rawCall(concurrent.id, 'concurrent-empty')
    expect(secondRead.results[0].result).toMatchObject({ isError: false, value: { text: '' } })
    expect((await facts()).jobs.find(job => job.id === concurrent.id)!.delivery).toBe('pending')
    releasePost.resolve()
    const firstResult = await firstRead
    holdRead()
    expect(firstResult.results[0].result.isError).toBe(false)
    expect(firstResult.results[0].result.value.text.length).toBeGreaterThan(0)
    await runRead(concurrent.id, 'empty-after-concurrent')
    expect((await facts()).jobs.find(job => job.id === concurrent.id)!.delivery).toBe('pending')

    const waiting = produce(agent.id)
    const waitStarted = deferred<void>()
    const originalWait = ctx.jobs.wait.bind(ctx.jobs)
    const waitSpy = vi.spyOn(ctx.jobs, 'wait').mockImplementation((...args: any[]) => {
      const pending = originalWait(...args)
      if (args[0] === waiting.id) waitStarted.resolve()
      return pending
    })
    const inFlight = runRead(waiting.id, 'running-wait', true)
    await waitStarted.promise
    waiting.done.resolve({ status: 'completed', result: 'waited evidence' })
    await inFlight
    waitSpy.mockRestore()
    expect((await facts()).jobs.find(job => job.id === waiting.id)!.delivery).toBe('delivered')
    await runRead(waiting.id, 'terminal-repeat')
    expect((await facts()).jobs.find(job => job.id === waiting.id)!.delivery).toBe('delivered')

    const empty = produce(agent.id, '')
    empty.done.resolve({ status: 'completed' })
    await ctx.jobs.wait(empty.id, 1000, agent.id)
    await runRead(empty.id, 'genuinely-empty-wait', true)
    expect((await facts()).jobs.find(job => job.id === empty.id)!.delivery).toBe('pending')
    // A new successful job cannot erase this old proof gap. Operator removal
    // of a settled record is the actual public recovery, preserving history.
    ctx.jobs.remove(consumed.id, agent.id)
    const removed = (await facts()).jobs.find(job => job.id === consumed.id)!
    expect(removed).toMatchObject({ availability: 'lost', delivery: 'unknown' })
    expect(settleUncollectedJob(removed)).toHaveProperty('reminder')
    expect(settleUncollectedJob(removed)).not.toHaveProperty('blocker')

    const lost = produce(agent.id)
    lost.done.resolve({ status: 'completed' })
    shared.done.resolve({ status: 'completed' })
    await ctx.jobs.wait(lost.id, 1000, agent.id)
    await ctx.jobs.wait(shared.id, 1000)
    expect(await ctx.sessions.flush(agent.session)).toBe(true)
    read.mockRestore()
    readAt.mockRestore()
    await handle.dispose()
    handle = undefined
    await ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(ctx), 1)

    const cold = await mount(false)
    const old = agent.id as PluginSessionId
    using observation = await cold.sessionQuery.observeSession(old)
    const history = observeJobs(cold.jobs, old, 'official-fixture', [], observation.events)
    expect(history.capability).toBe('available')
    expect(history.jobs.find(job => job.id === consumed.id)).toMatchObject({ availability: 'lost', delivery: 'unknown' })
    expect(history.jobs.find(job => job.id === waiting.id)).toMatchObject({ availability: 'history', delivery: 'delivered' })
    expect(history.jobs.find(job => job.id === own.id)).toMatchObject({ availability: 'history', delivery: 'delivered', persistence: 'session-journal' })
    const lostJob = history.jobs.find(job => job.id === lost.id)!
    expect(lostJob).toMatchObject({ availability: 'lost', delivery: 'unknown' })
    expect(settleUncollectedJob(lostJob)).toHaveProperty('reminder')
    expect(settleUncollectedJob(lostJob)).not.toHaveProperty('blocker')
    cold.jobs.attachController('restart-fixture')
    const fresh = cold.jobs.start({ kind: 'bash', label: 'fresh registry identity', run() { return { done: Promise.resolve({ status: 'completed' }), cancel() {} } } })
    expect(fresh).toMatch(/^bash-[0-9a-f]{16}$/u)
    expect(fresh).not.toBe(own.id)
    expect(fresh).not.toBe(lost.id)
    await cold.jobs.wait(fresh, 1000)

    const legacyOwner = m.session.SessionId('migrated-legacy-owner')
    const restore = m.catalog.createSessionFormatCatalogWithChildren([]).createRestore({ type: 'session', version: 3, id: legacyOwner, createdAt: 1, isSeeded: false, delegationDepth: 0 }, { recovery: 'strict', validation: 'current' })
    restore.decodeRow({ type: 'jobs/settled', seq: 0, time: 2, ignorable: true, data: {
      job: { id: 'bash-1', owner: legacyOwner, kind: 'bash', label: 'legacy checks', status: 'completed' }, registryEpoch: 'old-fork', instanceId: 'old-instance', terminalResult: 'pending',
    } })
    const migrated = restore.finish()
    expect(migrated.events[0].type).toBe('plugin:jobs/settled')
    cold.sessions.create(legacyOwner, { seed: migrated.events, inheritedEventCount: 0 })
    const legacy = await new RuntimeHost(cold as PluginContext).executionFacts(legacyOwner as PluginSessionId, 'official-fixture', 'retired')
    expect(legacy.jobs).toEqual([expect.objectContaining({ id: 'bash-1', registryEpoch: 'old-fork', availability: 'lost', delivery: 'unknown' })])
    expect(settleUncollectedJob(legacy.jobs[0]!)).toHaveProperty('reminder')
    expect(settleUncollectedJob(legacy.jobs[0]!)).not.toHaveProperty('blocker')
    expect(adapter.requests).toHaveLength(before + 31)

    const inlineCtx = await mount(true, 2048)
    const inlineAdapter = new ScriptedAdapter()
    inlineCtx.llm.registerAdapter(['official-fixture'], inlineAdapter)
    handle = await inlineCtx.agents.create({ sessionId: m.session.SessionId('inline-owner'), agentOptions: { provider: 'official-fixture', model: 'deterministic' } })
    const inlineAgent = handle.agent
    const inlineId = inlineCtx.jobs.start({ owner: inlineAgent.id, kind: 'bash', label: 'inline evidence', run(job: any) {
      job.append('inline stream')
      return { done: Promise.resolve({ status: 'completed', result: 'inline final evidence' }), cancel() {} }
    } })
    await expect.poll(() => inlineCtx.jobs.get(inlineId, inlineAgent.id).status).toBe('completed')
    // Commit the real inline notice before job_output, so its held payload has
    // left tool-jobs. Its prose/summary cannot certify delivery for this plugin.
    inlineAdapter.script.push([{ type: 'finish', reason: { kind: 'stop' } }])
    inlineAgent.followup(m.llm.createUserMessage({ content: [{ type: 'text', text: 'Observe the queued notice.' }], source: { kind: 'user' } }))
    await inlineAgent.whenIdle()
    await runRead(inlineId, 'empty-after-inline', false, { agent: inlineAgent, adapter: inlineAdapter })
    const inlineFacts = await new RuntimeHost(inlineCtx as PluginContext).executionFacts(inlineAgent.id, 'official-fixture', 'current')
    expect(inlineFacts.jobs[0]!.delivery).toBe('pending')
    using inlineHistory = await inlineCtx.sessionQuery.observeSession(inlineAgent.id)
    expect(inlineHistory.events.some((event: any) => event.type === 'user/message' && event.data.source?.kind === 'tool-jobs')).toBe(true)

    const inlineWaitDone = deferred<any>(), inlineWaitStarted = deferred<void>()
    producers.push(inlineWaitDone)
    const inlineWaitId = inlineCtx.jobs.start({ owner: inlineAgent.id, kind: 'bash', label: 'wait with default inline policy', run(job: any) {
      job.append('wait stream')
      return { done: inlineWaitDone.promise, cancel() { inlineWaitDone.resolve({ status: 'killed' }) } }
    } })
    const inlineWait = inlineCtx.jobs.wait.bind(inlineCtx.jobs)
    const inlineWaitSpy = vi.spyOn(inlineCtx.jobs, 'wait').mockImplementation((...args: any[]) => {
      const waiting = inlineWait(...args)
      if (args[0] === inlineWaitId) inlineWaitStarted.resolve()
      return waiting
    })
    const defaultPolicyWait = runRead(inlineWaitId, 'default-policy-wait', true, { agent: inlineAgent, adapter: inlineAdapter })
    await inlineWaitStarted.promise
    inlineWaitDone.resolve({ status: 'completed', result: 'default policy wait evidence' })
    await defaultPolicyWait
    inlineWaitSpy.mockRestore()
    const waited = await new RuntimeHost(inlineCtx as PluginContext).executionFacts(inlineAgent.id, 'official-fixture', 'current')
    expect(waited.jobs.find(job => job.id === inlineWaitId)!.delivery).toBe('delivered')

  } finally {
    for (const done of producers) done.resolve({ status: 'completed' })
    if (handle) await handle.dispose()
    for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
    if (dirname(directory) !== base || !basename(directory).startsWith('official-jobs-') || await realpath(directory) !== directory) throw Error(`Unexpected fixture cleanup target: ${directory}`)
    await rm(directory, { recursive: true })
  }
})
