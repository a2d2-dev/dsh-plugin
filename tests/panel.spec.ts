import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskId } from '../src/brand.ts'
import {
  PANEL_ROUTE_PATH,
  createPanelHandler,
  panelPayload,
} from '../src/panel.ts'
import type { PanelDependencies, PanelSession } from '../src/panel.ts'
import type { Task } from '../src/types.ts'

const sessionA = SessionId('session-a')
const sessionB = SessionId('session-b')
const uuidSession = SessionId('d12521d2-1ec2-494b-95a9-ebde5fa3db76')

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: TaskId('demo'),
    name: 'Demo',
    state: 'active',
    createdAt: '2026-09-20T00:00:00.000Z',
    members: [{ sessionId: sessionA }, { sessionId: sessionB, handoffFrom: sessionA }],
    ...overrides,
  }
}

function session(cwd = '/tmp/project'): PanelSession {
  return { header: { cwd } }
}

function deps(overrides: Partial<PanelDependencies> = {}): PanelDependencies {
  return {
    trustedHosts: () => ['trusted.example:3710'],
    getSession: id => id === sessionA ? session('/tmp/project') : undefined,
    listTasks: async () => [task()],
    projectRoot: async cwd => cwd,
    ...overrides,
  }
}

interface Recorded {
  status: number | undefined
  headers: Record<string, string> | undefined
  body: string | undefined
  response: {
    writeHead(status: number, headers?: Record<string, string>): void
    end(body?: string): void
  }
}

function record(): Recorded {
  const captured: Recorded = { status: undefined, headers: undefined, body: undefined, response: undefined as never }
  captured.response = {
    writeHead(status, headers) {
      captured.status = status
      captured.headers = headers
    },
    end(body) {
      captured.body = body
    },
  }
  return captured
}

function get(url = `${PANEL_ROUTE_PATH}?session=${sessionA}`, host = '127.0.0.1:3710') {
  return { method: 'GET', url, headers: { host } }
}

async function send(handler = createPanelHandler(deps()), request = get()): Promise<Recorded> {
  const captured = record()
  await handler(request, captured.response)
  return captured
}

describe('panel payload', () => {
  it('flattens task ids and handoff edges for the browser', () => {
    expect(panelPayload('/tmp/project', [task({ goal: 'ship it' })])).toEqual({
      root: '/tmp/project',
      tasks: [{
        id: 'demo',
        name: 'Demo',
        goal: 'ship it',
        state: 'active',
        createdAt: '2026-09-20T00:00:00.000Z',
        members: [{ sessionId: 'session-a' }, { sessionId: 'session-b', handoffFrom: 'session-a' }],
      }],
    })
  })

  it('omits optional goal and serves an empty project as an empty list', () => {
    expect(panelPayload('/tmp/project', [task()]).tasks[0]).not.toHaveProperty('goal')
    expect(panelPayload('/tmp/project', []).tasks).toEqual([])
  })
})

describe('panel route handler', () => {
  it('serves tasks for the project resolved from the session cwd', async () => {
    const listTasks = vi.fn(async () => [task()])
    const projectRoot = vi.fn(async (cwd: string) => `${cwd}/root`)
    const captured = await send(createPanelHandler(deps({ listTasks, projectRoot })))

    expect(captured.status).toBe(200)
    expect(captured.headers?.['cache-control']).toBe('no-store')
    expect(listTasks).toHaveBeenCalledWith('/tmp/project')
    expect(projectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(JSON.parse(captured.body ?? 'null')).toEqual({
      ok: true,
      value: panelPayload('/tmp/project/root', [task()]),
    })
  })

  it('rejects non-GET without reading a session', async () => {
    const getSession = vi.fn()
    const captured = await send(
      createPanelHandler(deps({ getSession })),
      { method: 'POST', url: `${PANEL_ROUTE_PATH}?session=${sessionA}`, headers: { host: '127.0.0.1:3710' } },
    )

    expect(captured.status).toBe(405)
    expect(getSession).not.toHaveBeenCalled()
    expect(JSON.parse(captured.body ?? 'null')).toMatchObject({ ok: false, error: { code: 'method-not-allowed' } })
  })

  it('reuses the consult trust fence', async () => {
    const getSession = vi.fn()
    const captured = await send(
      createPanelHandler(deps({ getSession })),
      get(`${PANEL_ROUTE_PATH}?session=${sessionA}`, 'trusted.example:9999'),
    )

    expect(captured.status).toBe(403)
    expect(getSession).not.toHaveBeenCalled()
    expect(JSON.parse(captured.body ?? 'null')).toMatchObject({ ok: false, error: { code: 'untrusted' } })
  })

  it('rejects a missing or unsafe session id', async () => {
    expect((await send(undefined, get(PANEL_ROUTE_PATH))).status).toBe(400)
    const unsafe = await send(undefined, get(`${PANEL_ROUTE_PATH}?session=../../etc/passwd`))
    expect(unsafe.status).toBe(400)
    expect(JSON.parse(unsafe.body ?? 'null')).toMatchObject({ ok: false, error: { code: 'missing-session' } })
  })

  it('accepts a pure UUID session id from in-process subagents', async () => {
    const getSession = vi.fn((id: SessionId) => id === uuidSession ? session('/tmp/subagent-project') : undefined)
    const captured = await send(createPanelHandler(deps({ getSession })), get(`${PANEL_ROUTE_PATH}?session=${uuidSession}`))

    expect(captured.status).toBe(200)
    expect(getSession).toHaveBeenCalledWith(uuidSession)
  })

  it.each([
    ['path separators', 'session/a'],
    ['dot segments', 'session-..'],
    ['encoded separators', 'session-a%2Fb'],
    ['percent signs', 'session-%25'],
    ['too long', `session-${'a'.repeat(122)}`],
  ])('rejects %s in session query parameters', async (_name, rawSession) => {
    const getSession = vi.fn()
    const captured = await send(createPanelHandler(deps({ getSession })), get(`${PANEL_ROUTE_PATH}?session=${rawSession}`))

    expect(captured.status).toBe(400)
    expect(getSession).not.toHaveBeenCalled()
    expect(JSON.parse(captured.body ?? 'null')).toMatchObject({ ok: false, error: { code: 'missing-session' } })
  })

  it('rejects a session the host does not hold', async () => {
    const captured = await send(undefined, get(`${PANEL_ROUTE_PATH}?session=session-missing`))

    expect(captured.status).toBe(404)
    expect(JSON.parse(captured.body ?? 'null')).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
  })

  it('rejects a session with no working directory', async () => {
    const captured = await send(createPanelHandler(deps({ getSession: () => ({ header: {} }) })))

    expect(captured.status).toBe(409)
    expect(JSON.parse(captured.body ?? 'null')).toMatchObject({ ok: false, error: { code: 'no-working-directory' } })
  })

  it('turns task read failures into response bodies', async () => {
    const captured = await send(createPanelHandler(deps({
      listTasks: async () => { throw new Error('EACCES') },
    })))

    expect(captured.status).toBe(500)
    const body = JSON.parse(captured.body ?? 'null') as { ok: false; error: { code: string; message: string } }
    expect(body.error.code).toBe('read-failed')
    expect(body.error.message).toContain('EACCES')
  })
})
