import { FILE_NAMES, RANK_NAMES, SquareSet, type Position } from 'chessops'
import { Antichess, Atomic, Crazyhouse, Horde, KingOfTheHill, RacingKings, ThreeCheck, defaultPosition, setupPosition } from 'chessops/variant'
import { makeFen } from 'chessops/fen'
import { defaultSetup, type Setup } from 'chessops/setup'
import { parseSquare, parseUci, type Move, type Role } from 'chessops'
import { makeSan } from 'chessops/san'

export type VariantId = 'chess960' | 'crazyhouse' | 'koth' | 'threecheck' | 'atomic' | 'antichess' | 'horde' | 'racingkings'

export interface VariantInfo {
  id: VariantId
  name: string
  tagline: string
  rules: string
}

export const VARIANTS: VariantInfo[] = [
  { id: 'chess960', name: 'Chess960', tagline: 'Fischer random back rank', rules: 'The back rank is shuffled (king between the rooks, bishops on opposite colors). Castling still works and lands the king and rook on the usual squares. Opening theory cannot save you here.' },
  { id: 'crazyhouse', name: 'Crazyhouse', tagline: 'Captured pieces come back', rules: 'When you capture a piece you gain it in your pocket, in your color, and may drop it on any empty square instead of moving. Pawns cannot drop on the first or last rank.' },
  { id: 'koth', name: 'King of the Hill', tagline: 'Reach the center to win', rules: 'Normal chess, plus one extra way to win: get your king to any of the four center squares (d4, d5, e4, e5).' },
  { id: 'threecheck', name: 'Three-check', tagline: 'Check them three times', rules: 'Normal chess, but the first player to give check three times wins instantly. Every check counts, even in a lost position.' },
  { id: 'atomic', name: 'Atomic', tagline: 'Captures explode', rules: 'Every capture explodes: the capturing piece, the captured piece and all non-pawn pieces on neighboring squares are destroyed. Kings cannot capture, and a king may stand next to the enemy king. Explode the enemy king to win.' },
  { id: 'antichess', name: 'Antichess', tagline: 'Lose everything to win', rules: 'Capturing is forced when possible. There is no check and the king is an ordinary piece. Win by losing all your pieces, or by having no legal move.' },
  { id: 'horde', name: 'Horde', tagline: '36 pawns against an army', rules: 'White has no king, just 36 pawns. White wins by checkmating the black king; Black wins by capturing every pawn.' },
  { id: 'racingkings', name: 'Racing Kings', tagline: 'First king to the 8th rank', rules: 'Race your king to the eighth rank. If White gets there, Black gets one last move to draw level. Checks are not allowed: no move may give check or leave a king in check.' },
]

const BACK_RANK: Role[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']

function shuffledBackRank(): Role[] {
  // bishops on opposite colors, king between rooks (the 960 constraints)
  for (;;) {
    const squares: (Role | null)[] = Array(8).fill(null)
    const empty = () => squares.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0)
    squares[[1, 3, 5, 7][Math.floor(Math.random() * 4)]] = 'bishop'
    squares[[0, 2, 4, 6][Math.floor(Math.random() * 4)]] = 'bishop'
    let rest = empty()
    squares[rest[Math.floor(Math.random() * rest.length)]] = 'queen'
    rest = empty()
    for (let n = 0; n < 2; n++) {
      squares[rest[Math.floor(Math.random() * rest.length)]] = 'knight'
      rest = empty()
    }
    const [a, b, c] = rest
    squares[a] = 'rook'
    squares[b] = 'king'
    squares[c] = 'rook'
    return squares as Role[]
  }
}

function chess960Setup(): Setup {
  const setup = defaultSetup()
  const rank = shuffledBackRank()
  let rights = SquareSet.empty()
  for (let f = 0; f < 8; f++) {
    const role = rank[f]
    setup.board.set(f, { role, color: 'white' })
    setup.board.set(f + 56, { role, color: 'black' })
    if (role === 'rook') {
      rights = rights.with(f).with(f + 56)
    }
  }
  // castling rights are the rook squares (Shredder style)
  setup.castlingRights = rights
  return setup
}

export function newVariantPosition(id: VariantId): Position {
  switch (id) {
    case 'chess960': {
      const res = setupPosition('chess', chess960Setup())
      return res.isOk ? res.value : defaultPosition('chess')
    }
    case 'crazyhouse':
      return Crazyhouse.default()
    case 'koth':
      return KingOfTheHill.default()
    case 'threecheck':
      return ThreeCheck.default()
    case 'atomic':
      return Atomic.default()
    case 'antichess':
      return Antichess.default()
    case 'horde':
      return Horde.default()
    case 'racingkings':
      return RacingKings.default()
  }
}

/** FEN the site Board component can render (pocket brackets stripped). */
export function displayFen(pos: Position): string {
  return makeFen(pos.toSetup()).replace(/\[[^\]]*\]/g, '')
}

const VALUES: Record<Role, number> = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 0 }

export function legalDests(pos: Position, squareName: string): string[] {
  const sq = parseSquare(squareName)
  if (sq === undefined) return []
  const out: string[] = []
  for (const to of pos.dests(sq)) out.push(FILE_NAMES[to % 8] + RANK_NAMES[Math.floor(to / 8)])
  return out
}

export function tryPlay(pos: Position, uci: string): { san: string; move: Move } | null {
  const move = parseUci(uci)
  if (!move || !pos.isLegal(move)) return null
  const san = makeSan(pos, move)
  pos.play(move)
  return { san, move }
}

export interface PocketPiece {
  role: Role
  count: number
}

export function pocketOf(pos: Position, color: 'white' | 'black'): PocketPiece[] {
  if (!pos.pockets) return []
  const side = pos.pockets[color]
  const out: PocketPiece[] = []
  for (const role of BACK_RANK) {
    const n = side[role] ?? 0
    if (n > 0) out.push({ role, count: n })
  }
  return out
}

function evaluate(pos: Position, id: VariantId): number {
  // score from the side-to-move's opponent perspective helper below
  let score = 0
  for (const sq of pos.board.occupied) {
    const piece = pos.board.get(sq)
    if (!piece) continue
    let v = VALUES[piece.role]
    if (id === 'koth' && piece.role === 'king') {
      const f = sq % 8
      const r = Math.floor(sq / 8)
      const center = (f === 3 || f === 4) && (r === 3 || r === 4) ? 5000 : (f >= 2 && f <= 5 && r >= 2 && r <= 5 ? 120 : 0)
      v = center
    }
    score += piece.color === 'white' ? v : -v
  }
  if (pos.pockets) {
    for (const color of ['white', 'black'] as const) {
      for (const role of BACK_RANK) {
        const n = pos.pockets[color][role] ?? 0
        score += (color === 'white' ? 1 : -1) * n * VALUES[role] * 0.9
      }
    }
  }
  if (id === 'racingkings') {
    for (const color of ['white', 'black'] as const) {
      const kingSq = pos.board.kingOf(color)
      if (kingSq !== undefined) {
        const rank = Math.floor(kingSq / 8)
        score += (color === 'white' ? 1 : -1) * (color === 'white' ? rank : 7 - rank) * 90
      }
    }
  }
  return score
}

/** one-ply greedy move picker for the local computer in variants */
export function pickVariantMove(pos: Position, id: VariantId): Move | null {
  const mover = pos.turn
  const candidates: Move[] = []
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const piece = pos.board.get(from)
      const isPromoRank = piece?.role === 'pawn' && (Math.floor(to / 8) === 0 || Math.floor(to / 8) === 7)
      candidates.push({ from, to, promotion: isPromoRank ? 'queen' : undefined })
      if (isPromoRank) candidates.push({ from, to, promotion: 'knight' })
    }
  }
  if (pos.pockets) {
    const pocket = pocketOf(pos, mover)
    const drops = pos.dropDests()
    for (const { role } of pocket) {
      for (const to of drops) candidates.push({ role, to })
    }
  }
  if (candidates.length === 0) return null

  let bestScore = -Infinity
  let best: Move[] = []
  for (const move of candidates) {
    const clone = pos.clone()
    clone.play(move)
    const outcome = clone.outcome()
    let s: number
    if (outcome?.winner) s = outcome.winner === mover ? 1_000_000 : -1_000_000
    else if (outcome) s = 0
    else {
      const raw = evaluate(clone, id)
      s = (mover === 'white' ? raw : -raw) + Math.random() * 24
      if (id === 'threecheck' && clone.isCheck()) s += 260
    }
    if (s > bestScore + 0.01) {
      bestScore = s
      best = [move]
    } else if (Math.abs(s - bestScore) <= 0.01) {
      best.push(move)
    }
  }
  return best[Math.floor(Math.random() * best.length)]
}

export function variantOutcomeText(pos: Position, id: VariantId): string | null {
  const outcome = pos.outcome()
  if (!outcome) return null
  if (!outcome.winner) return 'Draw.'
  const winner = outcome.winner === 'white' ? 'White' : 'Black'
  if (pos.isVariantEnd()) {
    switch (id) {
      case 'koth':
        return `${winner} wins: the king reached the center.`
      case 'threecheck':
        return `${winner} wins: three checks delivered.`
      case 'atomic':
        return `${winner} wins: the enemy king was exploded.`
      case 'antichess':
        return `${winner} wins by losing everything.`
      case 'horde':
        return winner === 'White' ? 'White wins: the black king is checkmated.' : 'Black wins: every pawn is gone.'
      case 'racingkings':
        return `${winner} wins the race to the eighth rank.`
      default:
        return `${winner} wins.`
    }
  }
  if (pos.isCheckmate()) return `${winner} wins by checkmate.`
  if (pos.isStalemate()) return id === 'antichess' ? `${winner} wins: no legal moves.` : 'Draw by stalemate.'
  return `${winner} wins.`
}
