import { expect, test } from '@playwright/test'
import {
  VIEWPORTS,
  flipBoard,
  layoutState,
  startAnalysis,
  startPassPlay,
  waitBoardSettled,
} from './helpers'

/**
 * Problem 3 verification — layout:
 * board + strips + eval bar + right panel fully in the viewport, no
 * horizontal scroll at any width, desktop game pages do not scroll at all,
 * sidebar/bottom tabs behave per breakpoint. Also captures the required
 * screenshots for every viewport.
 */

for (const vp of VIEWPORTS) {
  test.describe(`layout ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })
    const desktop = vp.width >= 1024

    test('game page: everything inside the viewport, no page scrolling', async ({ page }) => {
      await startPassPlay(page)
      const s = await layoutState(page)

      expect(s.boardInside, 'board fully inside viewport').toBe(true)
      expect(s.stripsInside, 'both player strips fully inside viewport').toBe(true)
      expect(s.scrollWidth, 'no horizontal scrolling').toBeLessThanOrEqual(s.innerWidth + 1)
      expect(s.boardSize).toBeGreaterThan(100)
      // board size is a whole multiple of 8
      expect(Math.abs(s.boardSize / 8 - Math.round(s.boardSize / 8))).toBeLessThan(0.001)

      if (desktop) {
        expect(s.scrollHeight, 'desktop game page does not scroll').toBeLessThanOrEqual(s.innerHeight + 1)
        expect(s.sideInside, 'right panel fully inside viewport').toBe(true)
        expect(s.sideWidth, 'right panel is ~380px').toBeGreaterThanOrEqual(378)
        expect(s.sideWidth).toBeLessThanOrEqual(382)
        expect(s.sidenavVisible, 'desktop sidebar visible').toBe(true)
        expect(s.tabbarVisible, 'bottom tab bar hidden on desktop').toBe(false)
      } else {
        expect(s.sidenavVisible, 'sidebar hidden on mobile').toBe(false)
        expect(s.tabbarVisible, 'bottom tab bar visible on mobile').toBe(true)
      }

      // scroll stability of the shell itself: window cannot move on desktop
      if (desktop) {
        await page.evaluate(() => window.scrollTo(0, 400))
        expect(await page.evaluate(() => window.scrollY)).toBe(0)
      }

      await page.screenshot({ path: `screenshots/game-${vp.name}-white.png` })
    })

    test('analysis: eval bar + strips + panel in viewport, screenshot', async ({ page }) => {
      await startAnalysis(page)
      await flipBoard(page)
      await waitBoardSettled(page)

      const s = await layoutState(page)
      expect(s.boardInside, 'board fully inside viewport').toBe(true)
      expect(s.stripsInside, 'strips fully inside viewport').toBe(true)
      expect(s.evalbarInside, 'evaluation bar fully inside viewport').toBe(true)
      expect(s.scrollWidth).toBeLessThanOrEqual(s.innerWidth + 1)

      if (desktop) {
        expect(s.scrollHeight, 'desktop analysis page does not scroll').toBeLessThanOrEqual(s.innerHeight + 1)
        expect(s.sideInside).toBe(true)
      }

      await page.screenshot({ path: `screenshots/analysis-${vp.name}-black.png` })
    })
  })
}
