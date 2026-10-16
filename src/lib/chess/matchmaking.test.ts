import { describe, expect, it } from 'vitest'
import {
  FARM_MAX_RATED,
  WINDOW_MAX,
  WINDOW_START,
  WINDOW_STEP,
  isFarmingPair,
  windowFor,
  windowLabel,
  withinWindow,
} from './matchmaking'

describe('matchmaking rating window', () => {
  it('starts at ±100 and widens by 50 every 5 seconds', () => {
    expect(windowFor(0)).toBe(WINDOW_START)
    expect(windowFor(4_999)).toBe(100)
    expect(windowFor(5_000)).toBe(150)
    expect(windowFor(9_999)).toBe(150)
    expect(windowFor(10_000)).toBe(200)
    expect(windowFor(30_000)).toBe(400)
  })

  it('caps at the maximum', () => {
    expect(windowFor(1_000_000)).toBe(WINDOW_MAX)
    expect(windowFor(1_000_000, 300)).toBe(300)
    expect(windowFor(0, 50)).toBe(50)
  })

  it('players match only inside the current window', () => {
    expect(withinWindow(200, 301, 0)).toBe(false) // ±100 at t=0
    expect(withinWindow(200, 300, 0)).toBe(true)
    expect(withinWindow(200, 351, 5_000)).toBe(false) // ±150
    expect(withinWindow(200, 350, 5_000)).toBe(true)
    expect(withinWindow(200, 590, 29_999)).toBe(false) // ±400 at 30s
    expect(withinWindow(200, 599, 30_000)).toBe(true)
    expect(withinWindow(100, 700, 60_000)).toBe(true) // ±600 cap covers 600 gap
    expect(withinWindow(100, 701, 60_000)).toBe(false)
    expect(WINDOW_STEP).toBe(50)
  })

  it('label shows the live window for the searching UI', () => {
    expect(windowLabel(0)).toBe('±100')
    expect(windowLabel(10_000)).toBe('±200')
    expect(windowLabel(60_000, 250)).toBe('±250') // capped
  })
})

describe('rating farming limit', () => {
  it('four rated games between the same pair in 24h is the limit', () => {
    expect(isFarmingPair(0)).toBe(false)
    expect(isFarmingPair(3)).toBe(false)
    expect(isFarmingPair(FARM_MAX_RATED)).toBe(true)
    expect(isFarmingPair(9)).toBe(true)
  })
})
