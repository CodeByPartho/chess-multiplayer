import { describe, expect, it } from 'vitest'
import { parseSquare } from 'chessops'
import { VARIANTS, displayFen, legalDests, newVariantPosition, pickVariantMove, tryPlay, variantOutcomeText } from './variantGame'

describe('variant positions', () => {
  it('every variant starts with legal moves and no outcome', () => {
    for (const v of VARIANTS) {
      const pos = newVariantPosition(v.id)
      expect(pos.outcome()).toBeUndefined()
      expect(variantOutcomeText(pos, v.id)).toBeNull()
      const move = pickVariantMove(pos, v.id)
      expect(move).not.toBeNull()
    }
  })

  it('chess960 back rank obeys the 960 constraints', () => {
    for (let trial = 0; trial < 12; trial++) {
      const pos = newVariantPosition('chess960')
      const roles: string[] = []
      for (let f = 0; f < 8; f++) {
        const piece = pos.board.get(parseSquare('abcdefgh'[f] + '1')!)
        roles.push(piece?.role ?? '?')
      }
      expect(roles.filter((r) => r === 'rook')).toHaveLength(2)
      expect(roles.filter((r) => r === 'bishop')).toHaveLength(2)
      const king = roles.indexOf('king')
      const rooks = [roles.indexOf('rook'), roles.lastIndexOf('rook')]
      expect(king).toBeGreaterThan(rooks[0])
      expect(king).toBeLessThan(rooks[1])
      const bishops = [roles.indexOf('bishop'), roles.lastIndexOf('bishop')]
      expect(bishops[0] % 2).not.toBe(bishops[1] % 2)
      expect(displayFen(pos)).not.toContain('[')
    }
  })

  it('king of the hill ends when the king reaches the center', () => {
    const pos = newVariantPosition('koth')
    // walk the white king up the board with quiet black moves between
    const line = ['e2e4', 'a7a6', 'e1e2', 'a6a5', 'e2e3', 'a5a4', 'e3d4']
    for (const uci of line) {
      const played = tryPlay(pos, uci)
      expect(played, uci).not.toBeNull()
    }
    expect(variantOutcomeText(pos, 'koth')).toContain('center')
  })

  it('three-check tracks remaining checks', () => {
    const pos = newVariantPosition('threecheck')
    expect(pos.remainingChecks?.white).toBe(3)
    const played = tryPlay(pos, 'e2e4')
    expect(played).not.toBeNull()
    expect(legalDests(pos, 'e7').length).toBeGreaterThan(0)
  })

  it('horde gives white pawns only and legal pawn moves', () => {
    const pos = newVariantPosition('horde')
    let whitePieces = 0
    let whiteKings = 0
    for (const sq of pos.board.occupied) {
      const piece = pos.board.get(sq)
      if (piece?.color === 'white') {
        whitePieces++
        if (piece.role === 'king') whiteKings++
      }
    }
    expect(whitePieces).toBe(36)
    expect(whiteKings).toBe(0)
    expect(pickVariantMove(pos, 'horde')).not.toBeNull()
  })
})
