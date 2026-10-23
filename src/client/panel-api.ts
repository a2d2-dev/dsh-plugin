/**
 * Browser client for the panel task route.
 *
 * The browser supplies only the session id. Project paths stay host-side.
 *
 * @module @a2d2-dev/dsh-a2d2/client/panel-api
 */

import { PANEL_ROUTE_PATH } from '../panel-types.ts'
import type { PanelPayload } from '../panel-types.ts'
import { parsePanelPayload } from './panel-model.ts'

/** Result of one panel route read. */
export type PanelRead =
  | { readonly kind: 'ok'; readonly payload: PanelPayload }
  | { readonly kind: 'failed'; readonly message: string }

function envelopeFailure(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const envelope = body as { readonly ok?: unknown; readonly error?: { readonly message?: unknown } }
  if (envelope.ok !== false) return undefined
  return typeof envelope.error?.message === 'string' ? envelope.error.message : undefined
}

/** Fetch the task list for one session's project. */
export async function fetchPanel(sessionId: string, signal?: AbortSignal): Promise<PanelRead | undefined> {
  let response: Response
  try {
    response = await fetch(`${PANEL_ROUTE_PATH}?session=${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return undefined
    return { kind: 'failed', message: `无法连接宿主：${error instanceof Error ? error.message : String(error)}` }
  }
  const body = await response.json().catch(() => undefined)
  const failure = envelopeFailure(body)
  if (failure !== undefined) return { kind: 'failed', message: failure }
  if (typeof body !== 'object' || body === null || (body as { readonly ok?: unknown }).ok !== true) {
    if (response.status === 404) {
      return { kind: 'failed', message: '宿主还没有注册 A²D² 面板路由；宿主侧代码更新后需要重启 web server' }
    }
    return { kind: 'failed', message: `宿主返回了无法解析的响应（HTTP ${String(response.status)}）` }
  }
  const payload = parsePanelPayload((body as { readonly value?: unknown }).value)
  if (payload === undefined) {
    return { kind: 'failed', message: '宿主返回的任务数据不是这个面板认识的形状' }
  }
  return { kind: 'ok', payload }
}
