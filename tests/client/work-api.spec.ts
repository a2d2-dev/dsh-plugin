import { describe, expect, it } from 'vitest'
import { createWorkClient } from '../../src/client/work-api.ts'

describe('trusted work HTTP boundary', () => {
  it('rejects a completed query that omits its project projection instead of showing an empty project list',async()=>{
    const client=createWorkClient(async()=>new Response(JSON.stringify({status:'completed'})))
    await expect(client.query({type:'projects.list'})).rejects.toThrow('工作服务返回的数据不符合查询合同')
  })
  it('queries projects without any session or directory and preserves named refusals', async () => {
    const requests: {url: string; init?: RequestInit}[] = []
    const client = createWorkClient(async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(JSON.stringify({ status: 'failed', error: { code: 'forbidden', message: '资源不可访问' } }), { status: 403 })
    })
    await expect(client.query({ type: 'projects.list' })).rejects.toThrow('forbidden: 资源不可访问')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('/a2d2/api/work')
    expect(requests[0]?.init).toMatchObject({method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }})
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({kind: 'query', value: {type:'projects.list'}})
  })
})
