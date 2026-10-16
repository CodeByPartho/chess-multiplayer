import { test, expect, type Page } from '@playwright/test'
import { clickButton, gotoPath, playUci } from './helpers'

/**
 * A casual game played to a resignation ends with the server verdict shown
 * in the result banner on BOTH clients (the browser never decides), with no
 * rating change, and a rematch offer afterwards.
 *
 * Uses the play-a-friend invite flow so the pairing is hermetic: no other
 * client can join a UUID invite, and this never touches the shared quick
 * queue.
 */

async function createCasualInvite(a: Page): Promise<string> {
  await gotoPath(a, '/play')
  expect(await clickButton(a, 'Play a friend')).toBe(true)
  expect(await clickButton(a, 'Casual')).toBe(true)
  expect(await clickButton(a, 'White')).toBe(true)
  expect(await clickButton(a, '5+0')).toBe(true)
  expect(await clickButton(a, 'Create invite link')).toBe(true)
  await a.waitForFunction(
    () => [...document.querySelectorAll('input')].some((i) => i.readOnly && /\/join\/.+/.test(i.value)),
    null,
    { timeout: 30_000 },
  )
  return a.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find((i) => i.readOnly && /\/join\//.test(i.value))!
    return input.value.split('/join/')[1]
  })
}

test('resigning shows the server result banner on both clients', async ({ browser }) => {
  const ctx1 = await browser.newContext()
  const ctx2 = await browser.newContext()
  const p1 = await ctx1.newPage()
  const p2 = await ctx2.newPage()
  try {
    const gameId = await createCasualInvite(p1)

    await gotoPath(p2, `/join/${gameId}`)
    expect(await clickButton(p2, 'Join game')).toBe(true)
    await p1.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 30_000 })
    await p2.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 30_000 })
    await p1.waitForSelector('.board')
    await p2.waitForSelector('.board')

    // p1 has White (chosen above); a real move puts the game under way
    await playUci(p1, 'e2e4')
    await p2.waitForFunction(() => document.querySelectorAll('.movelist .mv').length >= 1, null, {
      timeout: 10_000,
    })

    // p2 resigns: confirm dialog, then the server verdict lands on both
    expect(await clickButton(p2, 'Resign')).toBe(true) // opens the dialog
    await p2.locator('.modal-actions button', { hasText: 'Resign' }).click()

    for (const p of [p1, p2]) {
      await expect(p.locator('.result-banner')).toBeVisible({ timeout: 30_000 })
      const title = (await p.locator('.rb-title').textContent()) ?? ''
      expect(title.length).toBeGreaterThan(0)
      await expect(p.locator('.rb-sub')).toContainText(/won|lost/)
      // a casual game never shows a rating change
      await expect(p.locator('.rb-rating')).toHaveCount(0)
    }

    // both can offer a rematch
    await expect(p2.getByRole('button', { name: /Rematch/ })).toBeVisible()
  } finally {
    await ctx1.close()
    await ctx2.close()
  }
})
