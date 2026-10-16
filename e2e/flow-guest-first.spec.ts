import { test, expect } from '@playwright/test'
import { gotoPath } from './helpers'

/**
 * Guest-first onboarding: opening the app creates an anonymous session with
 * no signup, the shell and nav work signed-out-as-guest, and settings is
 * reachable with its board/sound options.
 */
test('guest boots into a working shell with an anonymous session', async ({ page }) => {
  await gotoPath(page, '/')

  // nav links for the core flows
  await expect(page.getByRole('link', { name: /Play/ }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /Puzzles/ }).first()).toBeVisible()

  // visiting /play silently starts an anonymous session — no signup asked
  await gotoPath(page, '/play')
  await expect(page.getByRole('tab', { name: /Quick pairing/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Find an opponent/ })).toBeVisible()
  await page.waitForFunction(
    () => Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.includes('auth-token')),
    null,
    { timeout: 30_000 },
  )

  // settings reachable: board theme swatches + sound switch render
  await gotoPath(page, '/settings')
  await expect(page.locator('.swatch').first()).toBeVisible()
  await expect(page.getByText('Sound effects')).toBeVisible()
})
