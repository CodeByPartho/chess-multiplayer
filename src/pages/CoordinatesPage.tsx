import { useCallback, useEffect, useRef, useState } from 'react'
import { Board } from '@/board/Board'
import { Link } from '@/router'
import { useSettings } from '@/lib/settings'
import { load, save } from '@/lib/storage'
import type { PieceColor } from '@/board/pieces'

const FILES = 'abcdefgh'
const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1'
const ROUND_SECONDS = 30
const BEST_KEY = 'fc.coordBest'

function randomSquare(except?: string): string {
  let sq = ''
  do {
    sq = FILES[Math.floor(Math.random() * 8)] + String(1 + Math.floor(Math.random() * 8))
  } while (sq === except)
  return sq
}

/** Coordinates trainer: the board names a square, you tap it. 30 seconds. */
export default function CoordinatesPage() {
  const settings = useSettings()
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [orientation, setOrientation] = useState<PieceColor>('w')
  const [target, setTarget] = useState('e4')
  const [hits, setHits] = useState(0)
  const [misses, setMisses] = useState(0)
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS)
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null)
  const endAtRef = useRef(0)
  const best = load<number>(BEST_KEY, 0)

  const finish = useCallback(() => {
    setPhase('done')
    if (hits > load<number>(BEST_KEY, 0)) save(BEST_KEY, hits)
  }, [hits])

  useEffect(() => {
    if (phase !== 'running') return
    const id = setInterval(() => {
      const left = Math.max(0, (endAtRef.current - Date.now()) / 1000)
      setTimeLeft(left)
      if (left <= 0) {
        clearInterval(id)
        finish()
      }
    }, 100)
    return () => clearInterval(id)
  }, [phase, finish])

  const start = (side: PieceColor) => {
    setOrientation(side)
    setHits(0)
    setMisses(0)
    setTarget(randomSquare())
    setTimeLeft(ROUND_SECONDS)
    endAtRef.current = Date.now() + ROUND_SECONDS * 1000
    setPhase('running')
  }

  const guess = (sq: string) => {
    if (phase !== 'running') return
    if (sq === target) {
      setHits((h) => h + 1)
      setFlash('hit')
      setTarget(randomSquare(target))
    } else {
      setMisses((m) => m + 1)
      setFlash('miss')
    }
    setTimeout(() => setFlash(null), 220)
  }

  if (phase === 'idle') {
    return (
      <div className="center-page" style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 6px' }}>Coordinates trainer</h1>
        <p style={{ color: 'var(--text-dim)', margin: '0 0 8px' }}>
          The board calls a square, you tap it. Thirty seconds, as many as you can. Best so far: {best}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-primary btn-lg" onClick={() => start('w')}>
            Start as White
          </button>
          <button className="btn btn-lg" onClick={() => start('b')}>
            Start as Black
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <Link to="/puzzles" className="btn btn-ghost btn-sm">
            ← Back to puzzles
          </Link>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="result-banner" style={{ marginBottom: 12 }}>
          <div className="rb-title">{hits} squares found</div>
          <div className="rb-sub">
            {misses} misses · best {Math.max(best, hits)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => start(orientation)}>
            Go again
          </button>
          <button className="btn" onClick={() => start(orientation === 'w' ? 'b' : 'w')}>
            Flip side
          </button>
          <Link to="/puzzles" className="btn">
            Back to puzzles
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 22, fontFamily: 'var(--mono)', fontWeight: 800, color: timeLeft < 8 ? 'var(--danger-2)' : 'var(--text)' }}>
          {Math.ceil(timeLeft)}s
        </span>
        <span>
          Find{' '}
          <b style={{ fontSize: 26, fontFamily: 'var(--mono)', color: flash === 'hit' ? 'var(--accent)' : flash === 'miss' ? 'var(--danger-2)' : 'var(--text)' }}>
            {target}
          </b>
        </span>
        <span className="hint" style={{ marginLeft: 'auto' }}>
          {hits} found · {misses} missed
        </span>
        <button className="btn btn-sm btn-ghost" onClick={finish}>
          End
        </button>
      </div>
      <div className="board-slot">
        <Board
          fen={EMPTY_FEN}
          orientation={orientation}
          pieceSet={settings.pieceSet}
          coords={true}
          editorPiece={{ color: 'w', type: 'k' }}
          onEditorPlace={guess}
          ariaLabel="Coordinates board"
        />
      </div>
    </div>
  )
}
