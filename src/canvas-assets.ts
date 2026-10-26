import { readFile } from 'node:fs/promises'
import type { IncomingHttpHeaders } from 'node:http'
import type { RequestRejection } from './route-auth.ts'

export const CANVAS_ASSET_PREFIX = '/a2d2/canvas/assets/'

/** Only built editor resources are served; file access stays in Better Sidebar. */
export function createCanvasAssetHandler(requestRejection: RequestRejection, root = new URL('./canvas/', import.meta.url)) {
  return async (request: { method?: string; url?: string; headers: IncomingHttpHeaders }, response: {
    writeHead(status: number, headers?: Record<string, string>): void
    end(body?: Uint8Array | string): void
  }): Promise<void> => {
    const rejection = requestRejection(request)
    if (rejection !== undefined) { response.writeHead(rejection); response.end(); return }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return }
    const path = new URL(request.url ?? '/', 'http://a2d2.invalid').pathname.slice(CANVAS_ASSET_PREFIX.length)
    if (!/^(?:editor\.js|fonts\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.woff2)$/.test(path)) {
      response.writeHead(404); response.end(); return
    }
    const body = await readFile(new URL(path, root)).catch(() => undefined)
    if (body === undefined) { response.writeHead(404); response.end(); return }
    response.writeHead(200, {
      'content-type': path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'font/woff2',
      'cache-control': 'no-cache', 'x-content-type-options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  }
}
