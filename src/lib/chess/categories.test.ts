import { describe, expect, it } from 'vitest'
import { categoryFromSeconds, categoryOf, estimateSeconds } from './categories'
import { QUICK_TIME_CONTROLS } from './types'

describe('category classification', () => {
  it('classified by estimated duration: base + 40 * increment seconds', () => {
    expect(categoryFromSeconds(179)).toBe('bullet')
    expect(categoryFromSeconds(180)).toBe('blitz')
    expect(categoryFromSeconds(479)).toBe('blitz')
    expect(categoryFromSeconds(480)).toBe('rapid')
    expect(categoryFromSeconds(1499)).toBe('rapid')
    expect(categoryFromSeconds(1500)).toBe('classical')
    expect(categoryFromSeconds(10_000)).toBe('classical')
  })

  it('estimate uses seconds for both base and increment', () => {
    expect(estimateSeconds({ base: 180_000, inc: 2_000 })).toBe(260) // 3+2
    expect(estimateSeconds({ base: 60_000, inc: 0 })).toBe(60) // 1+0
    expect(estimateSeconds({ base: 900_000, inc: 10_000 })).toBe(1300) // 15+10
  })

  it('standard presets classify into their own label families', () => {
    for (const tc of QUICK_TIME_CONTROLS) {
      const cat = categoryOf(tc)
      if (tc.type === 'custom') continue
      expect(cat).toBe(tc.type)
    }
  })

  it('custom time controls are classified by the formula, not the label', () => {
    expect(categoryOf({ base: 30_000, inc: 0 })).toBe('bullet') // custom 30s
    expect(categoryOf({ base: 300_000, inc: 5_000 })).toBe('rapid') // custom 5+5 → 500s
    expect(categoryOf({ base: 3_600_000, inc: 0 })).toBe('classical')
  })
})
