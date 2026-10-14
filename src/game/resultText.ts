import type { GameResult, EndReason } from '@/lib/chess/types'

const REASON_LABEL: Record<EndReason, string> = {
  checkmate: 'checkmate',
  resign: 'resignation',
  timeout: 'time',
  stalemate: 'stalemate',
  threefold: 'threefold repetition',
  fivemove: 'fivefold repetition',
  fifty: '50-move rule',
  insufficient: 'insufficient material',
  agreement: 'agreement',
  aborted: 'abort',
  disconnect: 'disconnection',
}

export function reasonLabel(r: GameResult): string {
  return REASON_LABEL[r.reason] ?? r.reason
}

/** PGN result token */
export function pgnResult(r: GameResult | null): string {
  if (!r) return '*'
  if (!r.winner) return '1/2-1/2'
  return r.winner === 'w' ? '1-0' : '0-1'
}

export function resultTitle(r: GameResult, whiteName: string, blackName: string): string {
  if (r.reason === 'aborted') return 'Game aborted'
  if (!r.winner) return `Draw by ${reasonLabel(r)}`
  const winnerName = r.winner === 'w' ? whiteName : blackName
  return `${winnerName} wins by ${reasonLabel(r)}`
}

export function resultSubtitle(r: GameResult, myColor: 'w' | 'b' | null): string {
  if (!myColor) return ''
  if (!r.winner) return '½ – ½'
  return r.winner === myColor ? 'You won!' : 'You lost'
}
