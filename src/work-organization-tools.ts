import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkApplication } from './work.ts'
import { taskOrganizationSchema } from './work-organization.ts'

export function installWorkOrganizationTools(ctx:Context,app:WorkApplication,runtimeId:string):void {
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'work_related_issue',
    description:'Read this managed Task accepted GitHub Issue or one of its already accepted necessary native children through the trusted source route. Omit node_id for the parent. Returns normalized source material and any canonical Task acceptance; it creates no Task or Session, grants no execution authority, and does not accept scope or completion. Closed or merged is not acceptance.',
    parameters:{node_id:{type:'string'},expected_epoch:{type:'integer'}},
    output:{schema:{type:'object',additionalProperties:false,properties:{result:{type:'string',required:true}}},render:(_args,value)=>[{type:'text',text:value.result}]},
    async execute(args,exec){
      if(!exec.agent||exec.agent.session.id!==exec.agent.id)throw Error('work_related_issue requires a real current Agent Session')
      return {result:JSON.stringify(await app.sessionReadRelatedIssue({runtimeId,sessionId:exec.agent.id},args.node_id,args.expected_epoch))}
    },
    presentCall:()=>({card:'generic',title:'读取必要来源资料',kind:'other'}),
  })),'managed work related source reading')
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'work_organize',
    description:'Preserve your managed Task specification or create a real linked local child task. Use source-children only to explicitly accept a completely read parent native-child scope; it cannot remove previously necessary children. Read work_control status first for the current Task version. Extract acceptance criteria from the accepted Issue or user decisions without inventing, removing or weakening requirements; ask when unclear. Creating a child preserves the parent relationship and does not create a GitHub Issue or start a child Session.',
    parameters:{
      action:{type:'string',required:true,enum:['specification','child','source-children']},
      expected_version:{type:'integer',required:true,description:'Current Task version from work_control status.'},
      title:{type:'string',description:'Required only for a new child task.'},
      observed_at:{type:'string',description:'Required for source-children: exact parent observation from work_related_issue.'},
      goal:{type:'string'}, specification:{type:'string'},
      acceptance:{type:'array',items:{type:'string'},description:'Concrete accepted criteria, preserving all applicable requirements.'},
      expected_epoch:{type:'integer'},
    },
    output:{schema:{type:'object',additionalProperties:false,properties:{result:{type:'string',required:true}}},render:(_args,value)=>[{type:'text',text:value.result}]},
    async execute(args,exec){
      if(!exec.agent||exec.agent.session.id!==exec.agent.id)throw Error('work_organize requires a real current Agent Session')
      const organization=taskOrganizationSchema.parse(args.action==='source-children'?{kind:args.action,expectedVersion:args.expected_version,observedAt:args.observed_at}:{kind:args.action,expectedVersion:args.expected_version,goal:args.goal,specification:args.specification,acceptance:args.acceptance,...(args.action==='child'?{title:args.title}:{})})
      return {result:JSON.stringify(await app.sessionOrganize({runtimeId,sessionId:exec.agent.id},exec.callId,organization,args.expected_epoch))}
    },
    presentCall:args=>({card:'generic',title:args.action==='child'?'拆出子工作':'整理工作规格',kind:'other'}),
  })),'managed work specification and decomposition')
}
