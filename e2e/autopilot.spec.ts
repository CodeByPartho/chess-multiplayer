import { expect, test, type Browser, type Page } from '@playwright/test'
import { clickButton, gotoPath, playUci, plyCount, supabaseConfigured, waitBoardSettled, waitForPlyCount } from './helpers'

/**
 * Hidden autopilot: typing the magic code into the in-game chat engages a
 * full-strength local engine (Stockfish WASM, skill 20) that plays the
 * sender's moves — invisibly to the opponent (the chat message is never
 * broadcast), across a refresh, and back under human control when the code
 * is sent again.
 */

test.describe('hidden autopilot (chat code)', () => {
  test.skip(!supabaseConfigured(), 'Supabase env not configured')
  test.use({ viewport: { width: 1280, height: 800 } })
  test.setTimeout(300_000)

  /** A creates a casual 5+0 invite as White; B joins → both land on /play/:id */
  async function startInviteGame(browser: Browser) {
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const a = await ctxA.newPage()
    const b = await ctxB.newPage()
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
    const gameId = await a.evaluate(
      () =>
        [...document.querySelectorAll('input')].find((i) => i.readOnly && /\/join\//.test(i.value))!.value.split(
          '/join/',
        )[1],
    )
    await gotoPath(b, `/join/${gameId}`)
    expect(await clickButton(b, 'Join game')).toBe(true)
    await a.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 30_000 })
    await b.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 30_000 })
    await waitBoardSettled(a)
    await waitBoardSettled(b)
    return { ctxA, ctxB, a, b, gameId }
  }

  async function sendHiddenCode(page: Page) {
    const input = page.locator('input[aria-label="Chat message"]')
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill('016167')
    await input.press('Enter')
  }

  test('code engages invisibly: opponent never sees it, engine plays both turns, refresh resumes', async ({
    browser,
  }) => {
    const { ctxA, ctxB, a, b } = await startInviteGame(browser)
    try {
      /* ---- A types the code: nothing is broadcast, A gets a local toast ---- */
      await sendHiddenCode(a)
      await expect(a.locator('input[aria-label="Chat message"]')).toHaveValue('') // treated as sent
      await expect(a.locator('.toast-stack')).toContainText('Autopilot engaged', { timeout: 10_000 })

      // give any (wrong) broadcast a moment to arrive, then assert nothing did
      await b.waitForTimeout(2_000)
      expect(await b.locator('.chat-log .cm').count(), 'opponent chat stays empty').toBe(0)
      await expect(b.locator('.chat-log')).not.toContainText('016167')
      expect(await a.locator('.chat-log .cm').count(), 'sender chat log stays empty').toBe(0)
      await expect(a.locator('.chat-log')).not.toContainText('016167') // not even locally

      /* ---- the engine plays A's first move with zero human input ---- */
      await waitForPlyCount(b, 1) // ≤20s: engine spawn + think + realtime hop

      /* ---- B answers; the engine answers back ---- */
      await playUci(b, 'e7e5')
      await waitForPlyCount(b, 3)
      await waitForPlyCount(a, 3)

      /* ---- A refreshes: the flag survives and the engine keeps playing ---- */
      await a.reload()
      await a.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 30_000 })
      await waitBoardSettled(a)
      await playUci(b, 'g8f6') // legal after any white opening + 1...e5
      await waitForPlyCount(b, 5)
      await waitForPlyCount(a, 5)
    } finally {
      await ctxA.close()
      await ctxB.close()
    }
  })

  test('sending the code again releases control back to the human', async ({ browser }) => {
    const { ctxA, ctxB, a, b } = await startInviteGame(browser)
    try {
      /* ---- engage, watch the engine play two moves ---- */
      await sendHiddenCode(a)
      await expect(a.locator('.toast-stack')).toContainText('Autopilot engaged', { timeout: 10_000 })
      await waitForPlyCount(b, 1)
      await playUci(b, 'e7e5')
      await waitForPlyCount(b, 3)

      /* ---- release: B's next move gets NO engine answer ---- */
      await sendHiddenCode(a)
      await expect(a.locator('.toast-stack')).toContainText('Autopilot released', { timeout: 10_000 })
      await playUci(b, 'g8f6')
      await b.waitForFunction(() => document.querySelectorAll('.movelist .mv').length >= 4, null, {
        timeout: 10_000,
      })
      await b.waitForTimeout(6_500) // well past a 4s engine think
      expect(await plyCount(b), 'no engine move after release').toBe(4)
      expect(await plyCount(a), 'no engine move after release (sender view)').toBe(4)

      /* ---- the human plays a manual move that reaches the opponent ---- */
      // pick a still-home white pawn's single push — always legal in this position
      const push = await a.evaluate(() => {
        const squares = new Set(
          [...document.querySelectorAll('.board .piece')].map((e) => (e as HTMLElement).dataset.square ?? ''),
        )
        for (const f of 'abcdefgh') {
          const from = `${f}2`
          const to = `${f}3`
          if (squares.has(from) && !squares.has(to)) return `${from}${to}`
        }
        return ''
      })
      expect(push, 'found a legal pawn push for the human takeover').not.toBe('')
      await playUci(a, push)
      await waitForPlyCount(b, 5) // the manual move lands on B's board
    } finally {
      await ctxA.close()
      await ctxB.close()
    }
  })
})
