import type { PieceColor, PieceType } from './pieces'

export interface PieceInst {
  id: number
  color: PieceColor
  type: PieceType
  sq: string
}

export interface BoardMoveLike {
  from: string
  to: string
}

const FILES = 'abcdefgh'

/** Parse the placement field of a FEN into pieces with scratch ids (0..n). */
export function parseBoard(fen: string): PieceInst[] {
  const out: PieceInst[] = []
  let id = 0
  try {
    const rows = fen.split(' ')[0].split('/')
    if (rows.length !== 8) return out
    rows.forEach((row, i) => {
      const rank = 8 - i
      let file = 0
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') {
          file += Number(ch)
        } else {
          if (file > 7) return
          const color: PieceColor = ch === ch.toUpperCase() ? 'w' : 'b'
          out.push({ id: id++, color, type: ch.toLowerCase() as PieceType, sq: FILES[file] + rank })
          file++
        }
      }
    })
  } catch {
    /* malformed fen — empty board */
  }
  return out
}

function dist2(a: string, b: string): number {
  const df = FILES.indexOf(a[0]) - FILES.indexOf(b[0])
  const dr = Number(a[1]) - Number(b[1])
  return df * df + dr * dr
}

/**
 * Work out the new piece list for `fen`, reusing the ids of the pieces in
 * `prev` wherever a piece in the new position is "the same piece" as one
 * from before. React renders one DOM node per id and slides it when its
 * square changes, so an id must stay glued to the same physical piece:
 * if an id hops to a different piece, that piece visibly slides across
 * the board ("random pieces moving").
 *
 * Matching order:
 *  1. same square, same color and type — the piece did not move.
 *  2. the known last move: the piece on `to` is the piece from `from`
 *     (covers promotion, where the type changes).
 *  3. nearest unused piece of the same color and type (the mover, the
 *     castling rook, survivors of a multi-move jump).
 *  4. a piece appearing on its promotion rank inherits the nearest
 *     unused pawn of its color.
 * Anything unmatched is a genuinely new piece (editor setups, undo to a
 * position with more material) and gets a fresh id from `allocId`.
 */
export function reconcilePieces(
  prev: PieceInst[],
  fen: string,
  lastMove: BoardMoveLike | null,
  allocId: () => number,
): PieceInst[] {
  const target = parseBoard(fen)
  const prevById = new Map(prev.map((p) => [p.id, p]))
  const used = new Set<number>()
  const assigned = new Map<number, number>() // target scratch id -> stable id

  const claim = (t: PieceInst, p: PieceInst) => {
    used.add(p.id)
    assigned.set(t.id, p.id)
  }

  // 1. unmoved pieces
  for (const t of target) {
    const p = prev.find((x) => !used.has(x.id) && x.sq === t.sq && x.color === t.color && x.type === t.type)
    if (p) claim(t, p)
  }

  // 2. the piece that made the last move
  if (lastMove) {
    const t = target.find((x) => !assigned.has(x.id) && x.sq === lastMove.to)
    const p = prevById.get(prev.find((x) => x.sq === lastMove.from)?.id ?? -1)
    if (t && p && !used.has(p.id) && p.color === t.color) claim(t, p)
  }

  // 3. nearest same color + type
  for (const t of target) {
    if (assigned.has(t.id)) continue
    let best: PieceInst | null = null
    let bestD = Infinity
    for (const p of prev) {
      if (used.has(p.id) || p.color !== t.color || p.type !== t.type) continue
      const d = dist2(p.sq, t.sq)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    if (best) claim(t, best)
  }

  // 4. promotion leftovers: new piece on the last rank takes a pawn's id
  for (const t of target) {
    if (assigned.has(t.id) || t.type === 'p' || t.type === 'k') continue
    const lastRank = t.color === 'w' ? '8' : '1'
    if (t.sq[1] !== lastRank) continue
    let best: PieceInst | null = null
    let bestD = Infinity
    for (const p of prev) {
      if (used.has(p.id) || p.color !== t.color || p.type !== 'p') continue
      const d = dist2(p.sq, t.sq)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    if (best) claim(t, best)
  }

  return target.map((t) => ({ ...t, id: assigned.get(t.id) ?? allocId() }))
}
