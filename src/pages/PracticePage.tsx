import { useEffect, useRef, useState } from 'react'
import { Board } from '@/board/Board'
import { PlayerStrip } from '@/components/PlayerStrip'
import { Link } from '@/router'
import { useGameSession } from '@/game/useGameSession'
import { Engine } from '@/engine/engine'
import { useSettings } from '@/lib/settings'
import { load, save } from '@/lib/storage'
import type { Color } from '@/lib/chess/types'

export interface Drill {
  id: string
  title: string
  blurb: string
  fen: string
  userColor: Color
  goal: { kind: 'mate' } | { kind: 'survive'; plies: number } | { kind: 'promote' }
  goalText: string
  engineSkill: number
}

export const DRILLS: Drill[] = [
  {
    id: 'mate-queen',
    title: 'Mate with king and queen',
    blurb: 'The first mate every player learns. Box the king in, then finish on the edge.',
    fen: '8/8/8/4k3/8/8/8/2KQ4 w - - 0 1',
    userColor: 'w',
    goal: { kind: 'mate' },
    goalText: 'Checkmate the black king.',
    engineSkill: 10,
  },
  {
    id: 'mate-rook',
    title: 'Mate with king and rook',
    blurb: 'Slower than the queen: cut the board in half, walk your king up, push him to the edge.',
    fen: '8/8/8/4k3/8/8/8/2KR4 w - - 0 1',
    userColor: 'w',
    goal: { kind: 'mate' },
    goalText: 'Checkmate the black king.',
    engineSkill: 10,
  },
  {
    id: 'ladder',
    title: 'The ladder mate',
    blurb: 'Two rooks take turns stepping down the board until the king runs out of ranks.',
    fen: '8/8/8/4k3/8/8/8/R3K2R w K - 0 1',
    userColor: 'w',
    goal: { kind: 'mate' },
    goalText: 'Checkmate using both rooks.',
    engineSkill: 8,
  },
  {
    id: 'promote',
    title: 'Queen the pawn',
    blurb: 'Your b-pawn is one step from glory and the black king is racing back. Timing is everything.',
    fen: '8/1P6/8/8/8/8/k6K/8 w - - 0 1',
    userColor: 'w',
    goal: { kind: 'promote' },
    goalText: 'Promote your pawn to a queen.',
    engineSkill: 12,
  },
  {
    id: 'hold-draw',
    title: 'Hold the draw',
    blurb: 'King and pawn against king and queen is lost with perfect play. Survive 12 half-moves and you have earned the lesson: technique under pressure.',
    fen: '8/8/8/8/3k4/8/3P1q2/3K4 w - - 0 1',
    userColor: 'w',
    goal: { kind: 'survive', plies: 12 },
    goalText: 'Survive 12 half-moves without being checkmated.',
    engineSkill: 6,
  },
  {
    id: 'trap-defense',
    title: 'Survive the Scholar\'s mate attack',
    blurb: 'White is hunting Qxf7 mate. You are Black: defend, develop, and reach 16 half-moves alive.',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
    userColor: 'b',
    goal: { kind: 'survive', plies: 16 },
    goalText: 'Reach 16 half-moves without being checkmated.',
    engineSkill: 10,
  },
]

const DONE_KEY = 'fc.drillsDone'

function goalMet(drill: Drill, s: ReturnType<typeof useGameSession>): boolean {
  if (drill.goal.kind === 'mate') {
    return !!s.result && s.result.reason === 'checkmate' && s.result.winner === drill.userColor
  }
  if (drill.goal.kind === 'survive') {
    return s.plies.length >= drill.goal.plies && !s.result
  }
  // promote: a queen of the user's color exists (drills start queenless for the user)
  const placement = s.core.fen.split(' ')[0]
  const q = drill.userColor === 'w' ? 'Q' : 'q'
  return placement.includes(q)
}

function DrillRunner({ drill, onExit }: { drill: Drill; onExit: () => void }) {
  const settings = useSettings()
  const s = useGameSession({
    mode: 'computer',
    fen: drill.fen,
    tc: null,
    myColors: [drill.userColor],
  })
  const engineRef = useRef<Engine | null>(null)
  const [verdict, setVerdict] = useState<'won' | 'lost' | null>(null)
  const engineColor: Color = drill.userColor === 'w' ? 'b' : 'w'

  useEffect(() => {
    let dead = false
    Engine.create().then((e) => {
      if (dead) {
        e.dispose()
        return
      }
      e.setSkill(drill.engineSkill)
      engineRef.current = e
    })
    return () => {
      dead = true
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [drill.engineSkill])

  // verdict tracking
  useEffect(() => {
    if (verdict) return
    if (goalMet(drill, s)) {
      setVerdict('won')
      const done = load<string[]>(DONE_KEY, [])
      if (!done.includes(drill.id)) save(DONE_KEY, [...done, drill.id])
      return
    }
    if (s.result && s.result.reason === 'checkmate' && s.result.winner === engineColor) setVerdict('lost')
    if (s.result && drill.goal.kind === 'mate' && s.result.winner !== drill.userColor) setVerdict('lost')
  })

  // engine replies
  const key = `${s.plies.length}:${s.turn}:${s.over}:${s.isLive}`
  useEffect(() => {
    const e = engineRef.current
    if (!e || verdict || s.over || s.turn !== engineColor || !s.isLive) return
    let cancelled = false
    e.analyze(s.core.fen, { movetime: 350 })
      .then((res) => {
        if (cancelled || !res.bestmove || s.over) return
        s.applyExternalMove(res.bestmove)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      e.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, verdict])

  return (
    <div className="game-layout" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="game-main">
        <PlayerStrip top name="Computer" pieceSet={settings.pieceSet} captured={[]} active={!s.over && s.turn === engineColor} />
        <div className="board-slot">
          <Board
            fen={s.displayFen}
            orientation={drill.userColor}
            movable={verdict ? [] : s.movable}
            onMove={(uci) => s.tryUserMove(uci)}
            legalTargets={s.legalTargets}
            lastMove={s.displayLastMove}
            checkSquare={s.checkSquare}
            pieceSet={settings.pieceSet}
            coords={settings.coords}
            autoQueen={settings.autoQueen}
            blindfold={settings.blindfold}
            ariaLabel={`Drill: ${drill.title}`}
          />
        </div>
        <PlayerStrip name="You" pieceSet={settings.pieceSet} captured={[]} active={!s.over && s.turn === drill.userColor} />
      </div>
      <div className="game-side" data-tab="moves">
        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>{drill.title}</b>
            <span>drill</span>
          </div>
          <div className="card" style={{ padding: 14 }}>
            <p style={{ margin: '0 0 8px', lineHeight: 1.55 }}>{drill.blurb}</p>
            <p style={{ margin: 0 }}>
              <b>Goal:</b> {drill.goalText}
            </p>
            {verdict === 'won' && (
              <p style={{ marginTop: 10, color: 'var(--accent)', fontWeight: 700 }}>Done. That is the technique.</p>
            )}
            {verdict === 'lost' && <p style={{ marginTop: 10, color: 'var(--danger-2)', fontWeight: 700 }}>Mated. Reset and try the pattern again.</p>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={onExit}>
              ← All drills
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PracticePage() {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const done = load<string[]>(DONE_KEY, [])
  const drill = DRILLS.find((d) => d.id === activeId) ?? null

  if (drill) {
    return (
      <div>
        <DrillRunner key={`${drill.id}-${round}`} drill={drill} onExit={() => setActiveId(null)} />
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button className="btn btn-sm" onClick={() => setRound((r) => r + 1)}>
            Reset drill
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-narrow">
      <h1 className="page-title">Practice</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        Key positions against the engine, each with one clear goal. {done.length}/{DRILLS.length} completed.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
        {DRILLS.map((d) => (
          <button key={d.id} className="action-card" onClick={() => setActiveId(d.id)}>
            <span>
              <span className="ac-title">
                {d.title} {done.includes(d.id) ? '✓' : ''}
              </span>
              <span className="ac-sub">{d.goalText}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        New to the rules? Start with <Link to="/lessons">lessons</Link>.
      </p>
    </div>
  )
}
