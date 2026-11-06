import { describe, expect, it } from 'vitest'
import { buildMastery, masteryLevelFor } from './stats'
import type { GameRecord } from './history'

function rec(id: string, sans: string[], winner: 'w' | 'b' | null, myColor: 'w' | 'b' | null = 'w'): GameRecord {
  return {
    id,
    mode: 'computer',
    tc: null,
    rated: false,
    startFen: 'start',
    moves: sans.map((san) => ({ uci: '', san })),
    result: { winner, reason: winner ? 'checkmate' : 'stalemate' } as GameRecord['result'],
    white: { name: 'Me', rating: 1000, avatarSeed: 'me', flag: null },
    black: { name: 'Bot', rating: 1000, avatarSeed: 'bot', flag: null },
    myColor,
    date: 0,
  }
}

// a Ruy Lopez start — matches an ECO main line in the openings table
const RUY = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']

describe('buildMastery', () => {
  it('groups games by detected opening with a full record', () => {
    const out = buildMastery([
      rec('g1', RUY, 'w'),
      rec('g2', RUY, 'b'),
      rec('g3', RUY, null),
      rec('g4', ['h4'], 'w'), // Kádas — in the table too, single game
    ])
    const ruy = out.find((e) => e.name.includes('Ruy Lopez'))!
    expect(ruy).toBeTruthy()
    expect(ruy.games).toBe(3)
    expect(ruy.wins).toBe(1)
    expect(ruy.losses).toBe(1)
    expect(ruy.draws).toBe(1)
    expect(ruy.winPct).toBe(33)
    expect(ruy.gameIds).toEqual(['g3', 'g2', 'g1'])
    expect(ruy.lineSans.length).toBeGreaterThan(0)
  })

  it('skips games that are not mine', () => {
    expect(buildMastery([rec('x', RUY, 'w', null)])).toEqual([])
  })
})

describe('masteryLevelFor', () => {
  it('follows the tiers', () => {
    expect(masteryLevelFor(0, 0).level).toBe('Rookie')
    expect(masteryLevelFor(3, 0).level).toBe('Student')
    expect(masteryLevelFor(5, 50).level).toBe('Specialist')
    expect(masteryLevelFor(5, 40).level).toBe('Student')
    expect(masteryLevelFor(10, 55).level).toBe('Expert')
    expect(masteryLevelFor(20, 60).level).toBe('Master')
    expect(masteryLevelFor(20, 60).nextAt).toBeNull()
    expect(masteryLevelFor(1, 100).nextAt).toBe(3)
  })
})
