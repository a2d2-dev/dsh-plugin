import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { CompletionStatus, completionSyncCommand } from '../../src/client/completion-status.tsx'
import type { WorkTask, WorkExecution } from '../../src/work-types.ts'
const task={id:'task',projectId:'project',progress:{stage:'done'},completion:{operationId:'operation',closeout:{status:'pending'},external:{status:'unknown',observedState:'open'}}} as WorkTask
const execution={id:'execution',ref:{projectId:'project',taskId:'task'},owner:'owner',epoch:3} as WorkExecution
it('shows accepted local work separately from unknown remote closure and produces only the fenced sync command',()=>{
 const html=renderToStaticMarkup(createElement(CompletionStatus,{task,execution,onSync:async()=>{}}))
 expect(html).toContain('本地已验收');expect(html).toContain('关闭结果未知');expect(html).toContain('远端 Open');expect(html).toContain('补同步')
 expect(completionSyncCommand(task,execution,'retry')).toEqual({type:'task.completion-sync',commandId:'retry',ref:execution.ref,executionId:'execution',owner:'owner',epoch:3})
})
it.each([['pending','关闭待同步'],['error','关闭失败'],['conflict','关闭冲突'],['closed','远端已关闭']] as const)('presents the distinct remote %s state without replacing local completion', (status,label)=>{
 const html=renderToStaticMarkup(createElement(CompletionStatus,{task:{...task,completion:{...task.completion!,external:{...task.completion!.external!,status}}},execution}))
 expect(html).toContain('本地已验收');expect(html).toContain(label)
})
it('does not infer local acceptance from a remote closed Issue',()=>{
 const html=renderToStaticMarkup(createElement(CompletionStatus,{task:{id:'task',projectId:'project'} as WorkTask,remoteState:'closed'}))
 expect(html).toContain('尚未本地验收');expect(html).not.toContain('补同步')
})
