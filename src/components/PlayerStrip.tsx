import type { ReactNode } from 'react'
import type { PieceColor, PieceType } from '@/board/pieces'
import { pieceUrl } from '@/board/pieces'
import { Avatar } from './Avatar'

const ORDER: PieceType[] = ['p', 'n', 'b', 'r', 'q']
const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export function materialDiff(pieces: { type: PieceType; color: PieceColor }[]): number {
  let v = 0
  for (const p of pieces) v += p.color === 'w' ? VALUE[p.type] : -VALUE[p.type]
  return v
}

export interface PlayerStripProps {
  name: string
  rating?: number | string
  avatarSeed?: string
  flag?: string | null
  /** pieces this player has captured (opponent's pieces) */
  captured?: { type: PieceType; color: PieceColor }[]
  pieceSet: string
  clock?: ReactNode
  active?: boolean
  top?: boolean
  thinking?: boolean
  /** connection indicator */
  connection?: { state: 'ok' | 'grace' | 'lost'; text?: string } | null
  subtitle?: string
}

export function PlayerStrip({
  name,
  rating,
  avatarSeed,
  flag,
  captured = [],
  pieceSet,
  clock,
  active = false,
  top = false,
  thinking = false,
  connection,
  subtitle,
}: PlayerStripProps) {
  const sorted = [...captured].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type))
  // diff from THIS player's perspective: white player counts black pieces as +
  const diff = captured.length ? materialDiff(captured) : 0

  return (
    <div className={`player-strip ${top ? 'top' : 'bottom'} ${thinking ? 'thinking' : ''} ${active ? 'active' : ''}`}>
      {avatarSeed !== undefined && <Avatar seed={avatarSeed} size={34} alt="" />}
      <div className="ps-info">
        <div className="ps-name">
          {name}
          {rating !== undefined && <span className="ps-rating">{rating}</span>}
          {flag && <span style={{ marginLeft: 6 }}>{flag}</span>}
        </div>
        {subtitle && <div className="game-vs">{subtitle}</div>}
        {connection && connection.state !== 'ok' && (
          <div className="game-vs" style={{ color: connection.state === 'lost' ? 'var(--danger-2)' : 'var(--warn)' }}>
            {connection.text ?? (connection.state === 'grace' ? 'reconnecting…' : 'disconnected')}
          </div>
        )}
      </div>
      {sorted.length > 0 && (
        <div className="ps-captured" aria-label="Captured pieces">
          {sorted.map((p, i) => (
            <img key={i} src={pieceUrl(pieceSet, p.color, p.type)} alt="" />
          ))}
          {diff > 0 && <span className="ps-material">+{diff}</span>}
        </div>
      )}
      {clock}
    </div>
  )
}
