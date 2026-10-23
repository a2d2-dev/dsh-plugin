import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkApplication } from './work.ts'
import { taskReportSchema } from './work-progress.ts'
import { compactWorkResult } from './work-model-results.ts'

/** Progress is recorded by the real current coordinator, never by a copied Task id in a prompt. */
export function installWorkProgressTools(ctx: Context, app: WorkApplication, runtimeId: string): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'work_report',
    description: 'Record the current managed task work status, requirements, blockers, next step and criterion evidence. Use startup material for the specification; work_control status checks ownership and versions only. If material is changed or missing, read every work_read specification page before reporting. Report concrete facts when progress changes so the Project view stays current. done requires all necessary native results collected and verified, a complete accepted native-child scope, and required children accepted. For an unimported external child, first read work_related_issue and record externalChildren with that nodeId, exact updatedAt, acceptance basis and verifiable evidence; a canonical Task must pass its own acceptance. closeExternal optionally queues recoverable closure of the accepted canonical GitHub binding; synchronization never reruns the Task.',
    parameters: {
      report: { type: 'object', additionalProperties: false, required: true, description: 'Progress report against the current specification.', properties: {
        externalChildren:{type:'array',description:'Accountable external acceptance only for already necessary unimported native children; never substitutes an unfinished canonical Task.',items:{type:'object',additionalProperties:false,properties:{nodeId:{type:'string',required:true},updatedAt:{type:'string',required:true},basis:{type:'string',required:true},evidence:{type:'array',required:true,items:{type:'string'}}}}},
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
      return {result:JSON.stringify(compactWorkResult(await app.sessionReport({runtimeId,sessionId:exec.agent.id},exec.callId,report,args.expected_epoch,exec.token),'report'))}
    },
    presentCall:()=>({card:'generic',title:'更新工作进展',kind:'other'}),
  })), 'managed work progress reporting')
}
