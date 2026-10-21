import { z } from 'zod'
import type { WorkSnapshot } from './work-schema.ts'
import type { WorkExecution, WorkResult, WorkTask } from './work-types.ts'
const text=z.string().trim().min(1).max(100_000)
const specification={goal:text,specification:text,acceptance:z.array(text).min(1).max(1000)}
export const taskOrganizationSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('specification'),expectedVersion:z.number().int().positive(),...specification}).strict(),
  z.object({kind:z.literal('child'),expectedVersion:z.number().int().positive(),title:text,...specification}).strict(),
])
export type TaskOrganization=z.infer<typeof taskOrganizationSchema>
/** Current coordinator can preserve accepted specifications and split real child work atomically. */
export function applyTaskOrganization(state:WorkSnapshot,execution:WorkExecution,intent:TaskOrganization,commandId:string,createId:()=>string):WorkResult {
  const task=state.tasks.find(item=>item.id===execution.ref.taskId&&item.projectId===execution.ref.projectId)!
  if(task.version!==intent.expectedVersion)return {status:'conflict',error:{code:'version-conflict',message:'工作已更新，请重新读取当前任务后再整理',currentVersion:task.version}}
  if(execution.continuation && execution.continuation.phase!=='delivered')return {status:'failed',error:{code:'continuation-in-progress',message:'交接期间保留规格与任务结构，接任后再更新'}}
  let result:WorkTask=task
  if(intent.kind==='specification') {
    task.specificationHistory.push(structuredClone(task.specification))
    task.specification={version:task.specification.version+1,text:intent.specification,acceptance:intent.acceptance}
    task.goal=intent.goal
  } else {
    result={id:createId(),projectId:task.projectId,title:intent.title,goal:intent.goal,version:1,agentId:task.agentId,
      specification:{version:1,text:intent.specification,acceptance:intent.acceptance},specificationHistory:[],breakdown:[],parent:execution.ref,children:[],sessions:[],
      activity:[{commandId,type:'task.organize-child',version:1}]}
    state.tasks.push(result)
    task.children.push({projectId:result.projectId,taskId:result.id})
  }
  task.version++
  task.activity.push({commandId,type:intent.kind==='child'?'task.organize-child':'task.organize-specification',version:task.version})
  return {status:'completed',task:result,execution}
}
