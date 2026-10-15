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
} from './helpers'
import type { Orientation } from './helpers'

/**
 * Problem 1 verification — scroll stability in the invite (play-a-friend)
 * flow: 20 scripted moves across two guest sessions, both pages asserted
 * after every ply, at every viewport, both board orientations.
 */

for (const vp of VIEWPORTS) {
  for (const orientation of ['white', 'black'] as Orientation[]) {
    test.describe(`scroll online ${vp.name} ${orientation}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } })

      test('invite game: 20 moves never move either page', async ({ browser }) => {
        test.skip(!supabaseConfigured(), 'Supabase env not configured')

        const ctxA = await browser.newContext()
        const ctxB = await browser.newContext()
        const a = await ctxA.newPage()
        const b = await ctxB.newPage()
        try {
          // host creates a casual invite playing White
          await gotoPath(a, '/play')
          expect(await clickButton(a, 'Play a friend')).toBe(true)
          expect(await clickButton(a, 'Casual')).toBe(true)
          expect(await clickButton(a, 'White')).toBe(true)
          expect(await clickButton(a, 'Create invite link')).toBe(true)
          await a.waitForFunction(
            () => [...document.querySelectorAll('input')].some((i) => i.readOnly && /\/join\//.test(i.value)),
            null,
            { timeout: 30_000 },
          )
          const gameId = await a.evaluate(() => {
            const input = [...document.querySelectorAll('input')].find((i) => i.readOnly && /\/join\//.test(i.value))!
            return input.value.split('/join/')[1]
          })

          // friend (separate guest identity) opens the invite link and joins
          await gotoPath(b, `/join/${gameId}`)
          expect(await clickButton(b, 'Join game', 30_000)).toBe(true)
          await a.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 30_000 })
          await b.waitForFunction(() => location.pathname.startsWith('/play/'), null, { timeout: 30_000 })
          await waitBoardSettled(a)
          await waitBoardSettled(b)

          if (orientation === 'black') {
            await flipBoard(a)
            await flipBoard(b)
            await waitBoardSettled(a)
            await waitBoardSettled(b)
          }

          const baseA = await setKnownScroll(a)
          const baseB = await setKnownScroll(b)

          let hBase = baseA
          let jBase = baseB
          for (let i = 0; i < 20; i++) {
            const hostTurn = i % 2 === 0 // host is White
            const r = await playSyncedMove({
              mover: hostTurn ? a : b,
              other: hostTurn ? b : a,
              uci: LINE_20[i],
              ply: i + 1,
              moverBase: hostTurn ? hBase : jBase,
              otherBase: hostTurn ? jBase : hBase,
            })
            hBase = hostTurn ? r.moverBase : r.otherBase
            jBase = hostTurn ? r.otherBase : r.moverBase
          }
        } finally {
          await ctxA.close()
          await ctxB.close()
        }
      })
    })
  }
}
