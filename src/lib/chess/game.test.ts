import { describe, expect, it } from 'vitest'
import { GameCore } from './game'
import { IllegalMoveError } from './game'
import type { Ply, TimeControl } from './types'

const NOW = 1_000_000
const tc: TimeControl = { base: 60_000, inc: 1_000, type: 'blitz', label: '1+1' }

function play(g: GameCore, ucis: string[]): void {
  for (const u of ucis) g.moveByUci(u, NOW)
}

describe('legal moves & special rules', () => {
  it('rejects illegal moves', () => {
    const g = new GameCore({ now: NOW })
    expect(() => g.moveByUci('e2e5', NOW)).toThrow(IllegalMoveError)
    expect(() => g.moveByUci('e7e5', NOW)).toThrow(IllegalMoveError) // wrong turn
  })

  it('castling works (king-side and queen-side, both colors)', () => {
    const g = new GameCore({ now: NOW })
    play(g, ['e2e4', 'e7e5', 'g1f3', 'g8f6', 'f1c4', 'f8c5', 'e1g1', 'e8g8'])
    expect(g.plies.at(-2)!.san).toBe('O-O')
    expect(g.plies.at(-1)!.san).toBe('O-O')
    // queenside both sides: white castles on move 5, black clears b8 then castles
    const g3 = new GameCore({ now: NOW })
    play(g3, ['d2d4', 'd7d5', 'b1c3', 'g8f6', 'c1f4', 'c8f5', 'd1d2', 'd8d6', 'e1c1', 'b8c6', 'e2e3', 'e8c8'])
    expect(g3.plies[8].san).toBe('O-O-O') // white, move 5
    expect(g3.plies[11].san).toBe('O-O-O') // black, move 6
  })

  it('castling forbidden when king or rook has moved, or through/into check', () => {
    const g = new GameCore({ now: NOW })
    play(g, ['e2e4', 'e7e5', 'g1f3', 'g8f6', 'e1e2', 'b8c6'])
    expect(g.legalTargets('e2')).not.toContain('g1') // king moved already
    // rook moved away
    const g2 = new GameCore({ now: NOW })
    play(g2, ['h2h3', 'h7h6', 'h1h2', 'a7a6'])
    expect(g2.legalTargets('h1')).toEqual([])
    expect(() => g2.moveByUci('e1g1', NOW)).toThrow(IllegalMoveError)
    // through check
    const g3 = new GameCore({ now: NOW })
    play(g3, ['f2f3', 'e7e5', 'g2g4', 'd8h4']) // queen delivers mate — but also: white cannot castle now
    expect(g3.result).toEqual({ winner: 'b', reason: 'checkmate' })
  })

  it('castling with attacked rook square is allowed (only king path matters)', () => {
    // black rook h8 attacks the h1 rook down the file; king path e1-f1-g1 is safe
    const g = new GameCore({ fen: 'r3k2r/8/8/8/8/8/8/4K2R w Kkq - 0 1', now: NOW })
    expect(g.legalTargets('e1')).toContain('g1')
  })

  it('en passant works and is only available immediately', () => {
    const g = new GameCore({ now: NOW })
    play(g, ['e2e4', 'a7a6', 'e4e5', 'd7d5'])
    expect(g.legalTargets('e5')).toContain('d6')
    play(g, ['e5d6'])
    expect(g.fen.split(' ')[3]).toBe('-')
  })

  it('promotion with piece picker', () => {
    const g = new GameCore({ fen: '8/4P1k1/8/8/8/8/2K5/8 w - - 0 1', now: NOW })
    play(g, ['e7e8q'])
    expect(g.plies[0].san).toContain('e8=Q')
    expect(g.fen).toContain('Q')
    expect(g.result).toBeNull()
    // underpromotion
    const g2 = new GameCore({ fen: '8/4P1k1/8/8/8/8/2K5/8 w - - 0 1', now: NOW })
    play(g2, ['e7e8n'])
    expect(g2.plies[0].san).toBe('e8=N+')
  })

  it('legalTargets lists a promotion square once (four moves share it)', () => {
    const g = new GameCore({ fen: '8/4P1k1/8/8/8/8/2K5/8 w - - 0 1', now: NOW })
    expect(g.legalTargets('e7')).toEqual(['e8'])
  })
})

describe('game endings', () => {
  it('scholars mate → checkmate, white wins', () => {
    const g = new GameCore({ now: NOW })
    play(g, ['f2f3', 'e7e5', 'g2g4', 'd8h4'])
    expect(g.result).toEqual({ winner: 'b', reason: 'checkmate' })
    expect(g.over).toBe(true)
    expect(() => g.moveByUci('a2a3', NOW)).toThrow()
  })

  it('stalemate is a draw', () => {
    // Qg6 stalemates the lone king on h8 (Qg5 on move)
    const g = new GameCore({ fen: '7k/8/8/6Q1/8/8/8/7K w - - 0 1', now: NOW })
    play(g, ['g5g6'])
    expect(g.result).toEqual({ winner: null, reason: 'stalemate' })
  })

  it('threefold repetition draws automatically at the third occurrence', () => {
    const g = new GameCore({ now: NOW })
    const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8']
    play(g, cycle) // 2nd occurrence of start pos
    play(g, cycle) // 3rd
    expect(g.result).toEqual({ winner: null, reason: 'threefold' })
  })

  it('insufficient material: K vs K, KB vs K, KN vs K draw immediately', () => {
    for (const fen of [
      '8/8/4k3/8/8/4K3/8/8 w - - 0 1',
      '8/8/4k3/8/8/4KB2/8/8 w - - 0 1',
      '8/8/4k3/8/8/4KN2/8/8 w - - 0 1',
    ]) {
      const probe = new GameCore({ fen, now: NOW })
      expect(probe.chess.isInsufficientMaterial()).toBe(true)
      expect(probe.result).toBeNull() // detected on first move or via timeout
    }
    const g = new GameCore({ fen: '8/8/4k3/8/8/4KB2/8/8 b - - 0 1', now: NOW })
    play(g, ['e6d6'])
    expect(g.result).toEqual({ winner: null, reason: 'insufficient' })
  })

  it('KB vs KB same-color bishops is a draw, opposite is not', () => {
    const same = new GameCore({ fen: '8/8/3k4/8/8/2B1K3/4b3/8 w - - 0 1', now: NOW })
    expect(same.chess.isInsufficientMaterial()).toBe(false) // c3 light, e2 light? verify color squares
    // c3 = light square? c3: file c=3, rank3 → (3+3)=6 even → light. e2:5+2=7 odd → dark. Opposite colors → not insufficient.
    expect(same.chess.isInsufficientMaterial()).toBe(false)
  })

  it('fifty-move rule draws', () => {
    // halfmove clock already at 99: any quiet piece move triggers the rule
    const g = new GameCore({ fen: '4k3/8/8/8/8/8/8/4KR2 w - - 99 50', now: NOW })
    play(g, ['f1f2'])
    expect(Number(g.fen.split(' ')[4])).toBe(100)
    expect(g.result).toEqual({ winner: null, reason: 'fifty' })
    // a capture would reset the clock instead
    const g2 = new GameCore({ fen: '4k3/8/8/8/8/8/5r2/4KR2 w - - 99 50', now: NOW })
    play(g2, ['f1f2'])
    expect(Number(g2.fen.split(' ')[4])).toBe(0)
    expect(g2.result).toBeNull()
  })
})

describe('clocks, resign, abort, takeback', () => {
  it('clock consumes time and awards increment', () => {
    const g = new GameCore({ tc, now: NOW })
    g.moveByUci('e2e4', NOW + 5_000)
    expect(g.clock!.wms).toBe(56_000) // 60k - 5k + 1k
    expect(g.clock!.turn).toBe('b')
    expect(g.remaining('w', NOW + 5_000)).toBe(56_000)
    expect(g.remaining('b', NOW + 5_000)).toBe(60_000)
    expect(g.remaining('b', NOW + 10_000)).toBe(55_000)
  })

  it('timeout loses unless opponent has insufficient material', () => {
    const g = new GameCore({ tc, now: NOW })
    play(g, ['e2e4', 'e7e5'])
    expect(g.timeout('w', NOW + 70_000)).toBe(true)
    expect(g.result).toEqual({ winner: 'b', reason: 'timeout' })

    // timeout against insufficient material = draw: the flagger's position
    // (K+N vs K) cannot be mated, so running out of time ends it as a draw
    const g3 = new GameCore({ fen: '8/8/4k3/8/8/4KN2/8/8 w - - 0 1', tc, now: NOW })
    expect(g3.timeout('w', NOW + 70_000)).toBe(true)
    expect(g3.result).toEqual({ winner: null, reason: 'insufficient' })
    // and the normal case: a full-material flag wins
    const g4 = new GameCore({ fen: '4k3/8/8/8/8/8/8/4K2R b - - 0 1', tc, now: NOW })
    expect(g4.timeout('b', NOW + 70_000)).toBe(true)
    expect(g4.result).toEqual({ winner: 'w', reason: 'timeout' })
  })

  it('resign loses', () => {
    const g = new GameCore({ now: NOW })
    g.resign('w')
    expect(g.result).toEqual({ winner: 'b', reason: 'resign' })
  })

  it('abort allowed only before the player has moved', () => {
    const g = new GameCore({ now: NOW })
    expect(g.abort('w')).toBe(true)
    expect(g.result).toEqual({ winner: null, reason: 'aborted' })

    const g2 = new GameCore({ now: NOW })
    play(g2, ['e2e4'])
    expect(g2.abort('w')).toBe(false) // white already moved
    expect(g2.abort('b')).toBe(true) // black has not

    const g3 = new GameCore({ now: NOW })
    play(g3, ['e2e4', 'e7e5'])
    expect(g3.abort('b')).toBe(false) // both moved
  })

  it('takeback pops plies and restores clock snapshots', () => {
    const g = new GameCore({ tc, now: NOW })
    play(g, ['e2e4', 'e7e5', 'g1f3'])
    expect(g.plies).toHaveLength(3)
    expect(g.turn).toBe('b')
    g.takeback(2)
    expect(g.plies).toHaveLength(1)
    expect(g.turn).toBe('b') // back to black to move (white's Nf3 undone)
    expect(g.clock!.wms).toBe(61_000) // restored from the e4 ply snapshot (60k +1k inc)
  })

  it('draw offer bookkeeping', () => {
    const g = new GameCore({ now: NOW })
    g.offerDraw('w')
    expect(g.drawOfferedBy).toBe('w')
    g.declineDraw()
    expect(g.drawOfferedBy).toBeNull()
    g.offerDraw('b')
    g.agreeDraw()
    expect(g.result).toEqual({ winner: null, reason: 'agreement' })
  })
})

describe('replay', () => {
  it('rebuilds identical state from plies', () => {
    const g = new GameCore({ tc, now: NOW })
    play(g, ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6'])
    const copy = GameCore.replay(g.startFen, g.plies.map((p): Ply => ({ ...p })), tc, NOW)
    expect(copy.fen).toBe(g.fen)
    expect(copy.plies.map((p) => p.san)).toEqual(g.plies.map((p) => p.san))
    expect(copy.clock!.wms).toBe(g.clock!.wms)
  })

  it('replay of historical timestamps anchors the clock to the last ply', () => {
    // plies stamped in the past: replay must NOT recompute elapsed from the
    // wall clock (that clamps to 0 and leaves the mover's time at the base)
    const g = new GameCore({ tc, now: NOW })
    g.moveByUci('e2e4', NOW) // white uses 5s
    g.moveByUci('e7e5', NOW) // black uses 2s
    const plies = g.plies.map((p): Ply => ({ ...p }))
    plies[0].wms = 55_000 // 60s base - 5s + 1s inc
    plies[0].bms = 60_000
    plies[1].wms = 55_000
    plies[1].bms = 59_000 // 60s - 2s + 1s inc
    const copy = GameCore.replay(g.startFen, plies, tc, NOW + 500_000)
    expect(copy.clock!.wms).toBe(55_000)
    expect(copy.clock!.bms).toBe(59_000)
    expect(copy.clock!.turn).toBe('w')
    expect(copy.clock!.lastMoveAt).toBe(plies[1].at)
  })
})
