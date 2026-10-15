import { expect, test, type Page } from '@playwright/test'
import { clickButton, gotoPath, playUci, supabaseConfigured, waitBoardSettled, waitForPlyCount } from './helpers'

/**
 * "Play a Friend" end-to-end: the invite link journey across isolated
 * browsers — create → share link → join screen → join → play both ways →
 * refresh rejoin → already-full for third browsers → resign → result on
 * both screens, plus the same-guest explainer and the cancelled/unknown
 * link states.
 */

/** seconds shown on a strip's clock ("Time remaining 4:56" / "9.4") */
async function clockSeconds(page: Page, which: 'top' | 'bottom'): Promise<number> {
  const label = await page.locator(`.player-strip.${which} .clock`).first().getAttribute('aria-label')
  const m = /Time remaining (?:(\d+):)?(\d+(?:\.\d+)?)/.exec(label ?? '')
  if (!m) throw new Error(`unexpected clock label: ${label}`)
  return m[1] ? Number(m[1]) * 60 + Number(m[2]) : Number(m[2])
}

async function guestName(page: Page): Promise<string> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('cm.identity')!).username as string)
}

test.describe('play a friend — invite link end-to-end', () => {
  test.skip(!supabaseConfigured(), 'Supabase env not configured')
  test.use({ viewport: { width: 1280, height: 800 } })

  test('friend joins via link, both play, clocks sync, refresh rejoins, resign ends it', async ({ browser }) => {
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const ctxC = await browser.newContext()
    const a = await ctxA.newPage()
    const b = await ctxB.newPage()
    const c = await ctxC.newPage()
    try {
      /* ---- A creates a casual 5+0 invite playing White ---- */
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
      const inviteLink = await a.evaluate(
        () => [...document.querySelectorAll('input')].find((i) => i.readOnly && /\/join\//.test(i.value))!.value,
      )
      // the link is origin-based and carries the game id
      expect(inviteLink.startsWith(`${new URL(a.url()).origin}/join/`)).toBe(true)
      const gameId = inviteLink.split('/join/')[1]
      expect(gameId).toMatch(/^[0-9a-f-]{36}$/)

      // waiting screen shows the chosen color and time control
      await expect(a.getByText('You play')).toBeVisible()
      await expect(a.getByText('White · 5+0 · Casual')).toBeVisible()

      const nameA = await guestName(a)

      /* ---- same guest, second tab: friendly explainer, not a silent join ---- */
      const a2 = await ctxA.newPage()
      await gotoPath(a2, `/join/${gameId}`)
      await expect(a2.getByText('You created this game')).toBeVisible({ timeout: 20_000 })
      await expect(a2.getByText('open the link in a different browser')).toBeVisible()
      await expect(a2.getByRole('button', { name: 'Go to waiting room' })).toBeVisible()
      await a2.close()

      /* ---- B opens the link: the join screen tells them what they're joining ---- */
      await gotoPath(b, `/join/${gameId}`)
      await expect(b.getByText(`${nameA} invited you to a game`)).toBeVisible({ timeout: 20_000 })
      await expect(b.getByText('5+0')).toBeVisible()
      await expect(b.locator('.chip', { hasText: 'Black' })).toBeVisible()
      const nameB = await guestName(b)
      expect(await clickButton(b, 'Join game')).toBe(true)

      /* ---- both land on the board with correct orientation and names ---- */
      await a.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 30_000 })
      await b.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 30_000 })
      expect(new URL(a.url()).pathname).toBe(`/play/${gameId}`)
      expect(new URL(b.url()).pathname).toBe(`/play/${gameId}`)
      await waitBoardSettled(a)
      await waitBoardSettled(b)
      await expect(a.locator('.board')).toHaveAttribute('data-orientation', 'w')
      await expect(b.locator('.board')).toHaveAttribute('data-orientation', 'b')
      await expect(a.locator('.player-strip.top .ps-name')).toContainText(nameB, { timeout: 15_000 })
      await expect(b.locator('.player-strip.top .ps-name')).toContainText(nameA, { timeout: 15_000 })

      /* ---- moves flow both ways within 2 seconds ---- */
      await playUci(a, 'e2e4')
      const bSaw = await b
        .waitForFunction(() => document.querySelectorAll('.movelist .mv').length >= 1, null, { timeout: 2_000 })
        .then(() => true)
        .catch(() => false)
      expect(bSaw, 'e2e4 visible on the friend board within 2s').toBe(true)

      await playUci(b, 'e7e5')
      const aSaw = await a
        .waitForFunction(() => document.querySelectorAll('.movelist .mv').length >= 2, null, { timeout: 2_000 })
        .then(() => true)
        .catch(() => false)
      expect(aSaw, 'e7e5 visible on the host board within 2s').toBe(true)

      /* ---- both pages run the same server clocks (within 1s) ---- */
      // sample all four labels simultaneously — the clocks update on their own
      // tick, so sequential reads could straddle a second boundary
      const [aWhite, bWhite, aBlack, bBlack] = await Promise.all([
        clockSeconds(a, 'bottom'), // A plays White: bottom strip = own clock
        clockSeconds(b, 'top'),
        clockSeconds(a, 'top'),
        clockSeconds(b, 'bottom'),
      ])
      expect(Math.abs(aWhite - bWhite), 'white clock agrees across browsers').toBeLessThanOrEqual(1)
      expect(Math.abs(aBlack - bBlack), 'black clock agrees across browsers').toBeLessThanOrEqual(1)
      expect(aWhite).toBeGreaterThan(240) // 5+0 with two moves played
      expect(aWhite).toBeLessThanOrEqual(300)

      /* ---- B refreshes: same game, same position, same orientation ---- */
      await b.reload()
      await b.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 30_000 })
      await waitBoardSettled(b)
      expect(new URL(b.url()).pathname).toBe(`/play/${gameId}`)
      await expect(b.locator('.board')).toHaveAttribute('data-orientation', 'b')
      await waitForPlyCount(b, 2)
      expect(
        await b.evaluate(() => !!document.querySelector('.board .piece[data-square="e5"]')),
        'pawn from e7e5 still on the board after refresh',
      ).toBe(true)

      /* ---- a third browser sees "already full", never a join button ---- */
      await gotoPath(c, `/join/${gameId}`)
      await expect(c.getByText('This game is already full')).toBeVisible({ timeout: 20_000 })
      await expect(c.getByRole('button', { name: 'Join game' })).toHaveCount(0)

      /* ---- A resigns: the result lands on both screens ---- */
      expect(await clickButton(a, 'Resign')).toBe(true)
      await a.locator('.modal-actions button', { hasText: 'Resign' }).click()
      await expect(a.locator('.rb-title')).toContainText('wins by resignation', { timeout: 15_000 })
      await expect(b.locator('.rb-title')).toContainText('wins by resignation', { timeout: 15_000 })

      /* ---- after the game is over the link reports it as finished ---- */
      await gotoPath(c, `/join/${gameId}`)
      await expect(c.getByText('This game has already finished')).toBeVisible({ timeout: 20_000 })
    } finally {
      await ctxA.close()
      await ctxB.close()
      await ctxC.close()
    }
  })

  test('cancelled invite: friend sees a clear message instead of a broken page', async ({ browser }) => {
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const a = await ctxA.newPage()
    const b = await ctxB.newPage()
    try {
      await gotoPath(a, '/play')
      expect(await clickButton(a, 'Play a friend')).toBe(true)
      expect(await clickButton(a, 'Create invite link')).toBe(true)
      await a.waitForFunction(
        () => [...document.querySelectorAll('input')].some((i) => i.readOnly && /\/join\/.+/.test(i.value)),
        null,
        { timeout: 30_000 },
      )
      const gameId = await a.evaluate(() => {
        const input = [...document.querySelectorAll('input')].find((i) => i.readOnly && /\/join\//.test(i.value))!
        return input.value.split('/join/')[1]
      })

      // cancel is a server-side abort, so the link itself reports the cancellation
      expect(await clickButton(a, 'Cancel invite')).toBe(true)
      await expect(a.getByText('Invite code')).toHaveCount(0) // card is gone

      await gotoPath(b, `/join/${gameId}`)
      await expect(b.getByText('The creator cancelled this game')).toBeVisible({ timeout: 20_000 })
    } finally {
      await ctxA.close()
      await ctxB.close()
    }
  })

  test('unknown game id: join screen says not found', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await gotoPath(page, '/join/00000000-0000-4000-8000-000000000000')
      await expect(page.getByText('Game not found')).toBeVisible({ timeout: 20_000 })
    } finally {
      await ctx.close()
    }
  })
})
