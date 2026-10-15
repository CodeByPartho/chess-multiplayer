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

  // Regression: without the spec's tau volatility constraint the Newton step is
  // unconstrained, so a few extreme results drove vol into the tens, rd past the
  // 350 ceiling, and the rating off a cliff (observed: vol 45.9, rd 681, -79).
  it('keeps volatility and rd bounded across a punishing sequence', () => {
    let p: GlickoPlayer = { rating: 1500, rd: 350, vol: 0.06, updatedAt: 0 }
    // repeated upset wins, then a long layoff that inflates rd
    const schedule = [
      ...Array.from({ length: 5 }, () => ({ oppRating: 2600, oppRd: 60, score: 1 })),
      { oppRating: 2600, oppRd: 60, score: 0 },
      { oppRating: 2600, oppRd: 60, score: 0 },
    ]
    for (const s of schedule) {
      p = updateGlicko(p, [{ ...s, elapsedMs: DAY }])
      expect(p.rd).toBeLessThanOrEqual(350)
      expect(p.vol).toBeGreaterThanOrEqual(0.01)
      expect(p.vol).toBeLessThanOrEqual(0.5)
      expect(p.rating).toBeGreaterThan(800)
      expect(p.rating).toBeLessThan(2900)
    }
    // after a two-year layoff rd inflates but still respects the 350 ceiling
    const rested = updateGlicko(p, [{ oppRating: p.rating, oppRd: 100, score: 0.5, elapsedMs: 730 * DAY }])
    expect(rested.rd).toBeLessThanOrEqual(350)
    expect(rested.vol).toBeLessThanOrEqual(0.5)
  })

  it('two evenly matched players converge toward parity', () => {
    let a: GlickoPlayer = { rating: 1500, rd: 350, vol: 0.06, updatedAt: 0 }
    let b: GlickoPlayer = { rating: 1500, rd: 350, vol: 0.06, updatedAt: 0 }
    const gaps: number[] = []
    for (let i = 0; i < 8; i++) {
      const aWins = i % 2 === 0
      a = updateGlicko(a, [{ oppRating: b.rating, oppRd: b.rd, score: aWins ? 1 : 0, elapsedMs: DAY }])
      b = updateGlicko(b, [{ oppRating: a.rating, oppRd: a.rd, score: aWins ? 0 : 1, elapsedMs: DAY }])
      gaps.push(Math.abs(a.rating - b.rating))
      expect(a.rd).toBeLessThanOrEqual(350)
      expect(b.rd).toBeLessThanOrEqual(350)
    }
    // fresh 350-RD provisionals legitimately swing ~±160/game, so the first
    // result can open a wide gap; the system's job is to close it as RD tightens.
    expect(Math.max(...gaps)).toBeLessThan(300)
    expect(gaps[gaps.length - 1]).toBeLessThanOrEqual(gaps[0])
    expect(gaps[gaps.length - 1]).toBeLessThan(100)
  })
})
