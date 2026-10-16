import { test, expect, type Page } from '@playwright/test'
import { TEST_BACKEND } from './test-backend'
import { clickButton, gotoPath } from './helpers'

/**
 * Avatars: the picker offers curated public-domain portraits (`hist:<id>`
 * seeds, bundled with the app, no external requests) and a generated
 * identicon. Guests keep their choice locally; accounts persist it in
 * profiles.avatar_seed and every surface that renders an avatar — nav
 * chip, public profile, game records — resolves the same seed.
 *
 * The upload half of the feature talks to the `avatars` storage bucket,
 * which ships with the security migration — its end-to-end coverage lives
 * with that migration's tests.
 */

const SB_URL = TEST_BACKEND.supabaseUrl
const SB_KEY = TEST_BACKEND.anonKey

async function restGet(path: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  })
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}`)
  return (await res.json()) as Record<string, unknown>[]
}

/** supabase-js keeps the session (including the user) in localStorage */
async function sessionUserId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (!key) return null
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? '') as { user?: { id?: string } }
      return parsed.user?.id ?? null
    } catch {
      return null
    }
  })
}

test.describe.serial('avatars from chess history', () => {
  const stamp = Date.now().toString(36)
  const USERNAME = `Face${stamp}`
  const EMAIL = `fc-avatar-${stamp}@probe.dev`
  const PASSWORD = 'e2e-avatar-pass-1'

  test('a guest can pick a historical portrait', async ({ page }) => {
    await gotoPath(page, '/settings')
    // wait for the lazy route, then check the curated grid is there
    await page.locator('.avatar-grid [data-hist]').first().waitFor({ state: 'visible', timeout: 15_000 })
    const faces = await page.locator('.avatar-grid [data-hist]').count()
    expect(faces).toBeGreaterThanOrEqual(24)
    const cell = page.locator('[data-hist="morphy"]')
    await cell.scrollIntoViewIfNeeded()
    await cell.click()
    await expect(cell).toHaveAttribute('aria-selected', 'true')

    // the nav chip re-renders immediately with the bundled portrait
    const chip = page.locator('.nav-chip:visible img').first()
    await expect(chip).toHaveAttribute('src', /morphy.*\.jpg/, { timeout: 10_000 })

    // and the choice lives in the local identity
    const seed = await page.evaluate(
      () => (JSON.parse(localStorage.getItem('cm.identity') ?? '{}') as { avatarSeed?: string }).avatarSeed,
    )
    expect(seed).toBe('hist:morphy')

    // survives a reload
    await gotoPath(page, '/settings')
    await expect(page.locator('[data-hist="morphy"]')).toHaveAttribute('aria-selected', 'true')
  })

  test('an account keeps its portrait in profiles.avatar_seed', async ({ page }) => {
    await gotoPath(page, '/login')
    await page.getByRole('tab', { name: 'Create account' }).click()
    expect(await clickButton(page, 'Continue with email')).toBe(true)
    await page.locator('#auth-name').waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('#auth-name').fill(USERNAME)
    await expect(page.locator('#auth-name-state')).toHaveText('available', { timeout: 15_000 })
    await page.locator('#auth-email').fill(EMAIL)
    await page.locator('#auth-password').fill(PASSWORD)
    await page.locator('.auth-panel button[type="submit"]').click()
    await expect(page.locator('.acct-btn:visible')).toContainText(USERNAME, { timeout: 45_000 })
    const uid = await sessionUserId(page)
    expect(uid).toBeTruthy()

    await gotoPath(page, '/account')
    // the upload button only renders once the profile row is loaded
    await page.getByRole('button', { name: 'Upload avatar' }).waitFor({ state: 'visible', timeout: 20_000 })
    const cell = page.locator('[data-hist="capablanca"]')
    await cell.scrollIntoViewIfNeeded()
    await cell.click()
    expect(await clickButton(page, 'Save profile')).toBe(true)

    let seed = ''
    for (let i = 0; i < 30; i++) {
      const rows = await restGet(`profiles?id=eq.${uid}&select=avatar_seed,avatar_path`)
      seed = String(rows[0]?.avatar_seed ?? '')
      if (seed === 'hist:capablanca') break
      await page.waitForTimeout(400)
    }
    expect(seed).toBe('hist:capablanca')

    // visitors see the same face on the public profile
    await gotoPath(page, `/@${USERNAME}`)
    await expect(page.locator('.profile-head img')).toHaveAttribute('src', /capablanca.*\.jpg/, { timeout: 10_000 })
  })
})
