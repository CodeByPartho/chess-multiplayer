import { Chess } from 'chess.js'
import type { GameReviewResult } from './review'
import { moveLoss, type Eval } from '../lib/chess/classify'

export interface KeyMoment {
  /** ply index (0-based) of the move */
  ply: number
  san: string
  /** centipawns lost by the mover (mover POV) */
  lossCp: number
  text: string
}

export interface ReviewInsights {
  keyMoments: KeyMoment[]
  /** ply index -> one-sentence coach explanation */
  explanations: Map<number, string>
}

const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900 }
const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

function moverEval(e: Eval, white: boolean): Eval {
  if (e.mate !== undefined) return { mate: white ? e.mate : -e.mate }
  return { cp: (e.cp ?? 0) * (white ? 1 : -1) }
}

/** biggest undefended piece the mover leaves behind after their move */
function hungPiece(chessAfter: Chess, moverWhite: boolean): { name: string; value: number } | null {
  const mover = moverWhite ? 'w' : 'b'
  const opp = moverWhite ? 'b' : 'w'
  let best: { name: string; value: number } | null = null
  for (const row of chessAfter.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== mover || sq.type === 'k') continue
      if (!chessAfter.isAttacked(sq.square, opp)) continue
      if (chessAfter.isAttacked(sq.square, mover)) continue
      const value = PIECE_VALUE[sq.type] ?? 0
      if (!best || value > best.value) best = { name: PIECE_NAME[sq.type], value }
    }
  }
  return best
}

function pawns(cp: number): string {
  const p = Math.abs(cp) / 100
  return p >= 10 ? 'a decisive amount' : `${p.toFixed(1)} pawns`
}

/**
 * Plain-language explanations for the moves that mattered, plus the
 * game's key moments. Everything is derived from the review's evals,
 * the best-move list and the classifications: no new engine work.
 */
export function buildReviewInsights(result: GameReviewResult, startFen: string, ucis: string[], sans: string[]): ReviewInsights {
  const explanations = new Map<number, string>()
  const moments: KeyMoment[] = []
  const chess = new Chess(startFen)

  for (let i = 0; i < ucis.length; i++) {
    const white = i % 2 === 0
    const before = result.evals[i]
    const after = result.evals[i + 1]
    if (!before || !after) break
    const loss = moveLoss(moverEval(before, white), moverEval(after, white))
    const cls = result.classes[i]
    const uci = ucis[i]
    const preFen = chess.fen()
    let moveObj
    try {
      moveObj = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined })
    } catch {
      break
    }
    if (!moveObj) break

    const bestUci = result.bestUcis[i]
    let bestSan = ''
    if (bestUci) {
      try {
        bestSan = new Chess(preFen).move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci.length > 4 ? bestUci[4] : undefined }).san
      } catch {
        bestSan = ''
      }
    }

    const afterMover = moverEval(after, white)
    if (cls === 'blunder' || cls === 'mistake' || cls === 'miss' || cls === 'inaccuracy') {
      const parts: string[] = []
      if (afterMover.mate !== undefined && afterMover.mate < 0) {
        parts.push(`This allows a forced mate in ${Math.abs(afterMover.mate)}.`)
      } else {
        parts.push(`This move gives back about ${pawns(loss)}.`)
      }
      const hung = hungPiece(chess, white)
      if (hung && hung.value >= 100) parts.push(`It leaves the ${hung.name} undefended.`)
      if (moveObj.captured) parts.push(`The capture looks tempting, but the position after it is worse.`)
      if (bestSan && bestSan !== sans[i]) parts.push(`The engine's move was ${bestSan}.`)
      const text = parts.join(' ')
      explanations.set(i, text)
      if (cls === 'blunder' || cls === 'mistake' || cls === 'miss') {
        moments.push({ ply: i, san: sans[i] ?? uci, lossCp: Math.round(loss), text })
      }
    } else if (cls === 'brilliant' || cls === 'great') {
      const text =
        cls === 'brilliant'
          ? 'A brilliant find: the engine rates this the strongest move in a sharp position.'
          : 'A great move: it keeps the pressure and the advantage.'
      explanations.set(i, text)
      if (cls === 'brilliant') moments.push({ ply: i, san: sans[i] ?? uci, lossCp: 0, text })
    }
  }

  moments.sort((a, b) => b.lossCp - a.lossCp)
  return { keyMoments: moments.slice(0, 3), explanations }
}
