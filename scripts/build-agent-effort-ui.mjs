import { build } from 'tsdown'
import { writeFile, mkdir } from 'node:fs/promises'
import config from '../tsdown.config.ts'

const outDir = 'tmp/agent-effort-ui'
await mkdir(outDir, { recursive: true })
await build({
  ...config[1],
  config: false,
  entry: { app: 'tests/client/agent-effort-ui.fixture.tsx' },
  outDir,
  format: 'iife',
  external: [],
  noExternal: () => true,
  sourcemap: false,
  outputOptions: { entryFileNames: 'app.js', codeSplitting: false },
})
await writeFile(`${outDir}/index.html`, '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent effort UI smoke test</title></head><body style="margin:0"><div id="root"></div><script src="app.js"></script></body></html>')
console.log(`UI fixture: ${outDir}/index.html`)
