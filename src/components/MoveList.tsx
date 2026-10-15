import { useEffect, useRef } from 'react'
import type { ClassLabel } from '@/lib/chess/classify'

export const CLASS_BADGE: Record<ClassLabel, { glyph: string; color: string; name: string }> = {
  brilliant: { glyph: '!!', color: '#26c2a3', name: 'Brilliant' },
  great: { glyph: '!', color: '#5c9cd6', name: 'Great' },
  best: { glyph: '★', color: '#86bc42', name: 'Best' },
  excellent: { glyph: '✓', color: '#9ab87a', name: 'Excellent' },
  good: { glyph: '·', color: '#9d9994', name: 'Good' },
  book: { glyph: '≡', color: '#c9a86a', name: 'Book' },
  inaccuracy: { glyph: '?!', color: '#e0a832', name: 'Inaccuracy' },
  mistake: { glyph: '?', color: '#ff9f43', name: 'Mistake' },
  miss: { glyph: '≠', color: '#d98c8c', name: 'Miss' },
  blunder: { glyph: '??', color: '#ff5a5a', name: 'Blunder' },
  forced: { glyph: '=', color: '#8b97a8', name: 'Forced' },
}

export interface MoveListProps {
  /** SAN for each ply, index 0 = first move */
  sans: string[]
  /** classification per ply (index 0 = first move) */
  classes?: Record<number, ClassLabel>
  /** index of the ply currently displayed (sans.length means live/last) */
  currentPly: number
  onSeek: (ply: number) => void
}

export function MoveList({ sans, classes, currentPly, onSeek }: MoveListProps) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const row = el.querySelector('.mv.current') as HTMLElement | null
    if (!row) return
    // scroll ONLY this container — scrollIntoView would walk up through every
    // ancestor (including the window) and make the whole page jump on a move
    const er = row.getBoundingClientRect()
    const br = el.getBoundingClientRect()
    if (er.top < br.top) el.scrollTop += er.top - br.top - 4
    else if (er.bottom > br.bottom) el.scrollTop += er.bottom - br.bottom + 4
  }, [currentPly, sans.length])

  const rows = Math.ceil(sans.length / 2)

  return (
    <div className="movelist-wrap">
      <div className="movelist-head">
        <span>Moves</span>
        <span>
          {sans.length} ply
        </span>
      </div>
      <div className="movelist" ref={boxRef} role="list" aria-label="Move list">
        {sans.length === 0 && <div className="ml-empty">No moves yet — good luck!</div>}
        {Array.from({ length: rows }, (_, r) => {
          const wIdx = r * 2
          const bIdx = r * 2 + 1
          const renderMv = (idx: number) => {
            if (idx >= sans.length) return <div />
            const cls = classes?.[idx]
            const badge = cls ? CLASS_BADGE[cls] : null
            return (
              <button
                className={`mv ${currentPly === idx + 1 ? 'current' : ''}`}
                onClick={() => onSeek(idx + 1)}
                title={badge ? badge.name : undefined}
              >
                {sans[idx]}
                {badge && (
                  <span className="cls" style={{ color: badge.color }}>
                    {badge.glyph}
                  </span>
                )}
              </button>
            )
          }
          return (
            <div className="ml-row" key={r} role="listitem">
              <span className="ml-no">{r + 1}.</span>
              {renderMv(wIdx)}
              {renderMv(bIdx)}
            </div>
          )
        })}
      </div>
      <div className="movelist-nav">
        <button className="btn btn-ghost btn-sm" onClick={() => onSeek(0)} aria-label="First move" title="First move (Home)">
          ⏮
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onSeek(Math.max(0, currentPly - 1))}
          aria-label="Previous move"
          title="Previous move (←)"
        >
          ◀
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onSeek(Math.min(sans.length, currentPly + 1))}
          aria-label="Next move"
          title="Next move (→)"
        >
          ▶
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onSeek(sans.length)}
          aria-label="Last move / live"
          title="Latest position (End)"
        >
          ⏭
        </button>
      </div>
    </div>
  )
}
