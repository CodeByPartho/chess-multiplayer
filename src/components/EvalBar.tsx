import type { Score } from '@/engine/engine'
import { winProb } from '@/lib/chess/classify'

export function formatEval(score: Score | null): string {
  if (!score) return '0.0'
  if (score.mate !== undefined) return `M${Math.abs(score.mate)}`
  const cp = (score.cp ?? 0) / 100
  const abs = Math.abs(cp)
  // abbreviate so the number always fits inside the narrow bar: +7.9 / +12 / M3
  const body = abs >= 10 ? String(Math.round(abs)) : abs.toFixed(1)
  return `${cp >= 0 ? '+' : '−'}${body}`
}

export interface EvalBarProps {
  /** score from WHITE's point of view */
  score: Score | null
  orientation: 'w' | 'b'
  height?: number | string
}

export function EvalBar({ score, orientation, height }: EvalBarProps) {
  const whiteProb = score
    ? score.mate !== undefined
      ? score.mate > 0
        ? 1
        : 0
      : winProb({ cp: score.cp ?? 0 })
    : 0.5
  const pct = Math.max(2, Math.min(98, whiteProb * 100))
  const flip = orientation === 'b'
  // the label sits inside the LARGER side, at its far end, never clipped
  const whiteLarger = pct >= 50
  const whiteAtBottom = !flip
  const atBottom = whiteLarger ? whiteAtBottom : !whiteAtBottom
  return (
    <div className={`evalbar ${flip ? 'flip' : ''}`} style={height !== undefined ? { height } : undefined} aria-label={`Evaluation ${formatEval(score)}`}>
      <div className="eb-fill" style={{ height: `${pct}%` }} />
      <div className={`eb-label ${atBottom ? 'at-bottom' : 'at-top'}`}>{formatEval(score)}</div>
    </div>
  )
}
