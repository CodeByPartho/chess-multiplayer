import { expect, test } from '@playwright/test'
import {
  VIEWPORTS,
  LINE_20,
  alignmentMetrics,
  expectAligned,
  flipBoard,
  playLine,
  startAnalysis,
  startPassPlay,
  waitBoardSettled,
} from './helpers'
import type { Orientation } from './helpers'

/**
 * Problem 2 verification — piece geometry:
 * pieces must be centred on their square within 0.5px and fill the square
 * within 1px, at every viewport, in both board orientations, at the start
 * position, after moves, after window resizes and after flipping.
 */

const ORIENTATIONS: Orientation[] = ['white', 'black']

for (const vp of VIEWPORTS) {
  for (const orientation of ORIENTATIONS) {
    test.describe(`alignment ${vp.name} ${orientation}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } })

      test('pass & play: pieces aligned at start, after moves, resize and flip', async ({ page }) => {
        await startPassPlay(page)
        if (orientation === 'black') {
          await flipBoard(page)
          await waitBoardSettled(page)
        }

        expectAligned(await alignmentMetrics(page))

        // after several moves
        await playLine(page, LINE_20.slice(0, 4))
        expectAligned(await alignmentMetrics(page))

        // after resizing the window (shrink, then grow back)
        const altW = vp.width >= 500 ? vp.width - 56 : vp.width + 40
        await page.setViewportSize({ width: altW, height: vp.height })
        await waitBoardSettled(page)
        expectAligned(await alignmentMetrics(page))

        await page.setViewportSize({ width: vp.width, height: vp.height })
        await waitBoardSettled(page)
        expectAligned(await alignmentMetrics(page))

        // after flipping — now the opposite orientation is at the bottom
        await flipBoard(page)
        await waitBoardSettled(page)
        expectAligned(await alignmentMetrics(page))
        const expected = orientation === 'white' ? 'b' : 'w'
        expect(await page.getAttribute('.board', 'data-orientation')).toBe(expected)
      })

      test('analysis (eval bar attached): pieces aligned after moves, resize and flip', async ({ page }) => {
        await startAnalysis(page)
        if (orientation === 'black') {
          await flipBoard(page)
          await waitBoardSettled(page)
        }

        expectAligned(await alignmentMetrics(page))

        await playLine(page, LINE_20.slice(0, 4))
        expectAligned(await alignmentMetrics(page))

        const altW = vp.width >= 500 ? vp.width - 56 : vp.width + 40
        await page.setViewportSize({ width: altW, height: vp.height })
        await waitBoardSettled(page)
        expectAligned(await alignmentMetrics(page))

        await page.setViewportSize({ width: vp.width, height: vp.height })
        await waitBoardSettled(page)
        expectAligned(await alignmentMetrics(page))

        await flipBoard(page)
        await waitBoardSettled(page)
        expectAligned(await alignmentMetrics(page))
      })
    })
  }
}
