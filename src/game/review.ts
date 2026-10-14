import { Chess } from 'chess.js'
import type { Engine } from '@/engine/engine'
import { classifyMove, accuracyPercent, moveLoss, type ClassLabel, type Eval } from '@/lib/chess/classify'
import { detectOpening } from '@/assets/openings'
import type { Color } from '@/lib/chess/types'

export interface GameReviewResult {
  /** white-POV eval per position index (i = after i plies, 0 = start) */
  evals: Eval[]
  /** engine best-move (uci) per position index */
  bestUcis: string[]
  /** classification per ply index */
  classes: (ClassLabel | null)[]
  accuracy: { w: number; b: number }
  /** plies actually analyzed (for cancelled runs) */
  analyzed: number
}

const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900 }

function moverPov(e: Eval, white: boolean): Eval {
  if (e.mate !== undefined) return { mate: white ? e.mate : -e.mate }
  return { cp: (e.cp ?? 0) * (white ? 1 : -1) }
}

/** material the mover leaves hanging (attacked, undefended, non-king) after a move */
function hungMaterial(chess: Chess): number {
  const mover = chess.turn()
  let total = 0
  const board = chess.board()
  for (const row of board) {
    for (const sq of row) {
      if (!sq || sq.color !== mover || sq.type === 'k') continue
      const attacked = chess.isAttacked(sq.square, mover === 'w' ? 'b' : 'w')
      if (!attacked) continue
      const defended = chess.isAttacked(sq.square, mover)
      if (!defended) total += PIECE_VALUE[sq.type] ?? 0
    }
  }
  return total
}

function uciToSans(startFen: string, ucis: string[]): string[] {
  const c = new Chess(startFen)
  const out: string[] = []
  for (const uci of ucis) {
    try {
      const m = c.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      })
      out.push(m.san)
    } catch {
      break
    }
  }
  return out
}

export interface ReviewProgress {
  done: number
  total: number
  phase: 'eval' | 'classify'
}

/**
 * Full-game analysis: evaluate every position once with the engine, then
 * classify each move and compute per-side accuracy.
 */
export async function reviewGame(
  engine: Engine,
  startFen: string,
  ucis: string[],
  onProgress: (p: ReviewProgress) => void,
  opts?: { movetime?: number; cancelled?: { value: boolean } },
): Promise<GameReviewResult> {
  // positions
  const fens: string[] = [startFen]
  const c = new Chess(startFen)
  for (const uci of ucis) {
    try {
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined })
      fens.push(c.fen())
    } catch {
      break
    }
  }

  const total = fens.length
  const evals: Eval[] = new Array(total).fill({ cp: 0 })
  const bestUcis: string[] = new Array(total).fill('')

  for (let i = 0; i < total; i++) {
    if (opts?.cancelled?.value) break
    const fen = fens[i]
    const stmWhite = fen.split(' ')[1] === 'w'
    try {
      const res = await engine.analyze(fen, { movetime: opts?.movetime ?? 200 })
      const line = res.lines[0]
      if (line) {
        evals[i] =
          line.score.mate !== undefined
            ? { mate: stmWhite ? line.score.mate : -line.score.mate }
            : { cp: (line.score.cp ?? 0) * (stmWhite ? 1 : -1) }
      }
      bestUcis[i] = res.bestmove ?? ''
    } catch {
      /* engine failure → keep 0 */
    }
    onProgress({ done: i + 1, total, phase: 'eval' })
  }

  // classify
  onProgress({ done: 0, total: ucis.length, phase: 'classify' })
  const chess = new Chess(startFen)
  const classes: (ClassLabel | null)[] = []
  const losses: Record<Color, number[]> = { w: [], b: [] }
  const sans = uciToSans(startFen, ucis)
  const opening = detectOpening(sans)
  const openingLen = opening ? opening.sans.length : 0

  for (let i = 0; i < fens.length - 1; i++) {
    const mover: Color = chess.turn()
    try {
      chess.move({
        from: ucis[i].slice(0, 2),
        to: ucis[i].slice(2, 4),
        promotion: ucis[i].length > 4 ? ucis[i][4] : undefined,
      })
    } catch {
      classes.push(null)
      continue
    }
    const white = mover === 'w'
    const before = moverPov(evals[i], white)
    const after = moverPov(evals[i + 1], white)
    const isMate = chess.isCheckmate()
    const movesBefore = (() => {
      // count of legal moves BEFORE this move — recompute on a fresh copy
      try {
        const prev = new Chess(fens[i])
        return prev.moves().length
      } catch {
        return 2
      }
    })()
    const sacrifice = hungMaterial(chess)
    const cls = classifyMove({
      before,
      after,
      bestUci: bestUcis[i],
      playedUci: ucis[i],
      isEngineTop: bestUcis[i] === ucis[i] || bestUcis[i].replace(/q$/, '') === ucis[i].replace(/q$/, ''),
      inBook: i < openingLen,
      isMate,
      sacrifice,
      onlyMove: movesBefore === 1,
    })
    classes.push(cls)
    losses[mover].push(moveLoss(before, after))
    onProgress({ done: i + 1, total: ucis.length, phase: 'classify' })
  }

  return {
    evals,
    bestUcis,
    classes,
    accuracy: { w: accuracyPercent(losses.w), b: accuracyPercent(losses.b) },
    analyzed: fens.length,
  }
}
