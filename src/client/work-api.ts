import type { WorkCommand, WorkCompleted, WorkFailure, WorkQuery, WorkRequest, WorkResult } from '../work-types.ts'
import { WORK_ROUTE_PATH } from '../work-types.ts'

/** Same-origin operator-authenticated work boundary. There is no local product fallback. */
export interface WorkClient {
  query(value: WorkQuery, signal?: AbortSignal): Promise<WorkCompleted>
  command(value: WorkCommand): Promise<WorkCompleted>
}
export class WorkClientError extends Error {
  constructor(readonly result: WorkFailure) { super(`${result.error.code}: ${result.error.message}`) }
}
export function createWorkClient(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): WorkClient {
  async function request(payload: WorkRequest, signal?: AbortSignal): Promise<WorkCompleted> {
    const response = await fetcher(WORK_ROUTE_PATH, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload), signal,
    })
    let result: WorkResult
    try { result = await response.json() as WorkResult }
    catch { throw new Error(`工作服务返回无效响应（HTTP ${response.status}）`) }
    if (result?.status === 'failed' || result?.status === 'conflict') {
      throw new WorkClientError(result)
    }
    if (!response.ok || result?.status !== 'completed') throw new Error(`工作服务不可用（HTTP ${response.status}）`)
    if (payload.kind === 'query') {
      const query = payload.value.type
      const valid = query === 'projects.list' ? Array.isArray(result.projects)
        : query === 'resources.list' ? Array.isArray(result.resources)
        : query === 'project.detail' ? result.project !== undefined && Array.isArray(result.tasks)
        : query === 'task.detail' ? result.task !== undefined
        : query === 'session.candidates' ? Array.isArray(result.candidates)
        : query === 'session.work' ? Array.isArray(result.work)
        : query === 'source.list' ? Array.isArray(result.sources)
        : query === 'source.progress' ? result.scan !== undefined && Number.isSafeInteger(result.scan.fetched) && Number.isSafeInteger(result.scan.pages)
        : query === 'source.issues' ? result.source !== undefined && result.page !== undefined && Array.isArray(result.page.items) && result.page.identity !== undefined
        : query === 'source.issue' ? result.source !== undefined && result.issue !== undefined
        : true
      if (!valid) throw new Error('工作服务返回的数据不符合查询合同')
    }
    return result
  }
  return {
    query: (value, signal) => request({ kind: 'query', value }, signal),
    command: value => request({ kind: 'command', value }),
  }
}
