/**
 * The orb's one-click handoff: the order of the four steps it drives, the
 * failure stage each step reports, and the wait for the session's own writing
 * turn.
 *
 * The session faces here are hand-written rather than mocked transports: the
 * wait reads exactly three things — `getSnapshot().running`, `subscribe`, and
 * the disposer that installs it — so a test can drive the run and observe the
 * disposal directly.
 *
 * @module dsh-a2d2/tests/client/orb-actions
 */

import { describe, expect, it, vi } from 'vitest'
import {
  ORB_TURN_START_TIMEOUT_MS,
  ORB_TURN_TIMEOUT_MS,
  awaitWritingTurn,
  handoffLine,
  inheritedTitle,
  nextTitle,
  runOrbHandoff,
  workspaceOf,
} from '../../src/client/orb-actions.ts'
import { DEFAULT_STAGE_AGENTS } from '../../src/stage-agent-data.ts'
import type { OrbHandoffDeps } from '../../src/client/orb-actions.ts'
import type { ClientModelDirectoryService } from '../../src/client/consult-actions.ts'
import type {
  ClientCommandResult,
  ClientSessionFace,
  ClientSessionsService,
  ClientWorkspacesService,
} from '../../src/client/context.ts'

const CURRENT = 'session-current'
const SUCCESSOR = 'session-next'
const WORKSPACE = 'workspace-1'

/** The admission result a session face returns for a line it ran. */
const accepted: ClientCommandResult = { ok: true, value: { matched: true } }

/**
 * The budgets a test passes so a bounded wait is observed in a few milliseconds.
 *
 * A short real budget is enough and needs no fake timers: nothing else can
 * settle a wait, so a wait that expires always expires at this budget.
 */
const QUICK: Pick<OrbHandoffDeps, 'startTimeoutMs' | 'turnTimeoutMs'> = {
  startTimeoutMs: 20,
  turnTimeoutMs: 20,
}

/** What one fake session face exposes to the test driving it. */
interface FakeSession {
  readonly face: ClientSessionFace
  /** The command lines this session was asked to run, in order. */
  readonly commands: string[]
  /** The titles this session was asked to rename to, in order. */
  readonly renames: string[]
  /** Set the host's `running` fact and notify subscribers, as the transport does. */
  setRunning(running: boolean): void
  /** How many listeners are attached right now. */
  listeners(): number
  /** How many times a listener has been installed. */
  subscriptions(): number
}

/**
 * A session face whose `running` fact and admitted commands a test drives.
 * @param options - the initial `running` flag, and the command implementation.
 * @returns the face plus the controls a test uses to drive it.
 */
function fakeSession(options: {
  running?: boolean
  command?: (line: string, control: { setRunning(running: boolean): void }) => Promise<ClientCommandResult>
  rename?: (title: string) => Promise<{ readonly ok: boolean }>
} = {}): FakeSession {
  const attached = new Set<() => void>()
  const commands: string[] = []
  const renames: string[] = []
  let installed = 0
  let running = options.running ?? false
  const setRunning = (value: boolean): void => {
    running = value
    for (const listener of [...attached]) listener()
  }
  const face: ClientSessionFace = {
    projections: { faceOf: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) },
    command: async (line: string) => {
      commands.push(line)
      return await (options.command ?? (async () => accepted))(line, { setRunning })
    },
    rename: async (title: string) => {
      renames.push(title)
      return await (options.rename ?? (async () => ({ ok: true })))(title)
    },
    getSnapshot: () => ({ running }),
    subscribe: (listener: () => void) => {
      installed += 1
      attached.add(listener)
      return () => {
        attached.delete(listener)
      }
    },
  }
  return {
    face,
    commands,
    renames,
    setRunning,
    listeners: () => attached.size,
    subscriptions: () => installed,
  }
}

/** The turn a session runs after `/handoff`: it starts the run, then ends it. */
function runWritingTurn(control: { setRunning(running: boolean): void }): void {
  control.setRunning(true)
  setTimeout(() => control.setRunning(false), 0)
}

/** The handing-off session's face: it admits every line and runs the writing turn. */
function writingSession(): FakeSession {
  return fakeSession({
    command: async (_line, control) => {
      runWritingTurn(control)
      return accepted
    },
  })
}

/** A sessions double resolving the faces a test supplies, recording what it was asked to do. */
function sessions(
  faces: Readonly<Record<string, FakeSession>>,
  log: string[] = [],
  titles: Readonly<Record<string, string>> = {},
): ClientSessionsService & { readonly opened: string[]; open(id: string): void } {
  const opened: string[] = []
  const byId = Object.fromEntries(
    Object.keys(faces).map(id => [id, titles[id] === undefined ? {} : { title: titles[id] }]),
  )
  return {
    binding: (id: string) => {
      const fake = faces[id]
      return fake === undefined ? undefined : { session: fake.face }
    },
    scope: () => undefined,
    using: async (id: string, _options: unknown, operation: (reference: { binding: { session: FakeSession['face'] } }) => unknown) => {
      const fake = faces[id]
      if (fake === undefined) throw new Error(`session ${id} is not available`)
      return await operation({ binding: { session: fake.face } })
    },
    open: (id: string) => {
      log.push(`open ${id}`)
      opened.push(id)
    },
    list: { getSnapshot: () => ({ byId, projectionsBySession: {} }), subscribe: () => () => {} },
    opened,
  } as unknown as ClientSessionsService & { readonly opened: string[]; open(id: string): void }
}

/** A workspaces double whose list accounts the current session under one workspace. */
function workspaces(
  overrides: Partial<{
    items: { workspaceId: string; sessionIds: string[] }[]
    connect: (id: string) => Promise<string>
  }> = {},
): ClientWorkspacesService & { connectWorkspace(id: string): Promise<string> } {
  const items = overrides.items ?? [{ workspaceId: WORKSPACE, sessionIds: [CURRENT] }]
  return {
    list: { getSnapshot: () => ({ items }) },
    connectWorkspace: overrides.connect ?? (async () => SUCCESSOR),
  }
}

/** The handoff's service triple: `uiWorkspace` navigation records into the sessions double and connects through the workspaces double. */
function handoffDeps(
  s: ClientSessionsService & { open(id: string): void },
  w: ClientWorkspacesService & { connectWorkspace(id: string): Promise<string> },
): Pick<OrbHandoffDeps, 'sessions' | 'workspaces' | 'navigation'> {
  return {
    sessions: s,
    workspaces: w,
    navigation: {
      openSession: (target) => { s.open(typeof target === 'string' ? target : target.childSessionId) },
      connectWorkspace: id => w.connectWorkspace(id),
    },
  }
}

function successorModelDirectory(
  events: string[],
  options: { readonly select?: (route: string) => Promise<void> } = {},
): ClientModelDirectoryService {
  return {
    directoryFor: (sessionId: string) => {
      events.push(`directory:${sessionId}`)
      return {
        load: async () => {
          events.push('load')
          return {
            current: { provider: 'claude-bray', model: 'claude-fable-5-1' },
            catalog: ['codex/gpt-5.5', 'claude-bray/claude-fable-5-1'],
          }
        },
        select: async (selection) => {
          const route = `${selection.provider}/${selection.model}`
          events.push(`select:${route}`)
          await options.select?.(route)
        },
      }
    },
  }
}

/** Let the microtasks of a wait settle before a test observes the face again. */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
}

describe('workspaceOf', () => {
  it('finds the workspace that accounts a session', () => {
    expect(workspaceOf(workspaces(), CURRENT)).toBe(WORKSPACE)
  })

  it('is undefined when no workspace lists the session', () => {
    expect(workspaceOf(workspaces({ items: [{ workspaceId: WORKSPACE, sessionIds: ['other'] }] }), CURRENT)).toBeUndefined()
  })
})

describe('handoffLine', () => {
  it('asks for a generic handoff when no focus is stated', () => {
    expect(handoffLine(undefined)).toBe('/handoff')
    expect(handoffLine('')).toBe('/handoff')
    expect(handoffLine('   ')).toBe('/handoff')
  })

  it('flattens a focus onto the one line the grammar reads', () => {
    expect(handoffLine('  finish  the\n store layer ')).toBe('/handoff finish the store layer')
  })
})

describe('awaitWritingTurn', () => {
  it('bounds both waits, so a wait that ends reports which one expired', () => {
    expect(ORB_TURN_START_TIMEOUT_MS).toBe(30_000)
    expect(ORB_TURN_TIMEOUT_MS).toBe(600_000)
  })

  it('reports finished for a session that is already running and then stops', async () => {
    const session = fakeSession({ running: true })
    const wait = awaitWritingTurn(session.face, QUICK)

    // The run is already visible, so the wait subscribes to watch it end.
    await flush()
    expect(session.subscriptions()).toBe(1)
    expect(session.listeners()).toBe(1)
    session.setRunning(false)
    expect(await wait).toBe('finished')
    expect(session.listeners()).toBe(0)
  })

  it('reports finished for a session that picks the turn up and then stops', async () => {
    const session = fakeSession()
    const wait = awaitWritingTurn(session.face, QUICK)

    session.setRunning(true)
    await flush()
    session.setRunning(false)
    expect(await wait).toBe('finished')
    expect(session.listeners()).toBe(0)
  })

  it('reports never-started when the session never runs the turn', async () => {
    const session = fakeSession()
    expect(await awaitWritingTurn(session.face, QUICK)).toBe('never-started')
    expect(session.subscriptions()).toBe(1)
    expect(session.listeners()).toBe(0)
  })

  it('reports timeout when the session never ends its turn', async () => {
    const session = fakeSession({ running: true })
    expect(await awaitWritingTurn(session.face, QUICK)).toBe('timeout')
    expect(session.subscriptions()).toBe(1)
    expect(session.listeners()).toBe(0)
  })
})

describe('runOrbHandoff', () => {
  it('hands off on the session it sits on, then creates and takes in the successor', async () => {
    const log: string[] = []
    const current = writingSession()
    const successor = fakeSession({
      command: async (line) => {
        log.push(`take ${line}`)
        return accepted
      },
    })
    const connect = vi.fn(async () => {
      log.push('connect')
      return SUCCESSOR
    })

    const s = sessions({ [CURRENT]: current, [SUCCESSOR]: successor }, log)
    const outcome = await runOrbHandoff(
      { ...handoffDeps(s, workspaces({ connect })), ...QUICK },
      CURRENT,
      'finish the store',
    )

    expect(outcome).toEqual({ ok: true, successor: SUCCESSOR })
    expect(current.commands).toEqual(['/handoff finish the store'])
    expect(connect).toHaveBeenCalledWith(WORKSPACE)
    expect(log).toEqual(['connect', `open ${SUCCESSOR}`, `take /handoff take ${CURRENT}`])
  })

  it('selects the successor station model after create and before take', async () => {
    const log: string[] = []
    const current = writingSession()
    const successor = fakeSession({
      command: async (line) => {
        log.push(`take ${line}`)
        return accepted
      },
    })
    const connect = vi.fn(async () => {
      log.push('connect')
      return SUCCESSOR
    })

    const outcome = await runOrbHandoff(
      {
        ...handoffDeps(sessions({ [CURRENT]: current, [SUCCESSOR]: successor }, log), workspaces({ connect })),
        modelDirectories: successorModelDirectory(log),
        successorModel: {
          station: 'implement',
          stageAgents: { stages: DEFAULT_STAGE_AGENTS.stages, agents: DEFAULT_STAGE_AGENTS.agents },
        },
        ...QUICK,
      },
      CURRENT,
      'implement #15',
    )

    expect(outcome).toEqual({ ok: true, successor: SUCCESSOR })
    expect(log).toEqual([
      'connect',
      `directory:${SUCCESSOR}`,
      'load',
      'select:codex/gpt-5.5',
      `open ${SUCCESSOR}`,
      `take /handoff take ${CURRENT}`,
    ])
  })

  it('reports successor model selection failure and still takes the handoff', async () => {
    const log: string[] = []
    const notify = vi.fn((message: string) => { log.push(`notify:${message}`) })
    const current = writingSession()
    const successor = fakeSession({
      command: async (line) => {
        log.push(`take ${line}`)
        return accepted
      },
    })
    const connect = vi.fn(async () => {
      log.push('connect')
      return SUCCESSOR
    })

    const outcome = await runOrbHandoff(
      {
        ...handoffDeps(sessions({ [CURRENT]: current, [SUCCESSOR]: successor }, log), workspaces({ connect })),
        modelDirectories: successorModelDirectory(log, {
          select: async () => { throw new Error('adapter rejected the model') },
        }),
        successorModel: {
          station: 'implement',
          stageAgents: { stages: DEFAULT_STAGE_AGENTS.stages, agents: DEFAULT_STAGE_AGENTS.agents },
        },
        notify,
        ...QUICK,
      },
      CURRENT,
      'implement #15',
    )

    expect(outcome).toEqual({ ok: true, successor: SUCCESSOR })
    expect(notify).toHaveBeenCalledWith('选择后继会话模型失败：adapter rejected the model')
    expect(log).toEqual([
      'connect',
      `directory:${SUCCESSOR}`,
      'load',
      'select:codex/gpt-5.5',
      'notify:选择后继会话模型失败：adapter rejected the model',
      `open ${SUCCESSOR}`,
      `take /handoff take ${CURRENT}`,
    ])
  })

  it('asks for a generic handoff when the focus is blank', async () => {
    const current = writingSession()
    const outcome = await runOrbHandoff(
      { ...handoffDeps(sessions({ [CURRENT]: current, [SUCCESSOR]: fakeSession() }), workspaces()), ...QUICK },
      CURRENT,
      '   ',
    )
    expect(outcome).toEqual({ ok: true, successor: SUCCESSOR })
    expect(current.commands).toEqual(['/handoff'])
  })

  it('stops at prepare when the session is not addressable', async () => {
    const outcome = await runOrbHandoff(
      { ...handoffDeps(sessions({}), workspaces()), ...QUICK },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({ ok: false, stage: 'prepare', error: 'this session is not addressable yet' })
  })

  it('stops at prepare when the command throws', async () => {
    const current = fakeSession({ command: async () => { throw new Error('transport down') } })
    const outcome = await runOrbHandoff(
      { ...handoffDeps(sessions({ [CURRENT]: current }), workspaces()), ...QUICK },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({ ok: false, stage: 'prepare', error: 'transport down' })
  })

  it('stops at prepare when the session refuses the command', async () => {
    const current = fakeSession({ command: async () => ({ ok: false }) })
    const s = sessions({ [CURRENT]: current })
    const outcome = await runOrbHandoff(
      { ...handoffDeps(s, workspaces()), ...QUICK },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({ ok: false, stage: 'prepare', error: 'this session refused `/handoff`' })
    expect(s.opened).toEqual([])
  })

  it('stops at summary when the writing turn never starts', async () => {
    const connect = vi.fn(async () => SUCCESSOR)
    const current = fakeSession({ command: async () => accepted })
    const outcome = await runOrbHandoff(
      { ...handoffDeps(sessions({ [CURRENT]: current }), workspaces({ connect })), ...QUICK },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({
      ok: false,
      stage: 'summary',
      error: 'this session never started writing the summary, so no handoff was recorded',
    })
    expect(connect).not.toHaveBeenCalled()
    expect(current.listeners()).toBe(0)
  })

  it('stops at summary when the writing turn never finishes', async () => {
    const connect = vi.fn(async () => SUCCESSOR)
    const current = fakeSession({
      command: async (_line, control) => {
        control.setRunning(true)
        return accepted
      },
    })
    const outcome = await runOrbHandoff(
      { ...handoffDeps(sessions({ [CURRENT]: current }), workspaces({ connect })), ...QUICK },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({
      ok: false,
      stage: 'summary',
      error: 'this session is still writing the summary; take the handoff again once it finishes',
    })
    expect(connect).not.toHaveBeenCalled()
    expect(current.listeners()).toBe(0)
  })

  it('stops at workspace when no workspace accounts the session', async () => {
    const current = writingSession()
    const outcome = await runOrbHandoff(
      {
        ...handoffDeps(sessions({ [CURRENT]: current }), workspaces({ items: [] })),
        ...QUICK,
      },
      CURRENT,
      undefined,
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.stage).toBe('workspace')
  })

  it('stops at create when connecting the workspace throws', async () => {
    const current = writingSession()
    const outcome = await runOrbHandoff(
      {
        ...handoffDeps(sessions({ [CURRENT]: current }), workspaces({ connect: async () => { throw new Error('connect failed') } })),
        ...QUICK,
      },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({ ok: false, stage: 'create', error: 'connect failed' })
  })

  it('stops at create, without moving focus, when the successor cannot be opened', async () => {
    const current = writingSession()
    const s = sessions({ [CURRENT]: current })
    const outcome = await runOrbHandoff(
      { ...handoffDeps(s, workspaces()), ...QUICK },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({
      ok: false,
      stage: 'create',
      error: `session ${SUCCESSOR} is not available`,
    })
    expect(s.opened).toEqual([])
  })

  it('stops at take when the successor refuses the command', async () => {
    const current = writingSession()
    const successor = fakeSession({ command: async () => ({ ok: false }) })
    const s = sessions({ [CURRENT]: current, [SUCCESSOR]: successor })
    const outcome = await runOrbHandoff(
      { ...handoffDeps(s, workspaces()), ...QUICK },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({
      ok: false,
      stage: 'take',
      error: `the successor session refused \`/handoff take ${CURRENT}\``,
    })
    // The successor was focused before the take, so the user watches it land.
    expect(s.opened).toEqual([SUCCESSOR])
    expect(successor.commands).toEqual([`/handoff take ${CURRENT}`])
  })

  it('stops at take when the command throws', async () => {
    const current = writingSession()
    const successor = fakeSession({ command: async () => { throw new Error('take transport down') } })
    const outcome = await runOrbHandoff(
      { ...handoffDeps(sessions({ [CURRENT]: current, [SUCCESSOR]: successor }), workspaces()), ...QUICK },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({ ok: false, stage: 'take', error: 'take transport down' })
  })

  it('renames the successor to the incremented source title before the take', async () => {
    const current = writingSession()
    const successor = fakeSession()
    const outcome = await runOrbHandoff(
      {
        ...handoffDeps(sessions({ [CURRENT]: current, [SUCCESSOR]: successor }, [], { [CURRENT]: 'Ship the store' }), workspaces()),
        ...QUICK,
      },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({ ok: true, successor: SUCCESSOR })
    expect(successor.renames).toEqual(['Ship the store (1)'])
  })

  it('skips the rename when the source session has no title', async () => {
    const current = writingSession()
    const successor = fakeSession()
    const outcome = await runOrbHandoff(
      { ...handoffDeps(sessions({ [CURRENT]: current, [SUCCESSOR]: successor }), workspaces()), ...QUICK },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({ ok: true, successor: SUCCESSOR })
    expect(successor.renames).toEqual([])
  })

  it('completes the handoff when the rename is rejected', async () => {
    const current = writingSession()
    const successor = fakeSession({ rename: async () => ({ ok: false }) })
    const outcome = await runOrbHandoff(
      {
        ...handoffDeps(sessions({ [CURRENT]: current, [SUCCESSOR]: successor }, [], { [CURRENT]: 'Ship the store' }), workspaces()),
        ...QUICK,
      },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({ ok: true, successor: SUCCESSOR })
    expect(successor.commands).toEqual([`/handoff take ${CURRENT}`])
  })

  it('completes the handoff when the rename throws', async () => {
    const current = writingSession()
    const successor = fakeSession({ rename: async () => { throw new Error('rename transport down') } })
    const outcome = await runOrbHandoff(
      {
        ...handoffDeps(sessions({ [CURRENT]: current, [SUCCESSOR]: successor }, [], { [CURRENT]: 'Ship the store' }), workspaces()),
        ...QUICK,
      },
      CURRENT,
      undefined,
    )
    expect(outcome).toEqual({ ok: true, successor: SUCCESSOR })
    expect(successor.commands).toEqual([`/handoff take ${CURRENT}`])
  })
})

describe('inheritedTitle', () => {
  it('returns the source session title', () => {
    const s = sessions({ [CURRENT]: fakeSession() }, [], { [CURRENT]: 'Ship the store' })
    expect(inheritedTitle(s, CURRENT)).toBe('Ship the store')
  })

  it('returns undefined for a blank or missing title', () => {
    const blank = sessions({ [CURRENT]: fakeSession() }, [], { [CURRENT]: '   ' })
    expect(inheritedTitle(blank, CURRENT)).toBeUndefined()
    const missing = sessions({ [CURRENT]: fakeSession() })
    expect(inheritedTitle(missing, CURRENT)).toBeUndefined()
  })
})

describe('nextTitle', () => {
  it('appends (1) to an unnumbered title', () => {
    expect(nextTitle('Ship the store')).toBe('Ship the store (1)')
  })

  it('increments a trailing ASCII number', () => {
    expect(nextTitle('Ship the store (1)')).toBe('Ship the store (2)')
    expect(nextTitle('Ship the store (9)')).toBe('Ship the store (10)')
  })

  it('increments a trailing fullwidth number in its own style', () => {
    expect(nextTitle('实现插件（1）')).toBe('实现插件（2）')
  })
})
