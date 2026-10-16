import { describe, expect, it } from 'vitest'
import { DEFAULT_RATING, PUZZLE_OPP_RD, updateRating200, isProvisional } from './rating200'

/**
 * The puzzle ladder rates a player against the problem itself, on the same
 * 200 scale as every other pool. These assertions pin the two properties that
 * make it feel right: beating a harder puzzle pays more than an easy one, and
 * the opponent's difficulty is treated as fixed/precise (low RD) rather than a
 * wild human starter.
 */
describe('puzzle rating (200 scale)', () => {
  it('opponent RD is pinned low so solves are decisive but bounded', () => {
    expect(PUZZLE_OPP_RD).toBe(80)
  })

  it('beating a harder puzzle gains more than an easier one', () => {
    const start = { ...DEFAULT_RATING, rating: 500, rd: 120, updatedAt: Date.now() }
    const easy = updateRating200(start, [
      { oppRating: 300, oppRd: PUZZLE_OPP_RD, score: 1, elapsedMs: 60_000 },
    ])
    const hard = updateRating200(start, [
      { oppRating: 900, oppRd: PUZZLE_OPP_RD, score: 1, elapsedMs: 60_000 },
    ])
    expect(easy.rating).toBeGreaterThan(start.rating)
    expect(hard.rating).toBeGreaterThan(easy.rating)
  })

  it('missing an easy puzzle costs more than missing a hard one', () => {
    const start = { ...DEFAULT_RATING, rating: 500, rd: 120, updatedAt: Date.now() }
    const vsEasy = updateRating200(start, [
      { oppRating: 300, oppRd: PUZZLE_OPP_RD, score: 0, elapsedMs: 60_000 },
    ])
    const vsHard = updateRating200(start, [
      { oppRating: 900, oppRd: PUZZLE_OPP_RD, score: 0, elapsedMs: 60_000 },
    ])
    expect(vsEasy.rating).toBeLessThan(start.rating)
    expect(vsHard.rating).toBeGreaterThan(vsEasy.rating)
  })

  it('rating never drops below the floor or above the ceiling', () => {
    const low = { ...DEFAULT_RATING, rating: 100, rd: 45, updatedAt: Date.now() }
    const drop = updateRating200(low, [
      { oppRating: 3000, oppRd: PUZZLE_OPP_RD, score: 0, elapsedMs: 60_000 },
    ])
    expect(drop.rating).toBeGreaterThanOrEqual(100)

    const high = { ...DEFAULT_RATING, rating: 3000, rd: 45, updatedAt: Date.now() }
    const rise = updateRating200(high, [
      { oppRating: 100, oppRd: PUZZLE_OPP_RD, score: 1, elapsedMs: 60_000 },
    ])
    expect(rise.rating).toBeLessThanOrEqual(3000)
  })

  it('RD tightens as more puzzles are solved (less provisional)', () => {
    let cur = { ...DEFAULT_RATING, updatedAt: Date.now() }
    expect(isProvisional(cur.rd)).toBe(true)
    for (let i = 0; i < 12; i++) {
      cur = updateRating200(cur, [
        { oppRating: cur.rating + 40, oppRd: PUZZLE_OPP_RD, score: 1, elapsedMs: 60_000 },
      ])
    }
    expect(cur.rd).toBeLessThan(DEFAULT_RATING.rd)
    expect(isProvisional(cur.rd)).toBe(false)
  })
})
