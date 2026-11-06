import { describe, expect, it } from 'vitest'
import { botAcceptsDraw } from './computerLevels'

describe('botAcceptsDraw', () => {
  it('accepts when the bot is level or worse', () => {
    expect(botAcceptsDraw({ cp: 0 }, 'b')).toBe(true)
    expect(botAcceptsDraw({ cp: 200 }, 'b')).toBe(true) // white is better, bot is black
    expect(botAcceptsDraw({ cp: -200 }, 'w')).toBe(true) // white (bot) is worse
    expect(botAcceptsDraw({ cp: 50 }, 'w')).toBe(true) // bot better by exactly the threshold
  })

  it('declines when the bot is clearly better', () => {
    expect(botAcceptsDraw({ cp: 300 }, 'w')).toBe(false)
    expect(botAcceptsDraw({ cp: -300 }, 'b')).toBe(false)
  })

  it('follows mate scores from the bot perspective', () => {
    expect(botAcceptsDraw({ mate: 3 }, 'w')).toBe(false) // bot (white) is mating
    expect(botAcceptsDraw({ mate: -3 }, 'w')).toBe(true) // bot is being mated
    expect(botAcceptsDraw({ mate: 2 }, 'b')).toBe(true) // white mates, bot is black
  })

  it('declines when there is no evaluation yet', () => {
    expect(botAcceptsDraw(null, 'w')).toBe(false)
  })
})
