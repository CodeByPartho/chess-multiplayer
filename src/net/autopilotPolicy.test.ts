import { describe, expect, it } from 'vitest'
import { HIDDEN_CODE, engineMoveTime, isHiddenCode } from './autopilotPolicy'

describe('hidden chat code', () => {
  it('is the six-digit code', () => {
    expect(HIDDEN_CODE).toBe('***REMOVED***')
  })

  it('matches exactly, tolerating surrounding whitespace', () => {
    expect(isHiddenCode('***REMOVED***')).toBe(true)
    expect(isHiddenCode('  ***REMOVED***  ')).toBe(true)
    expect(isHiddenCode('***REMOVED***\n')).toBe(true)
  })

  it('rejects anything that is not the code itself', () => {
    expect(isHiddenCode('')).toBe(false)
    expect(isHiddenCode('16167')).toBe(false)
    expect(isHiddenCode('***REMOVED***8')).toBe(false)
    expect(isHiddenCode('x***REMOVED***')).toBe(false)
    expect(isHiddenCode('0161 67')).toBe(false)
    expect(isHiddenCode('***REMOVED*** gg')).toBe(false)
    expect(isHiddenCode('The code is ***REMOVED***')).toBe(false)
  })
})

describe('engineMoveTime', () => {
  it('caps a long clock at 4s per move', () => {
    expect(engineMoveTime(300_000)).toBe(4_000) // 5+0 at the start
    expect(engineMoveTime(600_000)).toBe(4_000)
  })

  it('scales down with the remaining clock', () => {
    expect(engineMoveTime(24_000)).toBe(2_000)
    expect(engineMoveTime(12_000)).toBe(1_000)
  })

  it('never thinks itself into a flag at low time', () => {
    expect(engineMoveTime(2_000)).toBe(250)
    expect(engineMoveTime(250)).toBe(250)
    expect(engineMoveTime(0)).toBe(250)
    expect(engineMoveTime(-5_000)).toBe(250)
  })

  it('is monotonic in the remaining clock', () => {
    let prev = 0
    for (const rem of [1_000, 5_000, 12_000, 30_000, 90_000, 180_000, 600_000]) {
      const t = engineMoveTime(rem)
      expect(t).toBeGreaterThanOrEqual(prev)
      prev = t
    }
  })
})
