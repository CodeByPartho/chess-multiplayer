import { test, expect, type Page } from '@playwright/test'
import { TEST_BACKEND } from './test-backend'
import { clickButton, gotoPath, playRandomLegalMove, waitForPlyCount } from './helpers'

/**
 * Guest → account upgrade keeps the same player (rating + games carry over),
 * and the new email/password account can sign in again from a fresh browser
 * — even though that browser starts with a guest session active, which is
 * where GoTrue would otherwise try to link the two identities and refuse
 * with "Manual linking is disabled".
 */

const SB_URL = TEST_BACKEND.supabaseUrl
const SB_KEY = TEST_BACKEND.anonKey

const stamp = Date.now().toString(36)
const USERNAME = `Owl${stamp}`
const EMAIL = `fc-signup-${stamp}@probe.dev`
const PASSWORD = 'e2e-signup-pass-1'

let accountId = ''

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

async function moveAnyway(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (await playRandomLegalMove(page)) return
    await page.waitForTimeout(700)
  }
  throw new Error('no legal move could be played')
}

test.describe.serial('guest to account upgrade', () => {
  test('creating an account keeps the same player', async ({ browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const p1 = await ctx1.newPage()
    const p2 = await ctx2.newPage()
    try {
      // rated quick pair — guests are full players, rated games included
      for (const p of [p1, p2]) {
        await gotoPath(p, '/play')
        expect(await clickButton(p, 'Rated')).toBe(true)
        expect(await clickButton(p, 'Find an opponent')).toBe(true)
      }
      await p1.waitForURL(/\/play\/[0-9a-f-]{36}/, { timeout: 90_000 })
      await p2.waitForURL(/\/play\/[0-9a-f-]{36}/, { timeout: 90_000 })
      await p1.waitForSelector('.board')
      await p2.waitForSelector('.board')
      expect(new URL(p1.url()).pathname).toBe(new URL(p2.url()).pathname)
      const gameId = new URL(p1.url()).pathname.split('/').pop()!

      // rating needs 2 moves from each player — play 4 plies, then black resigns
      const p1Orient = await p1.getAttribute('.board', 'data-orientation')
      const white = p1Orient === 'w' ? p1 : p2
      const black = p1Orient === 'w' ? p2 : p1
      await moveAnyway(white)
      await waitForPlyCount(black, 1)
      await moveAnyway(black)
      await waitForPlyCount(white, 2)
      await moveAnyway(white)
      await waitForPlyCount(black, 3)
      await moveAnyway(black)
      await waitForPlyCount(white, 4)

      expect(await clickButton(black, 'Resign')).toBe(true)
      await black.locator('.modal-actions button', { hasText: 'Resign' }).click()
      for (const p of [p1, p2]) {
        await expect(p.locator('.result-banner')).toBeVisible({ timeout: 30_000 })
      }

      const uid = await sessionUserId(p1)
      expect(uid).toBeTruthy()

      // the server archive must have the finished game — that is the part
      // "your games move with you" is about
      let archived: Record<string, unknown>[] = []
      for (let i = 0; i < 40; i++) {
        archived = await restGet(`games?id=eq.${gameId}&select=id,status`)
        if (archived[0]?.status === 'over') break
        await p1.waitForTimeout(500)
      }
      expect(archived[0]?.status).toBe('over')

      // whatever rating data the guest has now must survive the upgrade
      const gamesBefore = await restGet(`games?or=(white_id.eq.${uid},black_id.eq.${uid})&select=id`)
      const ratingsBefore = await restGet(
        `ratings?user_id=eq.${uid}&select=category,rating,rd,games,wins,losses,draws`,
      )

      // upgrade through /login → "Create account"
      await gotoPath(p1, '/login')
      await p1.getByRole('tab', { name: 'Create account' }).click()
      expect(await clickButton(p1, 'Continue with email')).toBe(true)
      await p1.locator('#auth-name').waitFor({ state: 'visible', timeout: 15_000 })
      await p1.locator('#auth-name').fill(USERNAME)
      await expect(p1.locator('#auth-name-state')).toHaveText('available', { timeout: 15_000 })
      await p1.locator('#auth-email').fill(EMAIL)
      await p1.locator('#auth-password').fill(PASSWORD)
      await p1.locator('.auth-panel button[type="submit"]').click()

      // reloads onto the account chip with the claimed username
      await expect(p1.locator('.acct-btn:visible')).toContainText(USERNAME, { timeout: 45_000 })
      accountId = (await sessionUserId(p1)) ?? ''
      expect(accountId).toBe(uid)

      const profile = await restGet(`profiles?id=eq.${uid}&select=username`)
      expect(profile[0]?.username).toBe(USERNAME)
      const guest = await restGet(`guests?id=eq.${uid}&select=username`)
      expect(guest[0]?.username).toBe(USERNAME)

      const gamesAfter = await restGet(`games?or=(white_id.eq.${uid},black_id.eq.${uid})&select=id`)
      expect(gamesAfter.map((r) => r.id).sort()).toEqual(gamesBefore.map((r) => r.id).sort())
      const ratingsAfter = await restGet(
        `ratings?user_id=eq.${uid}&select=category,rating,rd,games,wins,losses,draws`,
      )
      expect(ratingsAfter).toEqual(ratingsBefore)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  test('the new account signs in from a fresh browser', async ({ browser }) => {
    test.skip(!accountId, 'account creation test did not finish')
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      // the trap: a guest session is already active when the user signs in
      await gotoPath(page, '/play')
      let guestId: string | null = null
      for (let i = 0; i < 20 && !guestId; i++) {
        guestId = await sessionUserId(page)
        if (!guestId) await page.waitForTimeout(500)
      }
      expect(guestId).toBeTruthy()

      await gotoPath(page, '/login')
      expect(await clickButton(page, 'Continue with email')).toBe(true)
      await page.locator('#auth-email').waitFor({ state: 'visible', timeout: 15_000 })
      await page.locator('#auth-email').fill(EMAIL)
      await page.locator('#auth-password').fill(PASSWORD)
      await page.locator('.auth-panel button[type="submit"]').click()

      await expect(page.locator('.acct-btn:visible')).toContainText(USERNAME, { timeout: 45_000 })
      const uid = await sessionUserId(page)
      expect(uid).toBe(accountId)
      expect(uid).not.toBe(guestId)
    } finally {
      await ctx.close()
    }
  })
})
