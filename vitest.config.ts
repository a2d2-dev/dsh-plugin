import { defineConfig } from 'vitest/config'

// These suites boot real DSH Agents and JSONL persistence. Recovery coverage also
// deliberately parks a host operation for 2.3s while asserting a separate 1.5s
// admission deadline. Give the whole scenario time to finish without changing
// its internal deadlines or the default 5s budget for ordinary unit tests.
const hostTests = [
  'tests/task-runtime.spec.ts',
  'tests/task-session-title-writer.spec.ts',
  'tests/session-title-live.spec.ts',
  'tests/work-compact-results.spec.ts',
  'tests/work-completion-native.spec.ts',
  'tests/work-continuation.spec.ts',
  'tests/work-continuous-integration.spec.ts',
  'tests/work-execution-boundary.spec.ts',
  'tests/work-execution-lifecycle.spec.ts',
  'tests/work-execution.spec.ts',
  'tests/work-goal-replay.spec.ts',
  'tests/work-host.spec.ts',
  'tests/work-progress.spec.ts',
  'tests/work-session-titles.spec.ts',
  'tests/work-source-freeze.spec.ts',
  'tests/work-startup-integration.spec.ts',
]

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.spec.ts'],
          exclude: hostTests,
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'host',
          include: hostTests,
          environment: 'node',
          maxWorkers: 1,
          testTimeout: 15_000,
        },
      },
    ],
  },
})
