import { defineConfig } from 'vitest/config'

export default defineConfig({
  envDir: false,
  test: {
    include: [
      'test/integration/postgres.integration.ts',
      'test/integration/billing.integration.ts',
      'test/test-database.test.ts'
    ],
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
