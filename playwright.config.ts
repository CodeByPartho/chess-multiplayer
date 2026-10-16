import { defineConfig } from '@playwright/test'
import { TEST_BACKEND, assertTestBackend } from './e2e/test-backend'

/**
 * The e2e suite creates users/games/ratings, so it runs against a dedicated
 * TEST Supabase project only. This guard runs when the config is loaded:
 * if the configured backend is missing or references production, Playwright
 * exits before it starts a server or touches the network.
 */
assertTestBackend()

// The app under test must be served with the TEST project's public URL + anon
// key. Vite gives real environment variables priority over `.env`, so these
// override the production values that live in `.env`.
const appEnv: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) appEnv[key] = value
}
appEnv.VITE_SUPABASE_URL = TEST_BACKEND.supabaseUrl
appEnv.VITE_SUPABASE_ANON_KEY = TEST_BACKEND.anonKey
// No captcha widget in tests: the Turnstile site key is a production/deploy knob.
delete appEnv.VITE_TURNSTILE_SITE_KEY

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  // Refuses to run when the test backend is missing/unsafe, and deletes the
  // rows the run created in the test backend afterwards.
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:5199',
    // traces/screencast add heavy per-frame overhead that stalls the shared
    // renderer when several Stockfish engines run at once — keep them off
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://localhost:5199',
    // Never reuse a server: it might have been started with production env.
    reuseExistingServer: false,
    timeout: 60_000,
    env: appEnv,
  },
})
