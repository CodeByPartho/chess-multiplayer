import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER, expectedScore, updateGlicko, type GlickoPlayer } from './glicko'

const DAY = 24 * 3600 * 1000

describe('glicko-2', () => {
  it('follows the reference example from the Glicko paper (approx)', () => {
    // Player rated1500, rd200, vol0.06; results vs1400(rd30)=1,1550(rd10)=0,1700(rd300)=0
    const p: GlickoPlayer = { rating: 1500, rd: 200, vol: 0.06, updatedAt: 0 }
    const out = updateGlicko(p, [
      { oppRating: 1400, oppRd: 30, score: 1, elapsedMs: 7 * DAY },
      { oppRating: 1550, oppRd: 10, score: 0, elapsedMs: 7 * DAY },
      { oppRating: 1700, oppRd: 300, score: 0, elapsedMs: 7 * DAY },
    ])
    // paper (Glicko-1 maths) gives ~1464 / rd~151; Glicko-2 with vol update lands close
    expect(out.rating).toBeGreaterThan(1440)
    expect(out.rating).toBeLessThan(1490)
    expect(out.rd).toBeGreaterThan(120)
    expect(out.rd).toBeLessThan(200)
  })

  it('rating rises after wins, falls after losses', () => {
    const p: GlickoPlayer = { ...DEFAULT_PLAYER, updatedAt: 0 }
    const up = updateGlicko(p, [{ oppRating: 1500, oppRd: 100, score: 1, elapsedMs: DAY }])
    const down = updateGlicko(p, [{ oppRating: 1500, oppRd: 100, score: 0, elapsedMs: DAY }])
    expect(up.rating).toBeGreaterThan(1500)
    expect(down.rating).toBeLessThan(1500)
    expect(up.rd).toBeLessThan(350)
  })

  it('rd shrinks with certainty, grows with inactivity', () => {
    const p: GlickoPlayer = { ...DEFAULT_PLAYER, updatedAt: 0 }
    const certain = updateGlicko(p, Array.from({ length: 10 }, () => ({ oppRating: 1500, oppRd: 30, score: 0.5, elapsedMs: DAY })))
    expect(certain.rd).toBeLessThan(150)
    // an established player (rd100) accumulates uncertainty while idle
    const established: GlickoPlayer = { rating: 1500, rd: 100, vol: 0.06, updatedAt: 0 }
    const idle = updateGlicko(established, [{ oppRating: 1500, oppRd: 50, score: 0.5, elapsedMs: 2 * 365 * DAY }])
    const active = updateGlicko({ ...established, updatedAt: 7 * DAY }, [{ oppRating: 1500, oppRd: 50, score: 0.5, elapsedMs: 7 * DAY }])
    expect(idle.rd).toBeGreaterThan(active.rd)
  })

  it('expectedScore sanity', () => {
    const p: GlickoPlayer = { ...DEFAULT_PLAYER, updatedAt: 0 }
    expect(expectedScore(p, { rating: 1500, rd: 50 })).toBeCloseTo(0.5, 2)
    expect(expectedScore(p, { rating: 1300, rd: 50 })).toBeGreaterThan(0.7)
  })
})
