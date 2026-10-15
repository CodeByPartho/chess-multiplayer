import { expect, test } from '@playwright/test'
import {
  VIEWPORTS,
  LINE_20,
  clickButton,
  flipBoard,
  gotoPath,
  playSyncedMove,
  setKnownScroll,
  supabaseConfigured,
  waitBoardSettled,
  type ScrollState,
} from './helpers'
import type { Orientation } from './helpers'

/**
 * Problem 1 verification — scroll stability in quick pairing.
 * Serial on purpose: two pairing tests running at once could match their
 * guests across tests and desync the scripted line.
 */

test.describe.configure({ mode: 'serial' })

for (const vp of VIEWPORTS) {
  for (const orientation of ['white', 'black'] as Orientation[]) {
    test.describe(`scroll quick ${vp.name} ${orientation}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } })

      test('quick pairing: 20 moves never move either page', async ({ browser }) => {
        test.skip(!supabaseConfigured(), 'Supabase env not configured')

        const ctxA = await browser.newContext()
        const ctxB = await browser.newContext()
        const a = await ctxA.newPage()
        const b = await ctxB.newPage()
        try {
          for (const p of [a, b]) {
            await gotoPath(p, '/play')
            expect(await clickButton(p, 'Casual')).toBe(true)
            expect(await clickButton(p, 'Find an opponent')).toBe(true)
          }
          await a.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 45_000 })
          await b.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 45_000 })
          await waitBoardSettled(a)
          await waitBoardSettled(b)

          // bottom color tells us who got White
          const aOrient = await a.getAttribute('.board', 'data-orientation')
          const white = aOrient === 'w' ? a : b
          const black = aOrient === 'w' ? b : a

          if (orientation === 'black') {
            await flipBoard(a)
            await flipBoard(b)
            await waitBoardSettled(a)
            await waitBoardSettled(b)
          }

          let wBase: ScrollState
          let bBase: ScrollState
          const baseA = await setKnownScroll(a)
          const baseB = await setKnownScroll(b)
          wBase = white === a ? baseA : baseB
          bBase = white === a ? baseB : baseA

          for (let i = 0; i < 20; i++) {
            const whiteTurn = i % 2 === 0
            const r = await playSyncedMove({
              mover: whiteTurn ? white : black,
              other: whiteTurn ? black : white,
              uci: LINE_20[i],
              ply: i + 1,
              moverBase: whiteTurn ? wBase : bBase,
              otherBase: whiteTurn ? bBase : wBase,
            })
            wBase = whiteTurn ? r.moverBase : r.otherBase
            bBase = whiteTurn ? r.otherBase : r.moverBase
          }
        } finally {
          await ctxA.close()
          await ctxB.close()
        }
      })
    })
  }
}
