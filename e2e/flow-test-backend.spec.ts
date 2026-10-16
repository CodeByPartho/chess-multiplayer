import { test, expect } from '@playwright/test'
import { PRODUCTION_REF, TEST_BACKEND, testProjectRef } from './test-backend'
import { gotoPath } from './helpers'

/**
 * Proof that the app under test really talks to the TEST backend.
 *
 * The suite writes users/games/ratings, so "which Supabase project is this
 * page using" is a safety assertion, not a nicety: if this fails, every other
 * spec would be writing to the wrong place.
 */
test('the app under test is wired to the test backend, never production', async ({ page }) => {
  const ref = testProjectRef()
  expect(ref, 'test project ref configured').toBeTruthy()
  expect(ref).not.toBe(PRODUCTION_REF)

  await gotoPath(page, '/play')

  // a guest session is created on first visit; supabase-js names the storage
  // key after the project ref of the URL it was built with
  await page.waitForFunction(
    () => Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.includes('auth-token')),
    null,
    { timeout: 30_000 },
  )

  const keys = await page.evaluate(() => Object.keys(localStorage))
  expect(keys.some((k) => k.startsWith(`sb-${ref}-auth-token`)), `session key uses ${ref}`).toBe(true)
  expect(keys.some((k) => k.includes(PRODUCTION_REF)), 'no production session key').toBe(false)

  // and the in-page client can actually reach that backend
  const reachable = await page.evaluate(
    async ({ api, key }) => {
      const res = await fetch(`${api}/rest/v1/puzzles?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      })
      return res.status
    },
    { api: TEST_BACKEND.supabaseUrl, key: TEST_BACKEND.anonKey },
  )
  expect(reachable).toBe(200)
})
