import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { ModelBoundary, PROVIDER, MODEL, REPLY } from '../scripts/a2d2-v3-122/model.mjs'
import { taskGrant } from '../scripts/a2d2-v3-122/acceptance.mjs'

const require = createRequire('/data/src/github.com/deepseek-ai/deepseek-harness-dev/packages/bundle/base/package.json')
const { LlmAdapter } = await import(require.resolve('@deepseek-ai/dsh-llm'))
const ref = { projectId: 'project-unit', taskId: 'task-unit' }
// Public query contract examples only: these are model-boundary unit tests,
// not real WorkApplication persistence or product integration evidence.
function contract() {
  const state = { execution: undefined, queries: [] }
  state.query = async query => {
    state.queries.push(query)
    if (query.type === 'task.detail') return { status: 'completed', task: { id: ref.taskId, projectId: ref.projectId } }
    if (query.type === 'task.execution') return { status: 'completed', execution: state.execution }
    if (query.type === 'session.work') return { status: 'completed', work: state.execution?.session.sessionId === query.session.sessionId ? [{ ref, purpose: 'control', executionId: state.execution.id, epoch: state.execution.epoch }] : [] }
    throw new Error('Unexpected query')
  }
  return state
}
const execution = () => ({ id: 'execution-unit', ref, owner: 'owner-unit', epoch: 1, resource: { runtimeId: 'runtime-unit', workspaceId: 'workspace-unit' }, session: { runtimeId: 'runtime-unit', sessionId: 'session-random-kickoff' }, state: 'ready', model: { provider: PROVIDER, model: MODEL } })
function harness(query) {
  const records = []
  const boundary = new ModelBoundary((kind, extra) => records.push({ kind, ...extra }), query)
  const adapter = boundary.adapter(LlmAdapter)
  return { boundary, records, invoke: async (sessionId = 'session-random-kickoff', extra = {}) => {
    const options = { provider: PROVIDER, model: MODEL, messages: [], sessionId, ...extra }
    const chunks = []
    for await (const chunk of boundary.gateway(options, () => adapter.stream(options))) chunks.push(chunk)
    return chunks
  } }
}

test('grant-task CLI requires all explicit fields and a canonical positive safe integer', () => {
  const values = { 'project-id': ref.projectId, 'task-id': ref.taskId, calls: '1', phase: 'startup' }
  assert.deepEqual(taskGrant(values), { type: 'grant-task', ref, calls: 1, phase: 'startup' })
  for (const calls of [undefined, '', '0', '-1', '1.5', 'NaN', 'Infinity', '01', '9007199254740992']) assert.throws(() => taskGrant({ ...values, calls }), /grant-task requires/)
  for (const field of ['project-id', 'task-id', 'phase']) assert.throws(() => taskGrant({ ...values, [field]: '' }), /grant-task requires/)
})

test('TaskRef grant before kickoff binds the first verified control identity and refuses a changed epoch', async () => {
  const state = contract()
  const { boundary, records, invoke } = harness(state.query)
  await boundary.authorizeTask({ ref, calls: 2, phase: 'startup' })
  state.execution = execution()
  const chunks = await invoke()
  assert.equal(chunks.find(row => row.type === 'text-delta').text, REPLY)
  assert.ok(state.queries.some(query => query.type === 'session.work' && query.session.runtimeId === 'runtime-unit'))
  state.execution = { ...state.execution, epoch: 2 }
  await assert.rejects(invoke(), /NOT_AUTHORIZED/)
  assert.equal(records.filter(row => row.kind === 'adapter').length, 1)
  assert.ok(records.some(row => row.kind === 'rejected' && row.reason === 'STALE_TASK_BINDING'))
})

test('an accepted wait control blocks model calls before its state settles', async () => {
  const state = contract()
  state.execution = { ...execution(), control: { status: 'accepted', action: 'wait' } }
  const { boundary, records, invoke } = harness(state.query)
  await boundary.authorizeTask({ ref, calls: 1, phase: 'resume' })
  await assert.rejects(invoke(), /TASK_NOT_RUNNABLE/)
  assert.equal(records.filter(row => row.kind === 'adapter').length, 0)
})

test('wrong route, auxiliary and unrelated Sessions never consume the Task budget', async () => {
  const state = contract()
  const { boundary, records, invoke } = harness(state.query)
  await boundary.authorizeTask({ ref, calls: 1, phase: 'startup' })
  state.execution = execution()
  for (const session of ['session-related', 'session-review', 'session-retired', 'session-unknown']) await assert.rejects(invoke(session), /NOT_AUTHORIZED/)
  await assert.rejects(invoke(undefined, { provider: 'real-provider' }), /NOT_AUTHORIZED/)
  await assert.rejects(invoke(undefined, { purpose: 'session-title' }), /NOT_AUTHORIZED/)
  await invoke()
  await assert.rejects(invoke(), /NOT_AUTHORIZED/)
  assert.equal(records.filter(row => row.kind === 'adapter').length, 1)
  assert.equal(records.filter(row => row.kind === 'rejected').length, 7)
})

test('missing app, unknown Task, wrong project and non-control reverse mappings fail closed', async t => {
  for (const [name, query] of [
    ['no app', undefined],
    ['unknown task', async () => ({ status: 'failed', error: { code: 'unknown-task' } })],
    ['wrong project', async () => ({ status: 'completed', task: { id: ref.taskId, projectId: 'other-project' } })],
  ]) await t.test(name, async () => {
    const { boundary, records } = harness(query)
    await assert.rejects(boundary.authorizeTask({ ref, calls: 1, phase: 'startup' }), /NOT_AUTHORIZED/)
    assert.equal(records.filter(row => row.kind === 'authorized').length, 0)
    assert.ok(records.some(row => row.kind === 'rejected'))
  })
  for (const mapping of [[], [{ ref, purpose: 'related' }], [{ ref, purpose: 'review' }], [{ ref: { ...ref, taskId: 'other-task' }, purpose: 'control', executionId: 'execution-unit', epoch: 1 }], [{ ref, purpose: 'control', executionId: 'wrong-execution', epoch: 1 }], [{ ref, purpose: 'control', executionId: 'execution-unit', epoch: 2 }]]) {
    const state = contract()
    const { boundary, records, invoke } = harness(query => query.type === 'session.work' ? { status: 'completed', work: mapping } : state.query(query))
    await boundary.authorizeTask({ ref, calls: 1, phase: 'startup' })
    state.execution = execution()
    await assert.rejects(invoke(), /NOT_CURRENT_CONTROL/)
    assert.equal(records.filter(row => row.kind === 'adapter').length, 0)
  }
})

test('changing any pinned Execution identity requires a new explicit grant', async () => {
  for (const change of [{ id: 'new-execution' }, { owner: 'new-owner' }, { epoch: 2 }, { session: { runtimeId: 'runtime-unit', sessionId: 'session-successor' } }]) {
    const state = contract()
    state.execution = execution()
    const { boundary, records, invoke } = harness(state.query)
    await boundary.authorizeTask({ ref, calls: 1, phase: 'continuation' })
    state.execution = { ...state.execution, ...change }
    await assert.rejects(invoke(state.execution.session.sessionId), /STALE_TASK_BINDING/)
    assert.equal(records.filter(row => row.kind === 'adapter').length, 0)
    await boundary.authorizeTask({ ref, calls: 1, phase: 'new-continuation' })
    await invoke(state.execution.session.sessionId)
    assert.equal(records.filter(row => row.kind === 'adapter').length, 1)
  }
})

test('a reverse-query authority race fails rather than pinning a mixed identity', async () => {
  const state = contract()
  const { boundary, records, invoke } = harness(async query => {
    const value = await state.query(query)
    if (query.type === 'session.work') state.execution = { ...state.execution, epoch: 2 }
    return value
  })
  await boundary.authorizeTask({ ref, calls: 1, phase: 'startup' })
  state.execution = execution()
  await assert.rejects(invoke(), /TASK_CHANGED_DURING_CHECK/)
  assert.equal(records.filter(row => row.kind === 'task-pinned').length, 0)
  assert.equal(records.filter(row => row.kind === 'adapter').length, 0)
})

test('concurrent requests and grant replacement cannot race the async public query', async () => {
  const state = contract()
  let release
  let entered
  const querying = new Promise(resolve => { entered = resolve })
  const hold = new Promise(resolve => { release = resolve })
  let block = false
  const { boundary, records, invoke } = harness(async query => {
    if (block && query.type === 'task.execution') { block = false; entered(); await hold }
    return state.query(query)
  })
  await boundary.authorizeTask({ ref, calls: 1, phase: 'startup' })
  state.execution = execution()
  block = true
  const first = invoke()
  await querying
  await assert.rejects(invoke('session-other-task'), /NOT_AUTHORIZED/)
  await assert.rejects(boundary.authorizeTask({ ref: { ...ref, taskId: 'other-task' }, calls: 99, phase: 'other-task' }), /BUSY_GRANT/)
  assert.throws(() => boundary.authorize({ sessionId: 'session-other', calls: 99, phase: 'other' }), /BUSY_GRANT/)
  release()
  await first
  await assert.rejects(invoke(), /NOT_AUTHORIZED/)
  assert.equal(records.filter(row => row.kind === 'adapter').length, 1)
})

test('grant replacement is refused while an admitted adapter stream is open', async () => {
  const state = contract()
  state.execution = execution()
  const records = []
  const boundary = new ModelBoundary((kind, extra) => records.push({ kind, ...extra }), state.query)
  const adapter = boundary.adapter(LlmAdapter)
  await boundary.authorizeTask({ ref, calls: 1, phase: 'startup' })
  const options = { provider: PROVIDER, model: MODEL, sessionId: state.execution.session.sessionId, messages: [] }
  const stream = boundary.gateway(options, () => adapter.stream(options))
  assert.equal((await stream.next()).value.type, 'block-start')
  await assert.rejects(boundary.authorizeTask({ ref, calls: 9, phase: 'replacement' }), /BUSY_GRANT/)
  assert.throws(() => boundary.authorize({ sessionId: options.sessionId, calls: 9, phase: 'replacement' }), /BUSY_GRANT/)
  await stream.return()
  assert.equal(records.find(row => row.kind === 'admitted').remainingCalls, 0)
  assert.equal(records.filter(row => row.kind === 'authorized').length, 1)
})
