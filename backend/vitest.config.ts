import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // One in-memory MongoDB for the run; every test file uses its own database on it.
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup-env.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
