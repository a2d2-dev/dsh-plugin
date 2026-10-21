import { defineConfig } from 'vitest/config'

/** Explicit positive lane: install the four matching Host artifacts together in
 * an isolated fixture environment; stock rc2 negative contracts stay separate. */
export default defineConfig({
  test: { include: ['tests/work-completion-jobs.integration.ts'], environment: 'node' },
})
