import { describe, expect, it } from 'vitest'
import { buildPgn, parsePgn, uciToSan, validateFen } from './pgn'
import type { Ply } from './types'

const NOW = 1_000_000

function mkPly(uci: string, san: string, fen: string, color: 'w' | 'b'): Ply {
  return { uci, san, fen, color, wms: 60_000, bms: 60_000, at: NOW }
}

describe('pgn', () => {
  it('exports and re-imports a game losslessly', () => {
    const plies = [
      mkPly('e2e4', 'e4', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'w'),
      mkPly('e7e5', 'e5', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'b'),
      mkPly('g1f3', 'Nf3', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2', 'w'),
      mkPly('b8c6', 'Nc6', 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'b'),
    ]
    const pgn = buildPgn(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      plies,
      { white: 'Alice', black: 'Bob', result: '1/2-1/2', timecontrol: '300+0' },
    )
    expect(pgn).toContain('[White "Alice"]')
    expect(pgn).toContain('1. e4 e5 2. Nf3 Nc6')
    const parsed = parsePgn(pgn)
    expect(parsed.ucis).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6'])
    expect(parsed.headers.white).toBe('Alice')
    expect(parsed.headers.result).toBe('1/2-1/2')
  })

  it('throws on malformed pgn', () => {
    expect(() => parsePgn('1. e4 e9 2. d4')).toThrow()
    expect(() => parsePgn('total garbage')).toThrow()
  })

  it('san derivation from ucis', () => {
    expect(uciToSan('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'g8f6'])).toEqual([
      'e4',
      'Nf6',
    ])
  })

  it('fen validation normalizes', () => {
    const fen = validateFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1')
    expect(fen.startsWith('4k3/8/8/8/8/8/8/4K3 w')).toBe(true)
    expect(() => validateFen('not a fen')).toThrow()
  })
})
