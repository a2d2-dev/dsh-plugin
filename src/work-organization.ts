import { continuationInFlight } from './work-execution/state.ts'
import { isTaskCompleted } from './work-completion/index.ts'
import { z } from 'zod'
import type { WorkSnapshot } from './work-schema.ts'
import type { TaskRef, WorkExecution, WorkResult, WorkTask } from './work-types.ts'

/** A local edge cannot establish necessity; use the explicitly accepted native scope. */
export function isAcceptedNativeChild(state: WorkSnapshot, parent: TaskRef, child: TaskRef): boolean {
  const parents = state.externalBindings.filter(binding => binding.ref.projectId === parent.projectId && binding.ref.taskId === parent.taskId)
  const children = state.externalBindings.filter(binding => binding.ref.projectId === child.projectId && binding.ref.taskId === child.taskId)
  if (parents.length !== 1 || children.length !== 1) return false
  const scope = parents[0]!.acceptedChildren ?? parents[0]!.accepted.subIssues, binding = children[0]!
  if (!scope || scope.hasNextPage || scope.totalCount !== scope.items.length || new Set(scope.items.map(item => item.nodeId)).size !== scope.items.length) return false
  return scope.items.some(item => item.nodeId === binding.nodeId && item.number === binding.accepted.number
    && item.repository.owner.toLowerCase() === binding.accepted.repository.owner.toLowerCase()
    && item.repository.repository.toLowerCase() === binding.accepted.repository.repository.toLowerCase())
}
const text=z.string().trim().min(1).max(100_000)
const specification={goal:text,specification:text,acceptance:z.array(text).min(1).max(1000)}
export const taskOrganizationSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('source-children'),expectedVersion:z.number().int().positive(),observedAt:z.string().datetime()}).strict(),
  z.object({kind:z.literal('specification'),expectedVersion:z.number().int().positive(),...specification}).strict(),
  z.object({kind:z.literal('child'),expectedVersion:z.number().int().positive(),title:text,...specification}).strict(),
])
export type TaskOrganization=z.infer<typeof taskOrganizationSchema>
/** Every business structure writer checks each affected existing Task. */
export function taskStructureBlocker(state: WorkSnapshot, task: WorkTask): { code: string; message: string } | undefined {
  if (isTaskCompleted(task)) return { code: 'task-completed', message: '已验收 Task 的业务结构保持冻结' }
  const execution = state.executions.find(item => item.ref.projectId === task.projectId && item.ref.taskId === task.id)
  if (execution && continuationInFlight(execution)) return { code: 'continuation-in-progress', message: '交接期间保留 Task 业务结构，接任后再更新' }
}
/** Current coordinator can preserve accepted specifications and accept native child scope. */
export function applyTaskOrganization(state:WorkSnapshot,execution:WorkExecution,intent:TaskOrganization,commandId:string,createId:()=>string):WorkResult {
  const task=state.tasks.find(item=>item.id===execution.ref.taskId&&item.projectId===execution.ref.projectId)!
  if(task.version!==intent.expectedVersion)return {status:'conflict',error:{code:'version-conflict',message:'工作已更新，请重新读取当前任务后再整理',currentVersion:task.version}}
  const blocked=taskStructureBlocker(state,task)
  if(blocked)return {status:'failed',error:blocked}
  // GitHub is the only primary store in this stage: a subtask is a native
  // sub-issue, and a local-only child Task is invalid cache. Creating one here
  // would mint a work item the coordinator can never start or accept.
  if(intent.kind==='child')return {status:'failed',error:{code:'local-subtask-not-supported',message:'现阶段 GitHub 是主存：子任务必须创建为原生 sub-issue 并通过来源导入；本地子 Task 记录无效，不参与完成门'}}
  let result:WorkTask=task
  if(intent.kind==='source-children') {
    const bindings=state.externalBindings.filter(item=>item.ref.projectId===task.projectId&&item.ref.taskId===task.id)
    if(bindings.length!==1)return {status:'failed',error:{code:'native-child-binding-required',message:'必要原生范围需要唯一已接受来源'}}
    const binding=bindings[0]!, observed=binding.lastObserved, children=observed.subIssues
    if(observed.observedAt!==intent.observedAt)return {status:'failed',error:{code:'source-observation-superseded',message:'请按当前读取的来源观察重新采纳'}}
    if(!children||children.hasNextPage||children.totalCount!==new Set(children.items.map(item=>item.nodeId)).size)return {status:'failed',error:{code:'native-child-scope-incomplete',message:'必要原生子项范围尚未完整读取'}}
    const previous=binding.acceptedChildren??binding.accepted.subIssues
    if(previous?.items.some(item=>!children.items.some(child=>child.nodeId===item.nodeId)))return {status:'failed',error:{code:'native-child-scope-shrunk',message:'新观察不能移除已接受的必要子项'}}
    binding.acceptedChildren={...structuredClone(children),observedAt:observed.observedAt}
  } else {
    task.specificationHistory.push(structuredClone(task.specification))
    task.specification={version:task.specification.version+1,text:intent.specification,acceptance:intent.acceptance}
    task.goal=intent.goal
  }
  task.version++
  task.activity.push({commandId,type:`task.organize-${intent.kind}`,version:task.version})
  return {status:'completed',task:result,execution}
}
