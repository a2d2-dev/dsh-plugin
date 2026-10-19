import type { WorkCommand, WorkCompleted, WorkQuery, WorkRequest, WorkResult } from '../work-types.ts'

/** Same-origin operator-authenticated work boundary. There is no local product fallback. */
export interface WorkClient {
  query(value: WorkQuery, signal?: AbortSignal): Promise<WorkCompleted>
  command(value: WorkCommand): Promise<WorkCompleted>
}
export function createWorkClient(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): WorkClient {
  async function request(payload: WorkRequest, signal?: AbortSignal): Promise<WorkCompleted> {
    const response = await fetcher('/a2d2/api/work', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload), signal,
    })
    let result: WorkResult
    try { result = await response.json() as WorkResult }
    catch { throw new Error(`工作服务返回无效响应（HTTP ${response.status}）`) }
    if (result?.status === 'failed' || result?.status === 'conflict') {
      throw new Error(`${result.error.code}: ${result.error.message}`)
    }
    if (!response.ok || result?.status !== 'completed') throw new Error(`工作服务不可用（HTTP ${response.status}）`)
    return result
  }
  return {
    query: (value, signal) => request({ kind: 'query', value }, signal),
    command: value => request({ kind: 'command', value }),
  }
}
