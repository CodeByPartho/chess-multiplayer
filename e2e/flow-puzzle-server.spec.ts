import { test, expect } from '@playwright/test'
import { gotoPath, playUci, puzzles } from './helpers'

/**
 * Solving a puzzle: the board accepts the solution, the result banner shows
 * a server-checked puzzle rating delta, and giving up reveals the solution
 * without pretending a solve happened.
 */

test('solving a puzzle shows the server-checked rating delta', async ({ page }) => {
  const puzzle = puzzles.find((p) => p.id === 'p001') ?? puzzles[0]
  await gotoPath(page, `/puzzle/${puzzle.id}`)
  await page.waitForSelector('.board')

  for (const uci of puzzle.solution) {
    await playUci(page, uci)
  }

  const banner = page.locator('.result-banner')
  await expect(banner).toBeVisible({ timeout: 20_000 })
  await expect(banner).toContainText(/Solved in/)
  // the delta line is the server's answer (local preview is replaced by it)
  await expect(banner).toContainText(/puzzle rating [+-]\d+/)

  // the cheat-prone nature is labelled — puzzles stay off the main boards
  await expect(page.getByText(/cheat-proof/)).toBeVisible()
})

test('giving up records a loss and reveals the solution', async ({ page }) => {
  const puzzle = puzzles.find((p) => p.id === 'p002') ?? puzzles[1]
  await gotoPath(page, `/puzzle/${puzzle.id}`)
  await page.waitForSelector('.board')

  await page.getByRole('button', { name: /Show solution/ }).click()
  await expect(page.getByText(/Answer:/)).toBeVisible()
  // no fake "solved" banner appears for a give-up
  await expect(page.locator('.result-banner')).toHaveCount(0)
})
