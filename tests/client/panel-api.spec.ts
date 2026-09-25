import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPanel } from '../../src/client/panel-api.ts'

const PAYLOAD = { root: '/tmp/project', tasks: [] }

function stubFetch(body: unknown, init: { readonly status?: number; readonly throws?: unknown } = {}): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => {
    if (init.throws !== undefined) throw init.throws
    return {
      status: init.status ?? 200,
      json: async () => body,
    }
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('panel API client', () => {
  it('returns the payload from an ok envelope', async () => {
    stubFetch({ ok: true, value: PAYLOAD })

    await expect(fetchPanel('session-abc')).resolves.toEqual({ kind: 'ok', payload: PAYLOAD })
  })

  it('asks with only an encoded session id', async () => {
    const mock = stubFetch({ ok: true, value: PAYLOAD })

    await fetchPanel('session-a b&cwd=/tmp/evil')

    expect(mock.mock.calls[0]?.[0]).toBe('/a2d2/api/tasks?session=session-a%20b%26cwd%3D%2Ftmp%2Fevil')
    expect(mock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', headers: { accept: 'application/json' } })
  })

  it('renders host refusals as failures', async () => {
    stubFetch({ ok: false, error: { code: 'no-working-directory', message: 'no cwd' } }, { status: 409 })

    await expect(fetchPanel('session-abc')).resolves.toEqual({ kind: 'failed', message: 'no cwd' })
  })

  it('reports malformed bodies and missing routes distinctly', async () => {
    stubFetch('<html>not json</html>', { status: 502 })
    await expect(fetchPanel('session-abc')).resolves.toMatchObject({ kind: 'failed', message: expect.stringContaining('502') })

    stubFetch('<html>missing</html>', { status: 404 })
    await expect(fetchPanel('session-abc')).resolves.toMatchObject({ kind: 'failed', message: expect.stringContaining('面板路由') })
  })

  it('refuses a payload with the wrong task shape', async () => {
    stubFetch({ ok: true, value: { root: '/tmp/project', tasks: [{ id: 'missing-fields' }] } })

    await expect(fetchPanel('session-abc')).resolves.toMatchObject({ kind: 'failed', message: expect.stringContaining('形状') })
  })

  it('reports transport failures but ignores aborts', async () => {
    stubFetch(undefined, { throws: new Error('connection refused') })
    await expect(fetchPanel('session-abc')).resolves.toMatchObject({ kind: 'failed', message: expect.stringContaining('connection refused') })

    stubFetch(undefined, { throws: new DOMException('aborted', 'AbortError') })
    await expect(fetchPanel('session-abc')).resolves.toBeUndefined()
  })
})
