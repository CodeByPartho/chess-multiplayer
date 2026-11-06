import { useCallback, useEffect, useRef, useState } from 'react'
import { PuzzleBoard } from '@/components/PuzzleBoard'
import { Link } from '@/router'
import { puzzles, rushOrder, type Puzzle } from '@/assets/puzzles'
import { load, save } from '@/lib/storage'

export type PuzzleMode = 'storm' | 'streak' | 'battle'

const BESTS_KEY = 'fc.puzzleModeBests'

function loadBest(mode: PuzzleMode): number {
  return load<Record<string, number>>(BESTS_KEY, {})[mode] ?? 0
}
function recordBest(mode: PuzzleMode, score: number): void {
  const all = load<Record<string, number>>(BESTS_KEY, {})
  if (score > (all[mode] ?? 0)) save(BESTS_KEY, { ...all, [mode]: score })
}

const META: Record<PuzzleMode, { title: string; sub: string; how: string }> = {
  storm: {
    title: 'Puzzle Storm',
    sub: 'Two minutes on the clock. Every solve adds 3 seconds. Three wrong moves end the storm early.',
    how: 'Solve as many mates as you can before the clock dies. Wrong moves cost a strike; three strikes end the run.',
  },
  streak: {
    title: 'Puzzle Streak',
    sub: 'One endless run, puzzles climb in difficulty. A single wrong move ends it.',
    how: 'No clock, no second chances. How long can your streak get as the puzzles get harder?',
  },
  battle: {
    title: 'Puzzle Battle',
    sub: 'Three minutes against a computer racer. Solve more than it does; three strikes ends a side.',
    how: 'You and the racer solve side by side. It solves at a steady pace and sometimes slips. Outscore it before the clock ends.',
  },
}

function queueFor(mode: PuzzleMode): Puzzle[] {
  if (mode === 'streak') {
    const sorted = [...puzzles].sort((a, b) => a.rating - b.rating)
    return [...sorted, ...sorted.slice().reverse()]
  }
  return rushOrder(new Date(), 120)
}

export default function PuzzleModesPage({ mode }: { mode: PuzzleMode }) {
  const meta = META[mode]
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [queue, setQueue] = useState<Puzzle[]>([])
  const [idx, setIdx] = useState(0)
  const [score, setScore] = useState(0)
  const [strikes, setStrikes] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [showSolution, setShowSolution] = useState(false)
  const [botScore, setBotScore] = useState(0)
  const [botStrikes, setBotStrikes] = useState(0)
  const [botOut, setBotOut] = useState(false)
  const endAtRef = useRef(0)
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const botTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const best = loadBest(mode)
  const puzzle = queue[idx] ?? null

  const finish = useCallback(() => {
    setPhase((p) => {
      if (p === 'running') recordBest(mode, score)
      return 'done'
    })
    if (botTimer.current) clearInterval(botTimer.current)
  }, [mode, score])

  // main countdown (storm + battle)
  useEffect(() => {
    if (phase !== 'running' || mode === 'streak') return
    const id = setInterval(() => {
      const left = Math.max(0, (endAtRef.current - Date.now()) / 1000)
      setTimeLeft(left)
      if (left <= 0) {
        clearInterval(id)
        finish()
      }
    }, 100)
    return () => clearInterval(id)
  }, [phase, mode, finish])

  // battle racer
  useEffect(() => {
    if (phase !== 'running' || mode !== 'battle' || botOut) return
    const tick = () => {
      if (Math.random() < 0.12) {
        setBotStrikes((s) => {
          if (s + 1 >= 3) setBotOut(true)
          return s + 1
        })
      } else {
        setBotScore((s) => s + 1)
      }
    }
    botTimer.current = setInterval(tick, 5200 + Math.random() * 4200)
    return () => {
      if (botTimer.current) clearInterval(botTimer.current)
    }
  }, [phase, mode, botOut])

  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    if (botTimer.current) clearInterval(botTimer.current)
  }, [])

  const start = () => {
    setQueue(queueFor(mode))
    setIdx(0)
    setScore(0)
    setStrikes(0)
    setBotScore(0)
    setBotStrikes(0)
    setBotOut(false)
    setShowSolution(false)
    const secs = mode === 'storm' ? 120 : mode === 'battle' ? 180 : 0
    setTimeLeft(secs)
    endAtRef.current = Date.now() + secs * 1000
    setPhase('running')
  }

  const advance = useCallback(() => {
    setShowSolution(false)
    setIdx((i) => i + 1)
  }, [])

  const onSolved = useCallback(() => {
    setScore((s) => s + 1)
    if (mode === 'storm') endAtRef.current += 3000
    advanceTimer.current = setTimeout(advance, 450)
  }, [advance, mode])

  const onWrong = useCallback(() => {
    if (mode === 'streak') {
      finish()
      return
    }
    setStrikes((s) => {
      const next = s + 1
      if (next >= 3) {
        advanceTimer.current = setTimeout(finish, 600)
      } else {
        setShowSolution(true)
        advanceTimer.current = setTimeout(advance, 1100)
      }
      return next
    })
  }, [advance, finish, mode])

  const mm = Math.floor(timeLeft / 60)
  const ss = Math.floor(timeLeft % 60)

  if (phase === 'idle') {
    return (
      <div className="center-page" style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 6px' }}>{meta.title}</h1>
        <p style={{ color: 'var(--text-dim)', margin: '0 0 8px' }}>{meta.sub}</p>
        <p className="hint">Best so far: {best}</p>
        <button className="btn btn-primary btn-lg" onClick={start}>
          Start
        </button>
        <div style={{ marginTop: 12 }}>
          <Link to="/puzzles" className="btn btn-ghost btn-sm">
            ← Back to puzzles
          </Link>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    const verdict =
      mode !== 'battle' ? null : score > botScore ? 'You win the battle.' : score < botScore ? 'The racer takes this one.' : 'Dead heat.'
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="result-banner" style={{ marginBottom: 12 }}>
          <div className="rb-title">
            {meta.title} over: {score} solved
          </div>
          <div className="rb-sub">
            {mode === 'battle' && <>Racer solved {botScore}. {verdict} </>}
            Best {Math.max(best, score)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={start}>
            Play again
          </button>
          <Link to="/puzzles" className="btn">
            Back to puzzles
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="game-layout" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="game-main">
        <div className="card rush-bar" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 12 }}>
          {mode !== 'streak' && (
            <span style={{ fontSize: 22, fontFamily: 'var(--mono)', fontWeight: 800, color: timeLeft < 20 ? 'var(--danger-2)' : 'var(--text)' }}>
              {mm}:{String(ss).padStart(2, '0')}
            </span>
          )}
          <span>
            Solved <b style={{ fontSize: 18 }}>{score}</b>
          </span>
          {mode !== 'streak' && <span className="hint">strikes {strikes}/3</span>}
          {mode === 'battle' && (
            <span className="hint">
              racer {botScore} · strikes {botStrikes}/3{botOut ? ' (out)' : ''}
            </span>
          )}
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={finish}>
            End
          </button>
        </div>

        {puzzle && (
          <PuzzleBoard key={`${puzzle.id}-${idx}`} puzzle={puzzle} onSolved={onSolved} onWrong={onWrong} showSolution={showSolution} />
        )}
      </div>

      <div className="game-side" data-tab="moves">
        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>{meta.title}</b>
            <span>best {best}</span>
          </div>
          <div className="card" style={{ padding: 12 }}>
            <div className="hint">{meta.how}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
