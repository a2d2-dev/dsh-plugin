import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { CANVAS_ASSET_PREFIX, createCanvasAssetHandler } from '../src/canvas-assets.ts'

let directory: string | undefined
// Only deletes the exact mkdtemp directory created in this test.
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

it('serves only bundled resources behind browser authentication', async () => {
  directory = await mkdtemp(join(tmpdir(), 'a2d2-canvas-'))
  await mkdir(join(directory, 'fonts', 'Virgil'), { recursive: true })
  await writeFile(join(directory, 'editor.js'), 'editor bundle')
  await writeFile(join(directory, 'fonts', 'Virgil', 'Virgil-Regular.woff2'), 'font')
  const root = pathToFileURL(`${directory}/`)
  async function request(path: string, method = 'GET', reject?: 401 | 403) {
    // DSH WebServer matches a prefix p as p itself or p + '/' + a suffix.
    if (path !== CANVAS_ASSET_PREFIX && !path.startsWith(`${CANVAS_ASSET_PREFIX}/`)) return { status: 404 }
    let status = 0
    let body: Uint8Array | string | undefined
    let headers: Record<string, string> | undefined
    await createCanvasAssetHandler(() => reject, root)({ method, url: path, headers: {} }, {
      writeHead: (code, value) => { status = code; headers = value }, end: value => { body = value },
    })
    return { status, body: body?.toString(), headers }
  }
  expect(await request('/a2d2/canvas/assets/editor.js', 'GET', 401)).toMatchObject({ status: 401 })
  expect(await request('/a2d2/canvas/assets/editor.js', 'GET', 403)).toMatchObject({ status: 403 })
  expect(await request('/a2d2/canvas/assets/editor.js')).toMatchObject({ status: 200, body: 'editor bundle' })
  expect(await request('/a2d2/canvas/assets/editor.js', 'HEAD')).toMatchObject({ status: 200, body: undefined })
  expect(await request('/a2d2/canvas/assets/fonts/Virgil/Virgil-Regular.woff2')).toMatchObject({ status: 200, body: 'font' })
  for (const path of ['../package.json', '%2e%2e/index.js', 'fonts/../../index.js', 'not-built.js']) {
    expect((await request(`/a2d2/canvas/assets/${path}`)).status).toBe(404)
  }
  expect((await request('/a2d2/canvas/assets/editor.js', 'POST')).status).toBe(405)
})
