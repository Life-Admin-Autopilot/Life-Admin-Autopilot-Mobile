import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    // One mongodb-memory-server instance shared across files; run serially so
    // tests don't contend over the same in-memory database.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      // Mirror the frontend config: never count native scaffolding, E2E
      // flows, or deps against server coverage.
      exclude: ['ios/**', 'android/**', '.maestro/**', 'node_modules/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
})
