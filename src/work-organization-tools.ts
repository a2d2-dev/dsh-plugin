import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkApplication } from './work.ts'
import { taskOrganizationSchema } from './work-organization.ts'
import { modelWorkResult } from './work-model-details.ts'

export function installWorkOrganizationTools(ctx:Context,app:WorkApplication,runtimeId:string):void {
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'work_related_issue',
    description:'Read this managed Task accepted GitHub Issue or one of its already accepted necessary native children or native dependencies through the trusted source route. Omit node_id for the parent. Returns normalized source material and any canonical Task acceptance; it creates no Task or Session, grants no execution authority, and does not accept scope or completion. Closed or merged is not acceptance.',
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
    description:'Preserve your managed Task specification or accept a completely read parent native-child scope. Subtasks must be created as GitHub sub-issues and imported through the source route; this tool never creates a GitHub Issue or a local child Task. Short-lived work that one session can finish belongs in this Task or a DSH subagent delegation, not in a subtask. Use work_control status for ownership and the current Task version only. Use supplied startup material, or read all work_read specification pages if changed or missing. Extract acceptance criteria from the accepted Issue and explicit user decisions without inventing or unilaterally weakening requirements. Explicit user revisions supersede the affected old criteria: promptly sync the todo plan, persistent specification and dispatches; retain superseded requirements and the revision basis in history, not as current gates. Without an explicit revision, preserve original acceptance and order execution by real business dependencies. Missing auxiliary metrics are unverified; block execution only with evidence of obstruction to the current goal, data damage or invalid results. Keep safety and data boundaries; ask only when missing authorization materially changes scope.',
    parameters:{
      action:{type:'string',required:true,enum:['specification','source-children']},
      expected_version:{type:'integer',required:true,description:'Current Task version from work_control status.'},
      observed_at:{type:'string',description:'Required for source-children: exact parent observation from work_related_issue.'},
      goal:{type:'string'}, specification:{type:'string'},
      acceptance:{type:'array',items:{type:'string'},description:'Concrete accepted criteria, preserving all applicable requirements.'},
      expected_epoch:{type:'integer'},
    },
    output:{schema:{type:'object',additionalProperties:false,properties:{result:{type:'string',required:true}}},render:(_args,value)=>[{type:'text',text:value.result}]},
    async execute(args,exec){
      if(!exec.agent||exec.agent.session.id!==exec.agent.id)throw Error('work_organize requires a real current Agent Session')
      const organization=taskOrganizationSchema.parse(args.action==='source-children'?{kind:args.action,expectedVersion:args.expected_version,observedAt:args.observed_at}:{kind:args.action,expectedVersion:args.expected_version,goal:args.goal,specification:args.specification,acceptance:args.acceptance})
      const session={runtimeId,sessionId:exec.agent.id}
      return {result:JSON.stringify({action:args.action,...await modelWorkResult(app,session,await app.sessionOrganize(session,exec.callId,organization,args.expected_epoch),'organize')})}
    },
    presentCall:()=>({card:'generic',title:'整理工作规格',kind:'other'}),
  })),'managed work specification and native child scope')
}
