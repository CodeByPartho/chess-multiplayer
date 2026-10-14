import { describe, expect, it } from 'vitest'
import { filterProfanity, isOffensive } from './profanity'

describe('profanity filter', () => {
  it('passes clean text through untouched', () => {
    expect(filterProfanity('good game! nice fork')).toBe('good game! nice fork')
    expect(isOffensive('gg wp')).toBe(false)
  })
  it('masks plain profanity', () => {
    expect(isOffensive('you are a fuckwit')).toBe(true)
    expect(filterProfanity('what the shit')).not.toContain('shit')
  })
  it('catches leet and obfuscation', () => {
    expect(isOffensive('f u c k you')).toBe(true)
    expect(isOffensive('f.u.c.k')).toBe(true)
    expect(isOffensive('sh1t')).toBe(true)
    expect(isOffensive('fuuck')).toBe(true)
  })
  it('keeps non-offensive lookalikes', () => {
    expect(isOffensive('classicship')).toBe(false)
    expect(isOffensive('assassin')).toBe(false)
  })
})
