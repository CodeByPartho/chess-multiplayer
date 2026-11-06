import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { parseBoard, reconcilePieces, type PieceInst } from './reconcile'

/**
 * A tiny harness that mirrors how Board.tsx consumes reconcilePieces:
 * it holds the current piece list and an id allocator starting at 32
 * (past the initial parse's scratch ids 0..31), and folds every new FEN
 * through reconcilePieces with that move's from/to as lastMove.
 */
function makeBoard(startFen?: string) {
  let nextId = 32
  const alloc = () => nextId++
  const chess = new Chess(startFen)
  let pieces = parseBoard(chess.fen())
  return {
    get pieces() {
      return pieces
    },
    /** play one legal UCI move and reconcile the resulting position */
    move(uci: string) {
      const m = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] as 'q' | 'r' | 'b' | 'n' | undefined,
      })
      pieces = reconcilePieces(pieces, chess.fen(), { from: m.from, to: m.to }, alloc)
    },
    /** reconcile a position that arrived in one jump (several moves at once) */
    jumpTo(fen: string, lastMove: { from: string; to: string } | null) {
      pieces = reconcilePieces(pieces, fen, lastMove, alloc)
    },
  }
}

function idAt(pieces: PieceInst[], sq: string): number {
  const p = pieces.find((x) => x.sq === sq)
  if (!p) throw new Error(`no piece on ${sq}`)
  return p.id
}

/** ids whose square changed between two piece lists */
function movedIds(before: PieceInst[], after: PieceInst[]): number[] {
  const beforeSq = new Map(before.map((p) => [p.id, p.sq]))
  return after.filter((p) => beforeSq.has(p.id) && beforeSq.get(p.id) !== p.sq).map((p) => p.id)
}

/** every square holding the same color+type in both lists must keep its id */
function expectUnmovedKeepIds(before: PieceInst[], after: PieceInst[]) {
  const beforeBySq = new Map(before.map((p) => [p.sq, p]))
  for (const p of after) {
    const b = beforeBySq.get(p.sq)
    if (b && b.color === p.color && b.type === p.type) {
      expect(p.id, `piece on ${p.sq} (${p.color}${p.type})`).toBe(b.id)
    }
  }
}

describe('reconcilePieces', () => {
  it('castling after an earlier capture: only king and rook change squares, all ids stay with their pieces', () => {
    const b = makeBoard()
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Bxc6 dxc6 — two captures before castling,
    // so scan-order ids no longer line up with the surviving pieces.
    for (const u of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5c6', 'd7c6']) b.move(u)

    const before = b.pieces
    expect(before).toHaveLength(30)
    const kingId = idAt(before, 'e1')
    const rookId = idAt(before, 'h1')
    const blackKingId = idAt(before, 'e8')
    const blackRookId = idAt(before, 'a8')

    b.move('e1g1') // 5.O-O
    const after = b.pieces

    expect(after).toHaveLength(30)
    expect(idAt(after, 'g1')).toBe(kingId)
    expect(idAt(after, 'f1')).toBe(rookId)
    // exactly two pieces changed squares: the king and the castling rook
    expect(movedIds(before, after).sort((x, y) => x - y)).toEqual([kingId, rookId].sort((x, y) => x - y))
    // the opponent's pieces did not move or swap ids (the reported bug)
    expect(idAt(after, 'e8')).toBe(blackKingId)
    expect(idAt(after, 'a8')).toBe(blackRookId)
    expectUnmovedKeepIds(before, after)
  })

  it('promotion with capture: the new queen inherits the pawn id, unmoved pieces keep theirs', () => {
    // white pawn b7 takes the rook on a8 and promotes
    const b = makeBoard('r3k3/1P5p/8/8/8/8/8/4K3 w q - 0 1')
    const before = b.pieces
    expect(before).toHaveLength(5)
    const pawnId = idAt(before, 'b7')
    const blackKingId = idAt(before, 'e8')
    const blackPawnId = idAt(before, 'h7')
    const whiteKingId = idAt(before, 'e1')

    b.move('b7a8q')
    const after = b.pieces

    expect(after).toHaveLength(4) // rook captured, pawn promoted: still 4 pieces
    const queen = after.find((p) => p.sq === 'a8')
    expect(queen?.type).toBe('q')
    expect(queen?.color).toBe('w')
    expect(queen?.id).toBe(pawnId)
    expect(idAt(after, 'e8')).toBe(blackKingId)
    expect(idAt(after, 'h7')).toBe(blackPawnId)
    expect(idAt(after, 'e1')).toBe(whiteKingId)
    expectUnmovedKeepIds(before, after)
  })

  it('two-move jump from startpos (1.e4 e5 in one update): both pawns keep their origin ids', () => {
    const b = makeBoard()
    const before = b.pieces
    expect(before).toHaveLength(32)
    const e2Id = idAt(before, 'e2')
    const e7Id = idAt(before, 'e7')

    // the position after 1.e4 e5 arrives in a single update; Board passes
    // only the final move (e7e5) as lastMove
    const chess = new Chess()
    chess.move('e4')
    chess.move('e5')
    b.jumpTo(chess.fen(), { from: 'e7', to: 'e5' })
    const after = b.pieces

    expect(after).toHaveLength(32)
    expect(idAt(after, 'e4')).toBe(e2Id)
    expect(idAt(after, 'e5')).toBe(e7Id)
    // only the two pawns changed squares; nothing else slid anywhere
    expect(movedIds(before, after).sort((x, y) => x - y)).toEqual([e2Id, e7Id].sort((x, y) => x - y))
    expectUnmovedKeepIds(before, after)
  })
})
