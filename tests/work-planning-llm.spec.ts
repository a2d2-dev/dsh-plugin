import { expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { createLlmPlanner } from '../src/work-planning/llm.ts'
import type { PlanningBasis } from '../src/work-planning.ts'

const basis: PlanningBasis = {
  instruction: 'Complete work', supplements: [], blocks: [], scopeVersion: 1, scope: { assignee: '*', labels: [] },
  executionStrategy: { resource: { runtimeId: 'host', workspaceId: 'workspace' }, model: { provider: 'fake', model: 'exact' }, agentPreset: 'agent', permissionPreset: 'safe' },
  relationshipAvailability: { nativeParentChildren: 'observed-when-present', nativeDependencies: 'unavailable-in-source-port' },
  source: { id: 'source', projectId: 'project', provider: 'github', repository: { owner: 'acme', repository: 'repo' }, version: 1, enabled: true, sourceVersion: 1, candidateCount: 0 },
  candidates: [],
}

it('uses the host LLM for semantic screening with complete candidate bodies and no tools or Session history', async () => {
  let request: GenerateOptions | undefined
  const planner = createLlmPlanner(async function* (options): AsyncIterable<StreamChunk> {
    request = options
    yield { type: 'text-delta', index: 0, text: '{"decisions":[{"nodeId":"I1","matches":false,"reason":"仅文档，不符合独立缺陷要求"}]}' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const screening = { instruction: '只处理独立缺陷，排除文档', candidates: [{ nodeId: 'I1', number: 1, title: '修改说明', body: '这是完整正文，不截断。', repository: { owner: 'acme', repository: 'repo' }, labels: ['ready'], assignees: [], milestone: { number: 3, title: '3.0' }, projectItem: { fields: [{ id: 'status', name: 'Status', type: 'single-select' as const, value: 'In Progress' }], fieldsPartial: false } }] }
  expect(await planner.screen!(screening, { provider: 'real', model: 'semantic', reasoningEffort: 'high' })).toEqual({ decisions: [{ nodeId: 'I1', matches: false, reason: '仅文档，不符合独立缺陷要求' }] })
  expect(request).toMatchObject({ provider: 'real', model: 'semantic', reasoningEffort: 'high' })
  expect(JSON.stringify(request!.messages)).toContain('这是完整正文，不截断。')
  expect(JSON.stringify(request!.messages)).toContain(JSON.stringify(JSON.stringify(screening)).slice(1, -1))
  expect(request!.system).toContain('Project Status is a workflow field')
  expect(request!.system).toContain('exactly one decision')
  expect(request).not.toHaveProperty('tools')
  expect(request!.messages).toHaveLength(1)
})

it.each(['error', 'aborted'] as const)('retains a safe provider failure summary for a %s finish', async kind => {
  let request: GenerateOptions | undefined
  const planner = createLlmPlanner(async function* (options): AsyncIterable<StreamChunk> {
    request = options
    yield { type: 'text-delta', index: 0, text: 'MODEL_OUTPUT_MUST_NOT_LEAK' }
    yield { type: 'finish', reason: { kind, failure: { code: 'CONTEXT_WINDOW_EXCEEDED', status: 400,
      message: 'maximum context exceeded api_key=private-value Bearer private-bearer at /private/model.json https://model.example/api?token=private-query\nstack /private/stack.ts',
    } } }
  })
  const error = await planner.generate(basis, basis.executionStrategy.model).catch(error => error as Error)
  expect(error).toMatchObject({ code: 'planning-model-failed', message: expect.stringContaining('maximum context exceeded') })
  if (!(error instanceof Error)) throw new Error('Expected a planner failure')
  expect(error.message).toContain('CONTEXT_WINDOW_EXCEEDED')
  expect(error.message).toContain('400')
  for (const secret of ['private-value', 'private-bearer', '/private/', 'model.example', 'private-query', 'MODEL_OUTPUT_MUST_NOT_LEAK']) expect(error.message).not.toContain(secret)
  expect(error.message.length).toBeLessThanOrEqual(500)
  expect(request?.maxTokens).toBe(8192)
  expect(request?.messages).toHaveLength(1)
  expect(request).not.toHaveProperty('tools')
})
