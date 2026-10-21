import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkApplication } from './work.ts'
import { taskOrganizationSchema } from './work-organization.ts'

export function installWorkOrganizationTools(ctx:Context,app:WorkApplication,runtimeId:string):void {
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'work_organize',
    description:'Preserve your managed Task specification or create a real linked local child task. Read work_control status first for the current Task version. Extract acceptance criteria from the accepted Issue or user decisions without inventing, removing or weakening requirements; ask when unclear. Creating a child preserves the parent relationship and does not create a GitHub Issue or start a child Session.',
    parameters:{
      action:{type:'string',required:true,enum:['specification','child']},
      expected_version:{type:'integer',required:true,description:'Current Task version from work_control status.'},
      title:{type:'string',description:'Required only for a new child task.'},
      goal:{type:'string',required:true}, specification:{type:'string',required:true},
      acceptance:{type:'array',required:true,items:{type:'string'},description:'Concrete accepted criteria, preserving all applicable requirements.'},
      expected_epoch:{type:'integer'},
    },
    output:{schema:{type:'object',additionalProperties:false,properties:{result:{type:'string',required:true}}},render:(_args,value)=>[{type:'text',text:value.result}]},
    async execute(args,exec){
      if(!exec.agent||exec.agent.session.id!==exec.agent.id)throw Error('work_organize requires a real current Agent Session')
      const organization=taskOrganizationSchema.parse({kind:args.action,expectedVersion:args.expected_version,goal:args.goal,specification:args.specification,acceptance:args.acceptance,...(args.action==='child'?{title:args.title}:{})})
      return {result:JSON.stringify(await app.sessionOrganize({runtimeId,sessionId:exec.agent.id},exec.callId,organization,args.expected_epoch))}
    },
    presentCall:args=>({card:'generic',title:args.action==='child'?'拆出子工作':'整理工作规格',kind:'other'}),
  })),'managed work specification and decomposition')
}
