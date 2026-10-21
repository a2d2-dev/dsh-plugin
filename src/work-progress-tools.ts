import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkApplication } from './work.ts'
import { taskReportSchema } from './work-progress.ts'

/** Progress is recorded by the real current coordinator, never by a copied Task id in a prompt. */
export function installWorkProgressTools(ctx: Context, app: WorkApplication, runtimeId: string): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'work_report',
    description: 'Record the current managed task work status, requirements, blockers, next step and criterion evidence. Use work_control status to read the current Task specification and version. Report concrete facts when progress changes so the Project view stays current. done commits terminal local acceptance with evidence and required children complete. closeExternal optionally queues recoverable closure of the accepted canonical GitHub binding; synchronization never reruns the Task.',
    parameters: {
      report: { type: 'object', additionalProperties: false, required: true, description: 'Progress report against the current specification.', properties: {
        closeExternal: {type:'boolean',description:'Optionally persist a GitHub close intent with accepted local completion.'},
        specificationVersion: {type:'integer',required:true},
        stage: {type:'string',required:true,enum:['planned','in-progress','review','blocked','done']},
        summary: {type:'string',required:true}, next:{type:'string',required:true},
        blockers:{type:'array',required:true,items:{type:'string'}},
        criteria:{type:'array',required:true,items:{type:'object',additionalProperties:false,properties:{index:{type:'integer',required:true},passed:{type:'boolean',required:true},evidence:{type:'array',required:true,items:{type:'string'}}}}},
        breakdown:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:{type:'string',required:true},title:{type:'string',required:true},description:{type:'string',required:true},status:{type:'string',enum:['planned','in-progress','review','blocked','done']},evidence:{type:'array',items:{type:'string'}},child:{type:'object',additionalProperties:false,properties:{projectId:{type:'string',required:true},taskId:{type:'string',required:true}}}}}},
      }},
      expected_epoch:{type:'integer',description:'Optional expected current execution epoch.'},
    },
    output:{schema:{type:'object',additionalProperties:false,properties:{result:{type:'string',required:true}}},render:(_args,value)=>[{type:'text',text:value.result}]},
    async execute(args,exec) {
      if(!exec.agent || exec.agent.session.id!==exec.agent.id) throw Error('work_report requires a real current Agent Session')
      const report=taskReportSchema.parse(args.report)
      return {result:JSON.stringify(await app.sessionReport({runtimeId,sessionId:exec.agent.id},exec.callId,report,args.expected_epoch))}
    },
    presentCall:()=>({card:'generic',title:'更新工作进展',kind:'other'}),
  })), 'managed work progress reporting')
}
