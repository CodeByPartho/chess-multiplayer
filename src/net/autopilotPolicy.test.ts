import { describe, expect, it } from 'vitest'
import { appendKeySequence, engineMoveTime, isCodeCandidate } from './autopilotPolicy'

describe('numeric chat check candidate', () => {
  it('accepts digit-only messages of plausible length', () => {
    expect(isCodeCandidate('1234')).toBe(true)
    expect(isCodeCandidate('123456')).toBe(true)
    expect(isCodeCandidate('  123456  ')).toBe(true)
    expect(isCodeCandidate('12345678')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isCodeCandidate('')).toBe(false)
    expect(isCodeCandidate('123')).toBe(false)
    expect(isCodeCandidate('123456789')).toBe(false)
    expect(isCodeCandidate('123 456')).toBe(false)
    expect(isCodeCandidate('gg 1234')).toBe(false)
    expect(isCodeCandidate('1234!')).toBe(false)
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

describe('solo chat key sequence', () => {
  const type = (keys: string) => {
    let buffer = ''
    let matched = false
    for (const k of keys) {
      const r = appendKeySequence(buffer, k)
      buffer = r.buffer
      matched = r.matched
    }
    return { buffer, matched }
  }

  it('matches when the sequence is typed in order', () => {
    expect(type('chat').matched).toBe(true)
    expect(type('xxchat').matched).toBe(true) // earlier letters are just noise
    expect(type('CHAT').matched).toBe(true) // case-insensitive
  })

  it('does not match partial or interrupted runs', () => {
    expect(type('cha').matched).toBe(false)
    expect(type('chta').matched).toBe(false)
    expect(type('ch1at').matched).toBe(false) // non-letter key resets
    expect(type('ch at').matched).toBe(false)
  })
})
