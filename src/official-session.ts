import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-api-session-controller'

export interface LocalModelSelection { provider: string; model: string; reasoningEffort?: ReasoningEffortId }

/** Resolve exactly one reserved identity through the Host's public composition path. */
export async function resolveSessionAgent(ctx: Context, id: SessionId): Promise<Agent> {
  const controller = ctx.get('sessionController')
  if (!controller?.resolveAgent) throw new Error('a2d2: sessionController.resolveAgent is required')
  const resolved = await controller.resolveAgent(id)
  if ('error' in resolved) throw new Error(resolved.error.message ?? resolved.error.code ?? 'Session cannot resume')
  if (resolved.agent.id !== id) throw new Error('a2d2: Host did not preserve the reserved Session identity')
  return resolved.agent
}

/** Agent.model is the official local selector; the old Host may expose its verified controller equivalent. */
export async function selectSessionModel(ctx: Context, id: SessionId, selection: LocalModelSelection): Promise<void> {
  let agent = (ctx.get('agents') as AgentRegistry | undefined)?.get(id)
  const controller = ctx.get('sessionController') as unknown as {
    resolveAgent?: (id: SessionId) => Promise<{ agent: Agent } | { error: { message?: string; code?: string } }>
    selectLocalModel?: (request: LocalModelSelection & { sessionId: SessionId }) => Promise<unknown>
  } | undefined
  if (!agent && controller?.resolveAgent) agent = await resolveSessionAgent(ctx, id)
  if (agent?.model?.select && agent.model.current) {
    const llm = ctx.get('llm')
    if (!llm?.resolveCallConfig) throw new Error('a2d2: llm.resolveCallConfig is required for local model validation')
    if (!llm.listProviders().some(provider => provider.id === selection.provider)
      || !(await llm.listModels(selection.provider)).some(model => model.id === selection.model)) {
      throw new Error('a2d2: selected model is not in the Host catalog')
    }
    if (selection.reasoningEffort !== undefined) {
      const info = await llm.resolveModelInfo(selection.provider, selection.model)
      if (!info.reasoning?.efforts.some(effort => effort.id === selection.reasoningEffort)) throw new Error('a2d2: selected model does not support reasoning effort')
    }
    await llm.resolveCallConfig(selection)
    agent.model.select(selection)
    return
  }
  if (!controller?.selectLocalModel) throw new Error('a2d2: Agent.model.select or sessionController.selectLocalModel is required for session-local model selection')
  await controller.selectLocalModel({ sessionId: id, ...selection })
}
