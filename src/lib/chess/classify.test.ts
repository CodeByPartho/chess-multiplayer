import { describe, expect, it } from 'vitest'
import { accuracyPercent, classifyMove, moveLoss, winProb } from './classify'

describe('win probability', () => {
  it('is symmetric and bounded', () => {
    expect(winProb({ cp: 0 })).toBeCloseTo(0.5, 5)
    expect(winProb({ cp: 1000 })).toBeGreaterThan(0.97)
    expect(winProb({ cp: -1000 })).toBeLessThan(0.03)
    expect(winProb({ mate: 3 })).toBe(1)
    expect(winProb({ mate: -2 })).toBe(0)
  })
})

const base = { before: { cp: 0 }, after: { cp: 0 }, bestUci: 'e2e4', playedUci: 'e2e4', isEngineTop: true, inBook: false, isMate: false, sacrifice: 0, onlyMove: false }

describe('classification', () => {
  it('book moves are book', () => {
    expect(classifyMove({ ...base, inBook: true, isEngineTop: false })).toBe('book')
  })
  it('engine top move = best (or brilliant with sacrifice)', () => {
    expect(classifyMove({ ...base, before: { cp: 20 }, after: { cp: 25 } })).toBe('best')
    expect(classifyMove({ ...base, before: { cp: 30 }, after: { cp: 30 }, sacrifice: 400 })).toBe('brilliant')
  })
  it('small losses are excellent/good', () => {
    expect(classifyMove({ ...base, isEngineTop: false, before: { cp: 30 }, after: { cp: 29 } })).toBe('excellent')
    expect(classifyMove({ ...base, isEngineTop: false, before: { cp: 30 }, after: { cp: 15 } })).toBe('good')
  })
  it('winning blunders are harshly labelled', () => {
    expect(classifyMove({ ...base, isEngineTop: false, before: { cp: 600 }, after: { cp: -100 } })).toBe('blunder')
    expect(classifyMove({ ...base, isEngineTop: false, before: { cp: 600 }, after: { cp: 200 } })).toBe('miss')
  })
  it('inaccuracy/mistake/miss/blunder ladder by loss', () => {
    expect(classifyMove({ ...base, isEngineTop: false, before: { cp: 0 }, after: { cp: -40 } })).toBe('inaccuracy')
    expect(classifyMove({ ...base, isEngineTop: false, before: { cp: 0 }, after: { cp: -120 } })).toBe('mistake')
    expect(classifyMove({ ...base, isEngineTop: false, before: { cp: 0 }, after: { cp: -500 } })).toBe('blunder')
  })
  it('mate and only-move cases', () => {
    expect(classifyMove({ ...base, isMate: true })).toBe('brilliant')
    expect(classifyMove({ ...base, isEngineTop: false, onlyMove: true, before: { cp: -500 }, after: { cp: -500 } })).toBe('forced')
  })
})

describe('accuracy', () => {
  it('is100 with no mistakes and drops with losses', () => {
    expect(accuracyPercent([])).toBe(100)
    expect(accuracyPercent([0, 0, 0])).toBe(100)
    const withBlunder = accuracyPercent([0, 0, 0.3])
    const clean = accuracyPercent([0, 0, 0.01])
    expect(withBlunder).toBeLessThan(clean)
    expect(withBlunder).toBeGreaterThan(0)
  })
  it('moveLoss is one-sided', () => {
    expect(moveLoss({ cp: 100 }, { cp: 90 })).toBeLessThan(0.03)
    expect(moveLoss({ cp: 100 }, { cp: -100 })).toBeGreaterThan(0.15)
  })
})
