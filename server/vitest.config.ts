import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // mongodb-memory-server needs time to boot a fresh mongod per run.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // The dev server holds its own MongoDB; tests use an isolated memory instance.
    isolate: true,
  },
});