import { defineConfig } from 'vitest/config'

/** Explicit lane: missing official build/env is an error, never a skipped test. */
export default defineConfig({
  cacheDir: '.local/tmp/vite-official-jobs',
  test: { cache: false, include: ['tests/work-execution-official-jobs.integration.ts'], environment: 'node', maxWorkers: 1, testTimeout: 15_000 },
})
