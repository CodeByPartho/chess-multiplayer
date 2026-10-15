import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // e2e Playwright specs live in ./e2e and are run by `npm run test:e2e`
  },
})
