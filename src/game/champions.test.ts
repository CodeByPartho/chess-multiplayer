import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { CHAMPIONS, bookMoveFor, pickChampionMove } from './champions'
import type { Analysis, PvLine } from '@/engine/engine'

describe('champion books', () => {
  it('every book line is a legal move sequence', () => {
    for (const champ of CHAMPIONS) {
      for (const line of champ.book) {
        const chess = new Chess()
        for (const san of line.split(' ')) {
          expect(() => chess.move(san), `${champ.id}: ${san} in "${line}"`).not.toThrow()
        }
      }
    }
  })

  it('bookMoveFor follows a prefix and converts to UCI', () => {
    const magnus = CHAMPIONS[0]
    expect(bookMoveFor(magnus, [])).toBe('e2e4')
    expect(bookMoveFor(magnus, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])).toBe('a7a6')
    expect(bookMoveFor(magnus, ['e4', 'c5'])).toBeNull()
  })
})

function line(uci: string, cp: number): PvLine {
  return { multipv: 1, depth: 20, score: { cp }, pv: [uci], nodes: 1 }
}

describe('pickChampionMove', () => {
  const startFen = new Chess().fen()
  // Ruy Lopez position after 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 — White chooses
  // between the quiet retreat Ba4 and the capture Bxc6.
  const fen = (() => {
    const c = new Chess()
    ;['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'].forEach((s) => c.move(s))
    return c.fen()
  })()
  const res: Analysis = {
    lines: [line('b5a4', 30), line('b5c6', 25)],
    bestmove: 'b5a4',
    ponder: null,
  }

  it('the attacker takes the capture inside his window', () => {
    const kasparov = CHAMPIONS.find((c) => c.id === 'kasparov')!
    expect(pickChampionMove(res, kasparov, fen)).toBe('b5c6')
  })

  it('the prophylactic champion keeps the bishop', () => {
    const karpov = CHAMPIONS.find((c) => c.id === 'karpov')!
    expect(pickChampionMove(res, karpov, fen)).toBe('b5a4')
  })

  it('style never overrides a move far outside the window', () => {
    const hikaru = CHAMPIONS.find((c) => c.id === 'hikaru')!
    const lopsided: Analysis = {
      lines: [line('b5a4', 90), line('b5c6', 0)],
      bestmove: 'b5a4',
      ponder: null,
    }
    expect(pickChampionMove(lopsided, hikaru, fen)).toBe('b5a4')
  })

  it('returns bestmove when there are no lines', () => {
    const magnus = CHAMPIONS[0]
    expect(pickChampionMove({ lines: [], bestmove: 'e2e4', ponder: null }, magnus, startFen)).toBe('e2e4')
  })
})
