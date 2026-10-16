import { test, expect, type Page } from '@playwright/test'
import { TEST_BACKEND } from './test-backend'
import { clickButton, gotoPath, playRandomLegalMove, waitForPlyCount } from './helpers'

/**
 * A finished rated game must change the guest's visible rating everywhere:
 * the result card matches the database, and the guest chip + guest profile
 * (which read the local identity) pick the new value up without a reload —
 * no matter which side's client finalized the game first.
 *
 * Uses 1+0 (bullet) so it can never cross-pair with the rated blitz queue
 * of flow-signup while workers run specs in parallel.
 */

const SB_URL = TEST_BACKEND.supabaseUrl
const SB_KEY = TEST_BACKEND.anonKey
const POOL = 'bullet'

async function restGet(path: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  })
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}`)
  return (await res.json()) as Record<string, unknown>[]
}

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

async function localRating(page: Page, pool: string): Promise<number | null> {
  return page.evaluate((p) => {
    try {
      const id = JSON.parse(localStorage.getItem('cm.identity') ?? 'null') as {
        ratings?: Record<string, { rating: number }>
      }
      return id?.ratings?.[p]?.rating ?? null
    } catch {
      return null
    }
  }, pool)
}

async function waitForLocalRating(page: Page, pool: string, expected: number): Promise<void> {
  await page.waitForFunction(
    ([p, r]) => {
      try {
        const id = JSON.parse(localStorage.getItem('cm.identity') ?? 'null') as {
          ratings?: Record<string, { rating: number }>
        }
        return id?.ratings?.[p as string]?.rating === r
      } catch {
        return false
      }
    },
    [pool, expected] as const,
    { timeout: 20_000 },
  )
}

async function moveAnyway(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (await playRandomLegalMove(page)) return
    await page.waitForTimeout(700)
  }
  throw new Error('no legal move could be played')
}

/** the server's rating for a user in this pool, polled until it exists */
async function serverRating(uid: string): Promise<number | null> {
  const rows = await restGet(`ratings?user_id=eq.${uid}&category=eq.${POOL}&select=rating`)
  const r = rows[0]?.rating
  return typeof r === 'number' ? r : null
}

/** rated 1+0 quick pair into one shared game; returns the game id */
async function quickPairRated(a: Page, b: Page): Promise<string> {
  for (const p of [a, b]) {
    await gotoPath(p, '/play')
    await p.locator('.tc-btn', { hasText: '1+0' }).click()
    expect(await clickButton(p, 'Rated')).toBe(true)
    expect(await clickButton(p, 'Find an opponent')).toBe(true)
  }
  await a.waitForURL(/\/play\/[0-9a-f-]{36}/, { timeout: 90_000 })
  await b.waitForURL(/\/play\/[0-9a-f-]{36}/, { timeout: 90_000 })
  await a.waitForSelector('.board')
  await b.waitForSelector('.board')
  expect(new URL(a.url()).pathname).toBe(new URL(b.url()).pathname)
  return new URL(a.url()).pathname.split('/').pop()!
}

test.describe.serial('a rated game is visible on every rating surface', () => {
  test('chip, profile and result card all show the new rating on both sides', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const p1 = await ctx1.newPage()
    const p2 = await ctx2.newPage()
    try {
      const gameId = await quickPairRated(p1, p2)
      const p1Orient = await p1.getAttribute('.board', 'data-orientation')
      const white = p1Orient === 'w' ? p1 : p2
      const black = p1Orient === 'w' ? p2 : p1

      // 2 moves each (the rating floor), then black resigns
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

      // server truth for both players
      const uid1 = await sessionUserId(p1)
      const uid2 = await sessionUserId(p2)
      expect(uid1).toBeTruthy()
      expect(uid2).toBeTruthy()
      let r1: number | null = null
      let r2: number | null = null
      for (let i = 0; i < 40 && (r1 === null || r2 === null); i++) {
        r1 = await serverRating(uid1!)
        r2 = await serverRating(uid2!)
        if (r1 === null || r2 === null) await p1.waitForTimeout(500)
      }
      expect(r1).not.toBeNull()
      expect(r2).not.toBeNull()
      const rate1 = r1 as number
      const rate2 = r2 as number
      const rateWhite = white === p1 ? rate1 : rate2
      const rateBlack = white === p1 ? rate2 : rate1
      expect(rateWhite).toBeGreaterThan(200)
      expect(rateBlack).toBeLessThan(200)
      expect(rateWhite).toBeGreaterThan(rateBlack)

      // the database holds exactly one rated game + both history rows
      const game = await restGet(`games?id=eq.${gameId}&select=status,rated`)
      expect(game[0]?.status).toBe('over')
      expect(game[0]?.rated).toBe(true)
      const hist = await restGet(`rating_history?game_id=eq.${gameId}&select=user_id`)
      expect(hist.length).toBe(2)

      for (const [p, rate] of [
        [p1, p1 === white ? rateWhite : rateBlack],
        [p2, p2 === white ? rateWhite : rateBlack],
      ] as const) {
        // the result card counts up to the database value
        await expect(p.locator('.rb-rating .rating-countup b')).toHaveText(new RegExp(`^${rate}\\??$`), {
          timeout: 15_000,
        })
        // the local identity catches up in-session — whoever finalized
        await waitForLocalRating(p, POOL, rate)
        expect(await localRating(p, POOL)).toBe(rate)
        // the guest chip shows the same number (last played pool)
        await expect(p.locator('.topnav .nav-chip .rating')).toHaveText(String(rate), { timeout: 15_000 })
      }

      // survives a reload, and the guest profile lists it too
      await p1.reload()
      await expect(p1.locator('.topnav .nav-chip .rating')).toHaveText(String(p1 === white ? rateWhite : rateBlack), {
        timeout: 30_000,
      })
      await p1.goto('/settings')
      await expect(p1.locator('.settings-grid')).toContainText(
        new RegExp(`bullet\\s*${p1 === white ? rateWhite : rateBlack}\\b`, 'i'),
        { timeout: 15_000 },
      )
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  test('a game too short to rate says why instead of silently doing nothing', async ({ browser }) => {
    test.setTimeout(240_000)
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const p1 = await ctx1.newPage()
    const p2 = await ctx2.newPage()
    try {
      const gameId = await quickPairRated(p1, p2)
      const p1Orient = await p1.getAttribute('.board', 'data-orientation')
      const white = p1Orient === 'w' ? p1 : p2
      const black = p1Orient === 'w' ? p2 : p1

      // one move total — below the "2 moves each" rating floor
      await moveAnyway(white)
      await waitForPlyCount(black, 1)
      expect(await clickButton(black, 'Resign')).toBe(true)
      await black.locator('.modal-actions button', { hasText: 'Resign' }).click()
      for (const p of [p1, p2]) {
        await expect(p.locator('.result-banner')).toContainText('Not rated', { timeout: 30_000 })
      }

      // and nothing was written to the rating tables
      const hist = await restGet(`rating_history?game_id=eq.${gameId}&select=user_id`)
      expect(hist.length).toBe(0)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})
