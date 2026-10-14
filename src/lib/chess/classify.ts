/**
 * Move classification from engine evaluation deltas.
 *
 * Input per move: the evaluation before the move (from the mover's POV,
 * centipawns or mate) and after the opponent's best reply is irrelevant — we
 * evaluate the position AFTER the move from the mover's POV. We convert both
 * to a win probability in [0,1], then classify by probability loss plus a few
 * structural rules (book moves, sacrifices for brilliant/great).
 */

export type ClassLabel =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'
  | 'forced'

export interface Eval {
  cp?: number
  mate?: number
}

/** Win probability from a centipawn/mate evaluation (mover's POV). */
export function winProb(e: Eval): number {
  if (e.mate !== undefined) return e.mate > 0 ? 1 : 0
  const cp = e.cp ?? 0
  return 1 / (1 + Math.exp(-0.004 * cp))
}

function evalLoss(before: Eval, after: Eval): number {
  return Math.max(0, winProb(before) - winProb(after))
}

function isBestMoveCp(before: Eval): boolean {
  return (before.mate ?? 0) > 0 || (before.cp ?? 0) > 150
}

export interface ClassifyInput {
  /** eval of position before the move, mover's POV */
  before: Eval
  /** eval of position after the move, same POV (engine's view) */
  after: Eval
  /** engine's top move (uci) for the position before */
  bestUci: string
  /** the move actually played (uci) */
  playedUci: string
  /** true when the played move equals the engine's first choice at the search depth used */
  isEngineTop: boolean
  /** true when the position's mainline comes from the opening book */
  inBook: boolean
  /** true when the move gives checkmate */
  isMate: boolean
  /** material sacrificed: value of pieces left en prise beyond what the capture wins (>=0) */
  sacrifice: number
  /** the move is the only legal move */
  onlyMove: boolean
}

export function classifyMove(i: ClassifyInput): ClassLabel {
  if (i.isMate) return 'brilliant'
  if (i.inBook) return 'book'
  if (i.onlyMove) return 'forced'
  const loss = evalLoss(i.before, i.after)
  const fromBest = i.isEngineTop

  // winning-to-losing swings get the harshest labels
  const beforeWin = winProb(i.before)
  const afterWin = winProb(i.after)
  const losingNow = beforeWin >= 0.85 && afterWin < 0.5

  if (fromBest) {
    // best engine move: brilliant when a sacrifice keeps/wins the game, great in tense spots
    if (i.sacrifice >= 250 && isBestMoveCp(i.before)) return 'brilliant'
    if (i.sacrifice >= 300) return 'brilliant'
    if (loss <= 0.005 && (i.sacrifice >= 100 || beforeWin <= 0.35 || beforeWin >= 0.9)) return 'great'
    return 'best'
  }

  if (loss < 0.003) return 'excellent'
  if (loss < 0.02) return 'good'
  if (losingNow) return loss >= 0.15 ? 'blunder' : 'miss'
  if (loss < 0.06) return 'inaccuracy'
  if (loss < 0.15) return 'mistake'
  if (loss < 0.28) return 'miss'
  return 'blunder'
}

/**
 * Accuracy for one player over a game: per-move score is1 minus the win
 * probability lost, steeply weighted so big collapses dominate; the game
 * accuracy is the rounded geometric-ish mean (weighted arithmetic in sqrt
 * space) in percent.
 */
export function accuracyPercent(losses: number[]): number {
  if (losses.length === 0) return 100
  let sum = 0
  for (const l of losses) {
    const score = Math.max(0, 1 - Math.min(1, l / 0.35)) // loss >=35% winprob =>0
    sum += Math.sqrt(score)
  }
  return Math.round(((sum / losses.length) ** 2) * 100)
}

export function moveLoss(before: Eval, after: Eval): number {
  return evalLoss(before, after)
}

export const CLASS_INFO: Record<ClassLabel, { icon: string; color: string; label: string }> = {
  brilliant: { icon: '!!', color: '#26c2a3', label: 'Brilliant' },
  great: { icon: '!!', color: '#5c8bb0', label: 'Great' },
  best: { icon: '★', color: '#81b64c', label: 'Best' },
  excellent: { icon: '✓', color: '#81b64c', label: 'Excellent' },
  good: { icon: '✓', color: '#95b776', label: 'Good' },
  book: { icon: '📖', color: '#a88865', label: 'Book' },
  inaccuracy: { icon: '?!', color: '#f0c15c', label: 'Inaccuracy' },
  mistake: { icon: '?', color: '#e58f2a', label: 'Mistake' },
  miss: { icon: '↔', color: '#e58f2a', label: 'Miss' },
  blunder: { icon: '??', color: '#ca3431', label: 'Blunder' },
  forced: { icon: '→', color: '#999999', label: 'Forced' },
}
