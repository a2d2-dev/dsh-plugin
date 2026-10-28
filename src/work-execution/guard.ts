import type { NativeWorkMessage, SessionRef } from '../work-types.ts'

/** Observed inputs only. Authority and the durable correction budget belong to WorkApplication. */
export type WorkGuardInput =
  | { kind: 'ingress'; messages: readonly NativeWorkMessage[] }
  | { kind: 'resume' }
  | { kind: 'stopping'; progress: readonly string[]; answerOnly: boolean; recheckWait: boolean; currentWaitCommand?: string }
export type WorkGuard = (sessionId: string, input: WorkGuardInput) => Promise<string | undefined>
export interface WorkGuardOptions { enabled?: boolean; maxCorrections?: number }
export interface WorkYield {
  reason: 'human' | 'external' | 'executor' | 'internal'
  checkedFacts: string[]
  wakeCondition: string
  executor?: SessionRef
  jobId?: string
}
export const CONTINUE_AUTHORIZED_WORK = '任务尚未完成。请先简短回答用户，再直接用工具推进已授权的下一步。解释、道歉、更新状态和写报告本身不等于推进。核实证据、读取已接受的依赖、收取结果都属于当前工作。若发现自己误设等待，请核实后用 work_control resume 解除自己的等待并执行；不要要求用户说“继续”。用户明确暂停、停止、只作答时必须遵守。真实外部阻塞请用 work_control wait 保存 checked_facts 和 wake_condition；不要扩大授权或宣称完成。'

/** Inspect only the native user's current input, never quoted model/source history. */
export function humanGuardIntent(messages: readonly NativeWorkMessage[]): { answerOnly: boolean; recheckWait: boolean } {
  const text = messages.filter(message => (message.source as { kind?: string } | undefined)?.kind === 'user')
    .flatMap(message => message.content.flatMap(block => typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : [])).join('\n')
  // Quoted examples and negated instructions do not cancel current work.
  const instruction = text.replace(/[“「][^”」]*[”」]|"[^"\n]*"/g, '').replace(/不是只(?:回答|解释|作答)/g, '')
  const closeSession = /(?:关闭|结束)(?:当前|这个|本)会话|(?:当前|这个|本)会话(?:你)?(?:直接)?(?:关闭|结束)/.test(instruction.replace(/(?:不要|别)(?:关闭|结束)(?:当前|这个|本)会话/g, ''))
  const answerOnly = closeSession || /(?:只(?:需|要)?(?:回答|解释|作答|说状态)|不要(?:再)?(?:执行|继续|恢复|推进)|(?:先别|别)(?:再)?(?:执行|继续|恢复|推进)|(?:先|请|现在)?暂停(?:一下|任务|工作|吧|。|，|$)|(?:请|现在)?(?:停止|停下)(?:执行|工作|来|吧|。|，|$)|\b(?:answer only|without resuming|do not (?:resume|continue|execute)|pause(?: the task)?|stop(?: working)?)\b)/i.test(instruction)
  return { answerOnly, recheckWait: !answerOnly && /(?:状态|进度|现在.*做什么|需要.*做什么|没看懂|怎么.*(?:停|等)|为什么.*(?:停|等)|\b(?:status|progress|what.*(?:do|need)|why.*(?:wait|stop))\b)/i.test(text) }
}
