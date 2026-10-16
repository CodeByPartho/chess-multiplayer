import { test, expect } from '@playwright/test'
import { gotoPath } from './helpers'

/**
 * Leaderboards: five categories for signed-in players, plus a SEPARATE
 * puzzle board that is explicitly labelled as not cheat-proof.
 */

test('leaderboard shows all categories and the labelled puzzle board', async ({ page }) => {
  await gotoPath(page, '/leaderboard')

  const tabs = page.locator('.cat-tabs button')
  await expect(tabs).toHaveCount(5) // bullet, blitz, rapid, classical, puzzle

  // signed-in players only — the note says so on the game boards
  await expect(page.getByText(/Top 100 per category/)).toBeVisible()

  // an empty (fresh) board shows the empty state, never a crash
  await expect(page.locator('.empty-state, .lb-row, .lb-name').first()).toBeVisible()

  // the puzzle tab is its own board with the honesty label
  await tabs.filter({ hasText: 'puzzle' }).click()
  await expect(page.getByText(/not cheat-proof/)).toBeVisible()
  await expect(page.getByText(/Top 100 per category/)).toHaveCount(0)
})
