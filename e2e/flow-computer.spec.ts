import { test, expect, type Page } from '@playwright/test'
import {
  clickButton,
  playRandomLegalMove,
  startComputer,
  waitForPlyCount,
} from './helpers'

/**
 * Engine calls must never show a blocking loader: on /computer the board
 * stays live while Stockfish thinks (only a subtle dot on the opponent's
 * strip), and the game review runs with progress in the side panel only.
 *
 * A MutationObserver installed before the app boots records whether a
 * `.board-overlay` (the dimmed loading layer) or a thinking strip ever
 * appeared — transient states included.
 */

async function watchEngineStates(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __overlaySeen?: boolean; __thinkingSeen?: boolean }
    w.__overlaySeen = false
    w.__thinkingSeen = false
    const check = () => {
      if (document.querySelector('.board-overlay')) w.__overlaySeen = true
      if (document.querySelector('.player-strip.thinking')) w.__thinkingSeen = true
    }
    new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true })
    check()
  })
}

const overlaySeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __overlaySeen?: boolean }).__overlaySeen === true)

const thinkingSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __thinkingSeen?: boolean }).__thinkingSeen === true)

async function moveAnyway(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (await playRandomLegalMove(page)) return
    await page.waitForTimeout(700)
  }
  throw new Error('no legal move could be played')
}

test.describe('the engine never blocks the board', () => {
  test('computer replies with no loading overlay; the board stays live', async ({ page }) => {
    test.setTimeout(120_000)
    await watchEngineStates(page)
    await startComputer(page, 'w') // level 1 — guaranteed human-like beat

    await moveAnyway(page)
    await waitForPlyCount(page, 2)

    // the reply arrived: no overlay at any point, and "thinking" was the
    // subtle strip dot only
    expect(await overlaySeen(page)).toBe(false)
    expect(await thinkingSeen(page)).toBe(true)
    await expect(page.locator('.board-overlay')).toHaveCount(0)
    await expect(page.locator('.player-strip.thinking')).toHaveCount(0, { timeout: 10_000 })

    // the board is fully usable mid-conversation: the next human move lands
    expect(await playRandomLegalMove(page)).toBe(true)
    await waitForPlyCount(page, 4)
    expect(await overlaySeen(page)).toBe(false)
  })

  test('game review runs with progress in the side panel, never an overlay', async ({ page }) => {
    test.setTimeout(240_000)
    await watchEngineStates(page)
    await startComputer(page, 'w')
    await moveAnyway(page)
    await waitForPlyCount(page, 2)

    // end the game so the record lands in local history
    expect(await clickButton(page, 'Resign')).toBe(true)
    await page.locator('.modal-actions button', { hasText: 'Resign' }).click()
    await expect(page.locator('.result-banner')).toBeVisible({ timeout: 20_000 })

    // open the saved record: /review/:id auto-runs the full engine review
    await page.waitForFunction(() => {
      const list = JSON.parse(localStorage.getItem('cm.history') ?? '[]') as unknown[]
      return list.length > 0
    })
    const reviewUrl = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('cm.history') ?? '[]') as { id: string }[]
      return `/review/${list[0]?.id ?? ''}`
    })
    expect(reviewUrl).toMatch(/\/review\/cmp-/)
    await page.goto(reviewUrl)
    await page.waitForSelector('.board', { timeout: 30_000 })

    // the review completes (banner appears) without any board overlay
    await expect(page.locator('.rb-title')).toContainText('Game review', { timeout: 180_000 })
    expect(await overlaySeen(page)).toBe(false)
  })
})
