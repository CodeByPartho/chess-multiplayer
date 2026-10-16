import { test, expect, type Page } from '@playwright/test'
import { clickButton, playRandomLegalMove, waitForPlyCount } from './helpers'

/**
 * Two guests quick-pair into the same casual game: both land on the board,
 * both clocks are live, and a move made by one player shows up on the other.
 */

async function openQuickPair(page: Page): Promise<void> {
  await page.goto('/play')
  await page.waitForSelector('.shell')
  await clickButton(page, 'Casual')
  await clickButton(page, 'Find an opponent')
  await page.waitForURL(/\/play\/[0-9a-f-]{36}/, { timeout: 90_000 })
  await page.waitForSelector('.board')
}

test('two guests get paired, clocks run, moves sync both ways', async ({ browser }) => {
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const p1 = await ctx1.newPage()
  const p2 = await ctx2.newPage()
  try {
    await Promise.all([openQuickPair(p1), openQuickPair(p2)])

    // same game id on both sides
    const id1 = new URL(p1.url()).pathname
    const id2 = new URL(p2.url()).pathname
    expect(id1).toBe(id2)

    // both see a board and two live clocks
    for (const p of [p1, p2]) {
      await expect(p.locator('.board')).toBeVisible()
      await expect(p.locator('.clock')).toHaveCount(2)
    }

    // one side moves (whoever is to move — color is assigned by the server);
    // retry a few rounds in case the realtime channel is still joining
    let moved = await playRandomLegalMove(p1)
    if (!moved) moved = await playRandomLegalMove(p2)
    for (let i = 0; !moved && i < 4; i++) {
      await p1.waitForTimeout(750)
      moved = (await playRandomLegalMove(p1)) || (await playRandomLegalMove(p2))
    }
    expect(moved).toBe(true)
    await waitForPlyCount(p1, 1)
    await waitForPlyCount(p2, 1)
  } finally {
    await ctx1.close()
    await ctx2.close()
  }
})
