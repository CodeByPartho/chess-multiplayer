import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RATING,
  RATING_FLOOR,
  clampRating,
  expectedScore200,
  fromLegacy,
  isProvisional,
  previewDeltas,
  updateRating200,
  type Rating200,
} from './rating200'

const DAY = 24 * 3600 * 1000
const fresh = (over: Partial<Rating200> = {}): Rating200 => ({ ...DEFAULT_RATING, updatedAt: 0, ...over })

describe('glicko-2 on the 200 scale', () => {
  it('everyone starts at 200 / rd 350 / vol 0.06 and is provisional', () => {
    expect(DEFAULT_RATING.rating).toBe(200)
    expect(DEFAULT_RATING.rd).toBe(350)
    expect(DEFAULT_RATING.vol).toBe(0.06)
    expect(isProvisional(350)).toBe(true)
    expect(isProvisional(111)).toBe(true)
    expect(isProvisional(110)).toBe(false)
    expect(isProvisional(45)).toBe(false)
  })

  it('beating a 200-rated opponent gains a large initial amount (>= 80) and gains shrink as rd falls', () => {
    // rd 350 = maximum uncertainty: the very first game swings hard.
    // (Exact Glicko-2 maths gives ~+162 at rd 350; the spec's "≈80-ish"
    // figure is what the same matchup yields once rd settles near 200 —
    // asserted below — so both properties are checked explicitly.)
    const g350 = updateRating200(fresh(), [{ oppRating: 200, oppRd: 350, score: 1, elapsedMs: 0 }]).rating - 200
    expect(g350).toBeGreaterThanOrEqual(80)
    expect(g350).toBeLessThan(250)

    const g200 = updateRating200(fresh({ rd: 200 }), [{ oppRating: 200, oppRd: 200, score: 1, elapsedMs: 0 }]).rating - 200
    expect(g200).toBeGreaterThanOrEqual(60)
    expect(g200).toBeLessThanOrEqual(100) // ≈ +79 — "about 80-ish"

    const g110 = updateRating200(fresh({ rd: 110 }), [{ oppRating: 200, oppRd: 110, score: 1, elapsedMs: 0 }]).rating - 200
    const g60 = updateRating200(fresh({ rd: 60 }), [{ oppRating: 200, oppRd: 60, score: 1, elapsedMs: 0 }]).rating - 200

    // strictly shrinking with certainty
    expect(g350).toBeGreaterThan(g200)
    expect(g200).toBeGreaterThan(g110)
    expect(g110).toBeGreaterThan(g60)
    expect(g60).toBeGreaterThan(0)
  })

  it('paper reference example (offset-invariant): 1500/200 player vs 1400/30, 1550/10, 1700/300 lands in the published range', () => {
    // the same reference case the raw-scale suite checks, expressed on the
    // 200 scale via the +1300 offset (1500 ≡ 200) — gains must match
    const p = fresh({ rating: 200, rd: 200 })
    const out = updateRating200(p, [
      { oppRating: 100, oppRd: 30, score: 1, elapsedMs: 7 * DAY },
      { oppRating: 250, oppRd: 10, score: 0, elapsedMs: 7 * DAY },
      { oppRating: 400, oppRd: 300, score: 0, elapsedMs: 7 * DAY },
    ])
    // paper (Glicko-1) gives 1500→~1464 i.e. 200→~164 on this scale
    expect(out.rating).toBeGreaterThan(140)
    expect(out.rating).toBeLessThan(190)
    expect(out.rd).toBeGreaterThan(120)
    expect(out.rd).toBeLessThan(200)
  })

  it('rating floor of 100 holds under a punishing loss streak', () => {
    let p = fresh({ rating: 130, rd: 60, vol: 0.06 })
    for (let i = 0; i < 12; i++) {
      p = updateRating200(p, [{ oppRating: 400, oppRd: 50, score: 0, elapsedMs: DAY }])
      expect(p.rating).toBeGreaterThanOrEqual(RATING_FLOOR)
      expect(p.rd).toBeGreaterThanOrEqual(45)
      expect(p.rd).toBeLessThanOrEqual(350)
      expect(p.vol).toBeGreaterThanOrEqual(0.01)
      expect(p.vol).toBeLessThanOrEqual(0.5)
    }
    expect(p.rating).toBe(RATING_FLOOR)
  })

  it('rd never falls below the floor of 45 and never above 350', () => {
    // a large, highly-certain rating period would drive rd under 45 — the
    // floor clamps it (the same bound the DB CHECK enforces)
    let p = fresh({ rd: 50 })
    const many = Array.from({ length: 30 }, () => ({ oppRating: p.rating, oppRd: 30, score: 0.5, elapsedMs: 0 }))
    p = updateRating200(p, many)
    expect(p.rd).toBe(45)
    expect(p.rd).toBeGreaterThanOrEqual(45)

    // single low-information games never push rd out of [45, 350]
    let q = fresh({ rd: 46 })
    for (let i = 0; i < 30; i++) {
      q = updateRating200(q, [{ oppRating: q.rating, oppRd: 350, score: 0.5, elapsedMs: 0 }])
      expect(q.rd).toBeGreaterThanOrEqual(45)
      expect(q.rd).toBeLessThanOrEqual(350)
    }
    // inactivity inflates rd but the 350 cap holds
    const rested = updateRating200(q, [{ oppRating: q.rating, oppRd: 50, score: 0.5, elapsedMs: 3 * 365 * DAY }])
    expect(rested.rd).toBeLessThanOrEqual(350)
  })

  it('bounds survive an extreme punishing sequence', () => {
    let p = fresh()
    const schedule = [
      ...Array.from({ length: 6 }, () => ({ oppRating: 1300, oppRd: 40, score: 0 })),
      ...Array.from({ length: 3 }, () => ({ oppRating: 100, oppRd: 40, score: 1 })),
    ]
    for (const s of schedule) {
      p = updateRating200(p, [{ ...s, elapsedMs: DAY }])
      expect(p.rating).toBeGreaterThanOrEqual(100)
      expect(p.rd).toBeGreaterThanOrEqual(45)
      expect(p.rd).toBeLessThanOrEqual(350)
      expect(p.vol).toBeGreaterThanOrEqual(0.01)
      expect(p.vol).toBeLessThanOrEqual(0.5)
    }
  })

  it('symmetric updates: equal players exchange equal magnitudes', () => {
    // rated well above the floor so neither side hits the 100 clamp
    const a = fresh({ rating: 500 })
    const b = fresh({ rating: 500 })
    const aWins = updateRating200(a, [{ oppRating: b.rating, oppRd: b.rd, score: 1, elapsedMs: DAY }])
    const bLoses = updateRating200(b, [{ oppRating: a.rating, oppRd: a.rd, score: 0, elapsedMs: DAY }])
    const gain = aWins.rating - a.rating
    const loss = b.rating - bLoses.rating
    expect(Math.abs(gain - loss)).toBeLessThanOrEqual(2)
    // draws leave the rating unchanged for equal players
    const draw = updateRating200(a, [{ oppRating: b.rating, oppRd: b.rd, score: 0.5, elapsedMs: DAY }])
    expect(draw.rating).toBe(a.rating)
  })

  it('expected score and preview agree with the update direction', () => {
    expect(expectedScore200(fresh(), fresh())).toBeCloseTo(0.5, 2)
    expect(expectedScore200(fresh({ rating: 600 }), fresh({ rd: 50 }))).toBeGreaterThan(0.85)
    expect(expectedScore200(fresh({ rating: 600 }), fresh({ rd: 50 }))).toBeLessThan(1)

    const now = 10 * DAY
    // symmetric around parity — rated above the floor so the loss is not clamped
    const prev = previewDeltas(fresh({ rating: 500, updatedAt: 0 }), fresh({ rating: 500, updatedAt: 0 }), now)
    expect(prev.win).toBeGreaterThan(0)
    expect(prev.loss).toBeLessThan(0)
    expect(prev.draw).toBe(0)
    expect(prev.win + prev.loss).toBeCloseTo(0, 0)
    expect(500 + prev.win).toBe(prev.next.win)
  })

  it('clampRating enforces the database CHECK bounds', () => {
    expect(clampRating({ rating: 12, rd: 3, vol: 9 }).rating).toBe(100)
    expect(clampRating({ rating: 12, rd: 3, vol: 9 }).rd).toBe(45)
    expect(clampRating({ rating: 12, rd: 3, vol: 9 }).vol).toBe(0.5)
    expect(clampRating({ rating: 99999, rd: 9999, vol: 0 }).rd).toBe(350)
    expect(clampRating({ rating: 99999, rd: 9999, vol: 0 }).vol).toBe(0.01)
  })

  it('fromLegacy converts 1500-based records to the 200 scale', () => {
    expect(fromLegacy({ rating: 1500, rd: 350, vol: 0.06, updatedAt: 7 }).rating).toBe(200)
    expect(fromLegacy({ rating: 1621, rd: 111 }).rating).toBe(321)
    expect(fromLegacy({ rating: 1350, rd: 20 }).rating).toBe(100) // floor
    expect(fromLegacy({ rating: 1500, rd: 999 }).rd).toBe(350)
  })
})
