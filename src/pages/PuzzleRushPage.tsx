import { useCallback, useEffect, useRef, useState } from 'react'
import { PuzzleBoard } from '@/components/PuzzleBoard'
import { Link } from '@/router'
import { rushOrder, type Puzzle } from '@/assets/puzzles'
import { loadPuzzleStats, recordRushBest } from '@/lib/puzzleStats'

const RUSH_SECONDS = 300

export default function PuzzleRushPage() {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [queue] = useState<Puzzle[]>(() => rushOrder())
  const [idx, setIdx] = useState(0)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [timeLeft, setTimeLeft] = useState(RUSH_SECONDS)
  const [showSolution, setShowSolution] = useState(false)
  const [wrongFlash, setWrongFlash] = useState(false)
  const endAtRef = useRef(0)
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const best = loadPuzzleStats().rushBest

  const finish = useCallback(() => {
    setPhase('done')
    recordRushBest(score)
  }, [score])

  // countdown
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

  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current) }, [])

  const start = () => {
    endAtRef.current = Date.now() + RUSH_SECONDS * 1000
    setIdx(0)
    setScore(0)
    setStreak(0)
    setBestStreak(0)
    setTimeLeft(RUSH_SECONDS)
    setShowSolution(false)
    setPhase('running')
  }

  const advance = (ok: boolean) => {
    setShowSolution(false)
    setWrongFlash(false)
    setIdx((i) => i + 1)
    void ok
  }

  const onSolved = () => {
    setScore((s) => s + 1)
    setStreak((s) => {
      const n = s + 1
      setBestStreak((b) => Math.max(b, n))
      return n
    })
    advanceTimer.current = setTimeout(() => advance(true), 380)
  }

  const onWrong = () => {
    setStreak(0)
    setWrongFlash(true)
    setShowSolution(true)
    advanceTimer.current = setTimeout(() => advance(false), 1400)
  }

  const puzzle = queue[Math.min(idx, queue.length - 1)]
  const mm = Math.floor(timeLeft / 60)
  const ss = Math.floor(timeLeft % 60)

  if (phase === 'idle') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="card">
          <h2>🏃 Puzzle rush</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 14.5 }}>
            Five minutes on the clock. Solve as many mate-in-ones as you can — easiest first, getting harder as you go. A
            wrong move costs you the puzzle (the answer is shown, then the next one starts). Your best score is saved on
            this device.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <span className="chip">⏱ 5:00</span>
            <span className="chip">📈 {queue.length} puzzles queued</span>
            <span className="chip">🏅 best: {best}</span>
          </div>
          <button className="btn btn-primary btn-lg btn-block" onClick={start}>
            Start rush
          </button>
          <div style={{ marginTop: 10 }}>
            <Link to="/puzzles" className="btn btn-ghost btn-sm">
              ← Back to puzzles
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="result-banner" style={{ marginBottom: 12 }}>
          <div className="rb-title">Rush over — {score} solved</div>
          <div className="rb-sub">
            Best streak {bestStreak} · best score {Math.max(best, score)}
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
          <span style={{ fontSize: 22, fontFamily: 'var(--mono)', fontWeight: 800, color: timeLeft < 30 ? 'var(--danger-2)' : 'var(--text)' }}>
            {mm}:{String(ss).padStart(2, '0')}
          </span>
          <span>
            Solved <b style={{ fontSize: 18 }}>{score}</b>
          </span>
          <span className="hint">streak {streak}</span>
          <span className="hint" style={{ marginLeft: 'auto' }}>
            {idx + 1}/{queue.length}
          </span>
          <button className="btn btn-sm btn-ghost" onClick={finish}>
            End
          </button>
        </div>

        {puzzle && (
          <PuzzleBoard
            key={puzzle.id}
            puzzle={puzzle}
            onSolved={onSolved}
            onWrong={onWrong}
            showSolution={showSolution}
            className={wrongFlash ? 'shake' : ''}
          />
        )}

        {showSolution && puzzle && (
          <p className="hint" style={{ textAlign: 'center' }}>
            The mate was <span className="mono">{puzzle.solution[0]}</span> — next puzzle coming up…
          </p>
        )}
      </div>

      <div className="game-side">
        <div className="card" style={{ padding: 12 }}>
          <div className="hint">
            Every second counts. Play the mating move; wrong answers auto-advance after showing the solution. Rush puzzles
            don&apos;t change your puzzle rating.
          </div>
        </div>
      </div>
    </div>
  )
}
