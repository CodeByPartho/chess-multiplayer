import { expect, test } from '@playwright/test'
import {
  VIEWPORTS,
  buildReviewRecord,
  clickButton,
  expectScrollUnchanged,
  flipBoard,
  gotoPath,
  playUci,
  playWrongMove,
  puzzles,
  scrollState,
  setKnownScroll,
  waitBoardSettled,
  type ScrollState,
} from './helpers'
import type { Orientation } from './helpers'

/**
 * Problem 1 verification — scroll stability in puzzle + review modes.
 * Puzzle boards solve one mate motif at a time, so the test makes a wrong
 * attempt AND the full solution on every puzzle (20 board moves total in
 * practice), clicking through 10 puzzles without ever moving the page.
 */

async function assertStable(page: import('@playwright/test').Page, base: ScrollState) {
  expectScrollUnchanged(await scrollState(page), base)
}

async function currentPuzzleId(page: import('@playwright/test').Page): Promise<string> {
  return (await page.getAttribute('.puzzle-board-wrap', 'data-puzzle-id')) ?? ''
}

test.describe('scroll puzzles', () => {
  for (const vp of VIEWPORTS) {
    test.describe(vp.name, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } })

      test('practice: wrong attempt + solution on 10 puzzles never move the page', async ({ page }) => {
        await gotoPath(page, '/puzzles')
        expect(await clickButton(page, 'Back rank')).toBe(true)
        await waitBoardSettled(page)

        const base = await setKnownScroll(page)
        let boardMoves = 0

        for (let n = 0; n < 10; n++) {
          const id = await currentPuzzleId(page)
          const puzzle = puzzles.find((p) => p.id === id)
          expect(puzzle, `puzzle ${id} exists in the data set`).toBeTruthy()

          // wrong attempt first — position must not change
          if (await playWrongMove(page, puzzle!.solution[0])) {
            boardMoves++
            await assertStable(page, base)
          }

          // solve it (user plies at even indices; opponent replies auto-play)
          for (let i = 0; i < puzzle!.solution.length; i += 2) {
            await playUci(page, puzzle!.solution[i])
            boardMoves++
            await assertStable(page, base)
            if (i + 1 < puzzle!.solution.length) {
              await page.waitForTimeout(600) // 420ms auto-reply
              await assertStable(page, base)
            }
          }

          if (n < 9) {
            expect(await clickButton(page, 'Next puzzle')).toBe(true)
            await waitBoardSettled(page)
            await assertStable(page, base)
          }
        }

        expect(boardMoves, 'at least 20 board moves across the set').toBeGreaterThanOrEqual(20)
      })

      test('rush: solving 20 puzzles never move the page', async ({ page }) => {
        await gotoPath(page, '/puzzles/rush')
        expect(await clickButton(page, 'Start rush')).toBe(true)
        await waitBoardSettled(page)

        const base = await setKnownScroll(page)
        let boardMoves = 0

        for (let idx = 0; boardMoves < 20 && idx < puzzles.length; idx++) {
          const id = await currentPuzzleId(page)
          const puzzle = puzzles.find((p) => p.id === id)
          expect(puzzle, `rush puzzle ${id} exists`).toBeTruthy()

          for (let i = 0; i < puzzle!.solution.length && boardMoves < 20; i += 2) {
            await playUci(page, puzzle!.solution[i])
            boardMoves++
            await assertStable(page, base)
            if (i + 1 < puzzle!.solution.length) {
              await page.waitForTimeout(600) // auto reply
              await assertStable(page, base)
            }
          }

          if (boardMoves < 20) {
            // rush auto-advances 380ms after a solve
            await page.waitForFunction(
              (prev) => document.querySelector('.puzzle-board-wrap')?.getAttribute('data-puzzle-id') !== prev,
              id,
              { timeout: 8000 },
            )
            await assertStable(page, base)
          }
        }

        expect(boardMoves, 'at least 20 puzzle moves').toBeGreaterThanOrEqual(20)
      })
    })
  }
})

for (const vp of VIEWPORTS) {
  for (const orientation of ['white', 'black'] as Orientation[]) {
    test.describe(`scroll review ${vp.name} ${orientation}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } })

      test('game review: seeking through 20 moves never move the page', async ({ page }) => {
        await gotoPath(page, '/')
        const rec = buildReviewRecord('e2e-review')
        await page.evaluate((r) => localStorage.setItem('cm.history', JSON.stringify([r])), rec)

        await gotoPath(page, '/review/e2e-review')
        await waitBoardSettled(page)
        if (orientation === 'black') {
          await flipBoard(page)
          await waitBoardSettled(page)
        }

        const base = await setKnownScroll(page)
        const count = await page.evaluate(() => document.querySelectorAll('.movelist .mv').length)
        expect(count, 'move list shows all 20 moves').toBe(20)

        for (let i = 0; i < count; i++) {
          await page.evaluate((idx) => {
            ;(document.querySelectorAll('.movelist .mv')[idx] as HTMLElement).click()
          }, i)
          await assertStable(page, base)
        }

        // nav buttons jump around the game too
        for (const label of ['Last move', 'First move', 'Next move', 'Previous move', 'Last move']) {
          const clicked = await page.evaluate((l) => {
            const btn = [...document.querySelectorAll('button')].find(
              (b) => b.offsetParent !== null && (b.getAttribute('aria-label') ?? '').startsWith(l),
            )
            if (!btn) return false
            btn.click()
            return true
          }, label)
          expect(clicked, `nav button ${label} found`).toBe(true)
          await assertStable(page, base)
        }
      })
    })
  }
}
