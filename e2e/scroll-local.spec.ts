import { expect, test } from '@playwright/test'
import {
  VIEWPORTS,
  LINE_20,
  expectScrollUnchanged,
  playRandomLegalMove,
  playUci,
  scrollState,
  setKnownScroll,
  startAnalysis,
  startComputer,
  startPassPlay,
  waitBoardSettled,
  waitForPlyCount,
  type ScrollState,
} from './helpers'
import type { Orientation } from './helpers'

/**
 * Problem 1 verification — scroll stability:
 * playing moves must never change the window scroll position or the scrollTop
 * of any scrollable ancestor of the board. ≥20 consecutive plies per mode.
 * Local modes: pass & play, vs computer, analysis board.
 */

const ORIENTATIONS: Orientation[] = ['white', 'black']

async function assertStable(page: import('@playwright/test').Page, base: ScrollState) {
  expectScrollUnchanged(await scrollState(page), base)
}

for (const vp of VIEWPORTS) {
  for (const orientation of ORIENTATIONS) {
    test.describe(`scroll pass&play ${vp.name} ${orientation}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } })

      test('pass & play: 20 moves never move the page', async ({ page }) => {
        await startPassPlay(page)
        if (orientation === 'black') {
          await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')].find((x) => /flip/i.test(x.title || ''))
            b?.click()
          })
          await waitBoardSettled(page)
        }

        const base = await setKnownScroll(page)

        for (let i = 0; i < 20; i++) {
          await playUci(page, LINE_20[i])
          await assertStable(page, base)
        }
      })
    })

    test.describe(`scroll computer ${vp.name} ${orientation}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } })

      test('vs computer: user moves + engine replies never move the page', async ({ page }) => {
        const color: 'w' | 'b' = orientation === 'white' ? 'w' : 'b'
        await startComputer(page, color)

        const base = await setKnownScroll(page)
        let plies = await page.evaluate(() => document.querySelectorAll('.movelist .mv').length)

        while (plies < 20) {
          const myTurn = (plies % 2 === 0) === (color === 'w')
          if (myTurn) {
            const moved = await playRandomLegalMove(page)
            if (!moved) break // game over / no legal move — covered by ply assert below
            plies++
            await assertStable(page, base)
            // engine reply may never come if the game just ended
            const over = await page.locator('.result-banner').count().catch(() => 0)
            if (over > 0) break
          } else {
            await waitForPlyCount(page, plies + 1)
            plies++
            await assertStable(page, base)
          }
        }

        expect(plies, 'played at least 20 plies').toBeGreaterThanOrEqual(20)
      })
    })

    test.describe(`scroll analysis ${vp.name} ${orientation}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } })

      test('analysis: 20 moves never move the page', async ({ page }) => {
        await startAnalysis(page)
        if (orientation === 'black') {
          await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')].find((x) => /flip/i.test(x.title || ''))
            b?.click()
          })
          await waitBoardSettled(page)
        }

        const base = await setKnownScroll(page)

        for (let i = 0; i < 20; i++) {
          await playUci(page, LINE_20[i])
          await assertStable(page, base)
        }
      })
    })
  }
}
