import { expect, test } from '@playwright/test'
import {
  VIEWPORTS,
  evalLabelState,
  flipBoard,
  LINE_20,
  playLine,
  playRandomLegalMove,
  startAnalysis,
  startComputer,
  waitBoardSettled,
  waitForPlyCount,
} from './helpers'

/**
 * Verification item 4 — evaluation bar:
 * the bar must be ≥28px wide and the numeric label (+7.9, M3, 0.0…) must sit
 * fully inside the bar bbox (no clipping) at every viewport, in both board
 * orientations, in modes that show the bar (analysis + computer).
 */

const LABEL_PATTERN = /^([+−-]?\d+(\.\d+)?|M\d+|0\.0)$/

for (const vp of VIEWPORTS) {
  test.describe(`evalbar ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('analysis: label inside bar, white and black orientation', async ({ page }) => {
      await startAnalysis(page)

      const bar = await evalLabelState(page)
      expect(bar.present, 'analysis shows an evaluation bar').toBe(true)
      expect(bar.barWidth, 'bar is at least 28px wide').toBeGreaterThanOrEqual(28)
      expect(bar.fits, 'label fully inside the bar (start position)').toBe(true)
      expect(bar.labelText).toMatch(LABEL_PATTERN)

      await playLine(page, LINE_20.slice(0, 4))

      const after = await evalLabelState(page)
      expect(after.fits, 'label fully inside the bar (after moves)').toBe(true)
      expect(after.labelText).toMatch(LABEL_PATTERN)

      await flipBoard(page)
      await waitBoardSettled(page)

      const flipped = await evalLabelState(page)
      expect(flipped.fits, 'label fully inside the bar (flipped)').toBe(true)
      expect(flipped.labelText).toMatch(LABEL_PATTERN)
    })

    test('computer: label inside bar, both player colors', async ({ page }) => {
      for (const color of ['w', 'b'] as const) {
        await startComputer(page, color)

        const bar = await evalLabelState(page)
        expect(bar.present, 'computer mode shows an evaluation bar').toBe(true)
        expect(bar.barWidth).toBeGreaterThanOrEqual(28)
        expect(bar.fits, `label fully inside the bar (color ${color}, start)`).toBe(true)
        expect(bar.labelText).toMatch(LABEL_PATTERN)

        // one user move + engine reply — label must keep fitting while updating
        if (color === 'w') {
          const moved = await playRandomLegalMove(page)
          expect(moved, 'found a legal user move').toBe(true)
        }
        await waitForPlyCount(page, 1)
        const after = await evalLabelState(page)
        expect(after.fits, `label fully inside the bar (color ${color}, after moves)`).toBe(true)
        expect(after.labelText).toMatch(LABEL_PATTERN)
      }
    })
  })
}
