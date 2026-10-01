import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { A2d2ClientContext, ClientSessionListSnapshot, ClientSessionsService, ClientWorkspaceNavigation } from '../../src/client/context.ts'
import { SubagentModelTab } from '../../src/client/subagent-tab.tsx'

type ElementNode = {
  readonly type: unknown
  readonly props: Record<string, unknown>
  readonly children: readonly unknown[]
}

type EffectSlot = { readonly deps: readonly unknown[] | undefined; readonly cleanup?: () => void }

type Slot =
  | { readonly kind: 'memo'; readonly deps: readonly unknown[] | undefined; readonly value: unknown }
  | { readonly kind: 'ref'; readonly value: { current: unknown } }
  | { kind: 'state'; value: unknown }
  | ({ readonly kind: 'effect' } & EffectSlot)

const reactHarness = vi.hoisted(() => {
  const slots: Slot[] = []
  let cursor = 0

  function sameDeps(left: readonly unknown[] | undefined, right: readonly unknown[] | undefined): boolean {
    if (left === undefined || right === undefined) return false
    if (left.length !== right.length) return false
    return left.every((value, index) => Object.is(value, right[index]))
  }

  function beginRender(): void {
    cursor = 0
  }

  function reset(): void {
    for (const slot of slots) {
      if (slot?.kind === 'effect') slot.cleanup?.()
    }
    slots.length = 0
    cursor = 0
  }

  function createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown {
    const nextProps = children.length === 0 ? { ...(props ?? {}) } : { ...(props ?? {}), children }
    if (typeof type === 'function') {
      return (type as (props: Record<string, unknown>) => unknown)(nextProps)
    }
    return { type, props: nextProps, children } satisfies ElementNode
  }

  function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T {
    const index = cursor++
    const slot = slots[index]
    if (slot?.kind === 'memo' && sameDeps(slot.deps, deps)) return slot.value as T
    const value = factory()
    slots[index] = { kind: 'memo', deps, value }
    return value
  }

  function useCallback<T extends (...args: never[]) => unknown>(callback: T, deps?: readonly unknown[]): T {
    return useMemo(() => callback, deps)
  }

  function useRef<T>(initial: T): { current: T } {
    const index = cursor++
    const slot = slots[index]
    if (slot?.kind === 'ref') return slot.value as { current: T }
    const value = { current: initial }
    slots[index] = { kind: 'ref', value }
    return value
  }

  function useState<T>(initial: T): [T, (next: T | ((current: T) => T)) => void] {
    const index = cursor++
    let slot = slots[index]
    if (slot?.kind !== 'state') {
      slot = { kind: 'state', value: initial }
      slots[index] = slot
    }
    return [slot.value as T, (next) => {
      const current = slots[index]
      if (current?.kind !== 'state') return
      current.value = typeof next === 'function' ? (next as (value: T) => T)(current.value as T) : next
    }]
  }

  function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
    const index = cursor++
    const slot = slots[index]
    if (slot?.kind === 'effect' && sameDeps(slot.deps, deps)) return
    if (slot?.kind === 'effect') slot.cleanup?.()
    const cleanup = effect() ?? undefined
    slots[index] = { kind: 'effect', deps, cleanup }
  }

  function useSyncExternalStore<T>(_subscribe: (listener: () => void) => () => void, getSnapshot: () => T): T {
    cursor++
    return getSnapshot()
  }

  return {
    beginRender,
    reset,
    react: { createElement, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore },
  }
})

vi.mock('react', () => reactHarness.react)

const snapshot: ClientSessionListSnapshot = {
  byId: {
    root: {
      id: 'root',
      displayTitle: 'Main session',
      running: false,
      projectionValues: { a2d2Indicator: { route: { provider: 'claude', model: 'opus' } } },
    },
    child: {
      id: 'child',
      displayTitle: 'Child session',
      origin: 'subagent',
      parentId: 'root',
      running: false,
    },
  },
  projectionsBySession: {
    root: {
      values: { subagentCatalog: [{ id: 'child', mode: 'continuable', label: 'Child route' }] },
      state: 'ready',
      error: null,
    },
  },
}

function sessions(): ClientSessionsService {
  return {
    binding: () => undefined,
    scope: () => undefined,
    using: async (_target, _options, operation) => operation({ binding: { session: undefined as never } }),
    list: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    },
    refreshProjections: async () => {},
  }
}

function context(get: (name: string) => unknown): A2d2ClientContext {
  return { get } as unknown as A2d2ClientContext
}

function render(ctx: A2d2ClientContext): ElementNode {
  reactHarness.beginRender()
  return SubagentModelTab({ ctx, sessionId: 'root', visible: true }) as unknown as ElementNode
}

function findButtonByTitle(node: unknown, title: string): ElementNode {
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return findButtonByTitle(child, title)
      } catch {
        // Keep walking siblings.
      }
    }
    throw new Error(`button ${title} not found`)
  }
  if (isElementNode(node) && node.type === 'button' && node.props.title === title) return node
  if (!isElementNode(node)) throw new Error(`button ${title} not found`)
  for (const child of node.children) {
    try {
      return findButtonByTitle(child, title)
    } catch {
      // Keep walking siblings.
    }
  }
  throw new Error(`button ${title} not found`)
}

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value && 'children' in value
}

beforeEach(() => {
  reactHarness.reset()
  vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
})

afterEach(() => {
  reactHarness.reset()
  vi.unstubAllGlobals()
})

describe('SubagentModelTab', () => {
  it('uses the latest uiWorkspace service when a subagent card is clicked after the service appears', () => {
    let navigation: ClientWorkspaceNavigation | undefined
    const openSession = vi.fn()
    const ctx = context((name) => {
      if (name === 'sessions') return sessions()
      if (name === 'uiWorkspace') return navigation
      return undefined
    })

    render(ctx)
    navigation = { openSession, connectWorkspace: async () => 'next' }
    const tree = render(ctx)

    const childButton = findButtonByTitle(tree, 'child')
    ;(childButton.props.onClick as () => void)()

    expect(openSession).toHaveBeenCalledWith({ parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' })
  })

  it('keeps one route loader alive across rerenders even when ctx.get returns new service handles', () => {
    const projections = vi.fn((_payload: unknown, signal?: AbortSignal) => new Promise(() => { }))
    const ctx = context((name) => {
      if (name === 'sessions') return sessions()
      if (name === 'remote') return { session: { projections } }
      if (name === 'uiWorkspace') return { openSession: vi.fn(), connectWorkspace: async () => 'next' }
      return undefined
    })

    render(ctx)
    render(ctx)
    render(ctx)

    expect(projections).toHaveBeenCalledTimes(1)
    expect(projections.mock.calls[0]?.[0]).toEqual({ sessionId: 'child' })
    expect(projections.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect((projections.mock.calls[0]?.[1] as AbortSignal | undefined)?.aborted).toBe(false)
  })
})
