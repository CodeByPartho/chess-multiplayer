import { test, expect } from '@playwright/test'
import { gotoPath } from './helpers'

/**
 * Settings persist locally for guests: board theme and sound choices survive
 * a reload without any account.
 */

test('board theme and sound settings persist across reloads', async ({ page }) => {
  await gotoPath(page, '/settings')

  // pick a board theme that is not the default first swatch
  const swatches = page.locator('.swatch')
  await expect(swatches.first()).toBeVisible()
  const target = swatches.nth(2)
  await target.click()
  await expect(target).toHaveClass(/selected/)

  // toggle the sound switch to its opposite state
  const sound = page.locator('.switch').first()
  await expect(sound).toBeVisible()
  const before = await sound.getAttribute('class')
  await sound.click()
  await expect
    .poll(async () => (await sound.getAttribute('class')) ?? '')
    .not.toBe(before ?? '')
  const toggled = await sound.getAttribute('class')

  // reload: both choices must survive
  await gotoPath(page, '/settings')
  await expect(swatches.nth(2)).toHaveClass(/selected/)
  await expect(page.locator('.switch').first()).toHaveClass(new RegExp(toggled ?? '$^'))
})
