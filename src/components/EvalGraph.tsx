import { useMemo } from 'react'
import { winProb } from '@/lib/chess/classify'

export interface EvalGraphProps {
  /** white-POV eval per position index: index0 = start position, i = after i plies */
  evals: { cp?: number; mate?: number }[]
  currentPly: number
  onSeek: (ply: number) => void
}

export function EvalGraph({ evals, currentPly, onSeek }: EvalGraphProps) {
  const n = evals.length
  const points = useMemo(() => {
    if (n === 0) return ''
    return evals
      .map((e, i) => {
        const x = n === 1 ? 50 : (i / (n - 1)) * 100
        const p = winProb(e) // 0..1, white POV
        const y = 50 - (p - 0.5) * 92 //50 center; clamp visually
        return `${x.toFixed(2)},${Math.max(2, Math.min(98, y)).toFixed(2)}`
      })
      .join(' ')
  }, [evals, n])

  if (n === 0) return null

  return (
    <div
      className="eval-graph-wrap"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const frac = (e.clientX - rect.left - 8) / Math.max(1, rect.width - 16)
        const idx = Math.round(Math.max(0, Math.min(1, frac)) * (n - 1))
        onSeek(idx)
      }}
      title="Evaluation graph — click to jump"
    >
      <svg className="eval-graph" viewBox="0 0 100 50" preserveAspectRatio="none" aria-label="Evaluation graph">
        <line x1="0" y1="25" x2="100" y2="25" stroke="var(--border)" strokeWidth="0.5" />
        <polyline points={points} fill="none" stroke="var(--text-dim)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="eg-zero" />
      {currentPly < n && (
        <div
          className="eg-marker"
          style={{ left: `calc(8px + (100% - 16px) * ${(n === 1 ? 0 : currentPly / (n - 1)).toFixed(4)})` }}
        />
      )}
    </div>
  )
}
