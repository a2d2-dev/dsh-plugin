import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // Host fixtures use real file locks and durable storage. Bound concurrency
    // consistently on developer workstations and CI rather than raising timeouts.
    maxWorkers: 2,
  },
})
