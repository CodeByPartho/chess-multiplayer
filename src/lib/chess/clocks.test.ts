import { describe, expect, it } from 'vitest'
import { applyMove, flagFallen, initialClock, remaining } from './clocks'

const NOW = 1_000_000

describe('clocks', () => {
  it('counts down only for the side to move', () => {
    const c = initialClock(60_000, NOW)
    expect(remaining(c, 'w', NOW + 10_000)).toBe(50_000)
    expect(remaining(c, 'b', NOW + 10_000)).toBe(60_000)
  })

  it('never goes negative', () => {
    const c = initialClock(1_000, NOW)
    expect(remaining(c, 'w', NOW + 999_999)).toBe(0)
  })

  it('applyMove consumes elapsed and adds increment', () => {
    const c = initialClock(60_000, NOW)
    const w = applyMove(c, 'w', 2_000, NOW + 12_000)
    expect(w.wms).toBe(50_000) // 60k -12k +2k
    expect(w.turn).toBe('b')
    const b = applyMove(w, 'b', 2_000, NOW + 20_000)
    expect(b.bms).toBe(54_000) // 60k -8k +2k
    expect(b.turn).toBe('w')
  })

  it('flagFallen only on own turn and only at zero', () => {
    const c = initialClock(5_000, NOW)
    expect(flagFallen(c, 'w', NOW + 5_000)).toBe(true)
    expect(flagFallen(c, 'w', NOW + 4_999)).toBe(false)
    expect(flagFallen(c, 'b', NOW + 999_999)).toBe(false) // not b's turn
    const after = applyMove(c, 'w', 0, NOW + 3_000)
    expect(flagFallen(after, 'b', NOW + 10_000)).toBe(true) // b over its time
  })

  it('handles zero-increment blitz under time pressure', () => {
    let c = initialClock(3_000, NOW)
    c = applyMove(c, 'w', 0, NOW + 2_900)
    expect(c.wms).toBe(100)
    // white's stored time stays; black's is ticking now
    expect(remaining(c, 'w', NOW + 2_950)).toBe(100)
    expect(remaining(c, 'b', NOW + 3_000)).toBe(2_900)
  })
})
