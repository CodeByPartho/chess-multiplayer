import { useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { PuzzleBoard } from '@/components/PuzzleBoard'
import { useToast } from '@/components/Toast'
import { Link, useRoute } from '@/router'
import { loadIdentity, saveIdentity } from '@/lib/identity'
import { updateRating200, PUZZLE_OPP_RD, clampRating } from '@/lib/chess/rating200'
import { submitPuzzleResult } from '@/net/ratingsClient'
import {
  PUZZLE_THEMES,
  dailyPuzzle,
  practiceSet,
  puzzlesByTheme,
  puzzleById,
  seededShuffle,
  sideToMove,
  type Puzzle,
} from '@/assets/puzzles'
import { dayKey, loadPuzzleStats, markDailyDone, recordPuzzleResult, type PuzzleStats } from '@/lib/puzzleStats'
import { copyText } from '@/lib/clipboard'
import { sounds } from '@/lib/sounds'

export default function PuzzlesPage({ puzzleId }: { puzzleId?: string }) {
  const [stats, setStats] = useState<PuzzleStats>(() => loadPuzzleStats())
  const [practice, setPractice] = useState<{ queue: Puzzle[]; idx: number; label: string } | null>(null)
  const { navigate } = useRoute()

  if (puzzleId) {
    const p = puzzleById(puzzleId)
    if (!p) {
      return (
        <div className="center-page">
          <p>Puzzle not found.</p>
          <Link to="/puzzles" className="btn btn-primary">
            Back to puzzles
          </Link>
        </div>
      )
    }
    return (
      <PuzzleSolve
        key={p.id}
        puzzle={p}
        modeLabel="Practice"
        stats={stats}
        onRecord={(next) => setStats(next)}
        onNext={null}
        onExit={() => navigate('/puzzles')}
      />
    )
  }

  if (practice) {
    const p = practice.queue[practice.idx]
    if (!p) {
      return (
        <div className="center-page">
          <h2>Set complete! 🎉</h2>
          <button className="btn btn-primary" onClick={() => setPractice(null)}>
            Back to puzzles
          </button>
        </div>
      )
    }
    return (
      <PuzzleSolve
        key={`${practice.label}-${p.id}`}
        puzzle={p}
        modeLabel={`${practice.label} · ${practice.idx + 1}/${practice.queue.length}`}
        stats={stats}
        onRecord={(next) => setStats(next)}
        onNext={() => setPractice({ ...practice, idx: practice.idx + 1 })}
        onExit={() => setPractice(null)}
      />
    )
  }

  const identity = loadIdentity()

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Puzzles</h2>
        <div style={{ display: 'flex', gap: 14, marginLeft: 'auto', fontSize: 13.5, color: 'var(--text-dim)', flexWrap: 'wrap' }}>
          <span>
            ✅ <b style={{ color: 'var(--text)' }}>{stats.solved}</b> solved
          </span>
          <span>
            🔥 streak <b style={{ color: 'var(--text)' }}>{stats.streak}</b> (best {stats.bestStreak})
          </span>
          <span>
            🏃 rush best <b style={{ color: 'var(--text)' }}>{stats.rushBest}</b>
          </span>
          <span>
            🧩 rating <b style={{ color: 'var(--text)' }}>{identity.ratings.puzzle.rating}</b>
          </span>
        </div>
      </div>

      <DailyCard stats={stats} />

      <div className="card">
        <h3 style={{ fontSize: 16, marginBottom: 4 }}>Practice by theme</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Mate-in-one motifs, verified move-by-move. Ten puzzles per set.
        </p>
        <div className="theme-grid">
          {PUZZLE_THEMES.map((t) => {
            const ts = stats.themeStats[t.id]
            return (
              <button
                key={t.id}
                className="theme-card"
                onClick={() => {
                  const q = seededShuffle(puzzlesByTheme(t.id), stats.attempts + puzzlesByTheme(t.id).length).slice(0, 10)
                  setPractice({ queue: q, idx: 0, label: t.name })
                }}
              >
                <span className="tc-icon">{t.icon}</span>
                <span className="ac-title">{t.name}</span>
                <span className="hint">{ts ? `${ts.solved}/${ts.attempts} solved` : `${puzzlesByTheme(t.id).length} puzzles`}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <button
          className="action-card"
          onClick={() => setPractice({ queue: practiceSet(identity.ratings.puzzle.rating, 10), idx: 0, label: 'Rated practice' })}
        >
          <span className="ac-icon">🎯</span>
          <span>
            <span className="ac-title">Rated practice</span>
            <span className="ac-sub">Puzzles around your {identity.ratings.puzzle.rating} rating</span>
          </span>
        </button>
        <button className="action-card" onClick={() => navigate('/puzzles/rush')}>
          <span className="ac-icon">🏃</span>
          <span>
            <span className="ac-title">Puzzle rush</span>
            <span className="ac-sub">5 minutes — how many can you solve?</span>
          </span>
        </button>
      </div>

      <div className="card">
        <div className="hint">
          All puzzles are original mate-in-one positions generated and re-verified with the chess rules engine. Solving
          rates you against the puzzle with Glicko-2 — same 200-scale system as every other pool. Signed-in players also
          sync it to their profile and leaderboard.
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function DailyCard({ stats }: { stats: PuzzleStats }) {
  const daily = useMemo(() => dailyPuzzle(), [])
  const done = stats.dailyDone[dayKey()]
  const { navigate } = useRoute()

  return (
    <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ fontSize: 34 }}>📅</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{daily.title}</div>
        <div className="hint">
          Today&apos;s daily puzzle · {sideToMove(daily.fen) === 'w' ? 'White' : 'Black'} to move · rated ~{daily.rating} ·{' '}
          {daily.id}
        </div>
      </div>
      {done ? (
        <span className="chip" style={{ color: 'var(--success)' }}>
          ✅ Completed today
        </span>
      ) : (
        <button className="btn btn-primary" onClick={() => navigate(`/puzzle/${daily.id}`)}>
          Solve today&apos;s puzzle
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/* unique per attempt: epoch-ms scaled + in-session sequence, so the server's
 * UNIQUE (user, puzzle, attempt_no) turns any replay into a no-op */
let attemptSeq = 0
function nextAttemptNo(): number {
  attemptSeq = (attemptSeq + 1) % 1000
  return Date.now() * 1000 + attemptSeq
}

function PuzzleSolve({
  puzzle,
  modeLabel,
  stats,
  onRecord,
  onNext,
  onExit,
}: {
  puzzle: Puzzle
  modeLabel: string
  stats: PuzzleStats
  onRecord: (s: PuzzleStats) => void
  onNext: (() => void) | null
  onExit: () => void
}) {
  const toast = useToast()
  const [wrongCount, setWrongCount] = useState(0)
  const [solvedSec, setSolvedSec] = useState<number | null>(null)
  const [showSolution, setShowSolution] = useState(false)
  const [ratingDelta, setRatingDelta] = useState(0)
  const [attemptKey, setAttemptKey] = useState(0)
  const [attemptNo, setAttemptNo] = useState(() => nextAttemptNo())
  const [isDaily] = useState(() => puzzle.id === dailyPuzzle().id)
  const lossRecorded = useRef(false)
  const mySide = sideToMove(puzzle.fen)

  const recordSolved = (seconds: number) => {
    setSolvedSec(seconds)
    const next = recordPuzzleResult(stats, puzzle.themes, true)
    applyPuzzleResult(true, Math.round(seconds * 1000))
    if (isDaily) markDailyDone(next, dayKey())
    onRecord(loadPuzzleStats())
  }

  /**
   * One Glicko-2 rating period against the puzzle's difficulty (a fixed-RD
   * ~opponent), on the same 200 scale as every other pool.
   *
   * The number moves instantly from this local preview so the UX feels live;
   * the server then computes the same update itself from (puzzle, solved,
   * time) alone and its answer replaces the preview. The browser never tells
   * the server what the rating should become.
   */
  const applyPuzzleResult = (solved: boolean, timeMs: number | null) => {
    const identity = loadIdentity()
    const before = identity.ratings.puzzle
    const after = updateRating200(before, [
      { oppRating: puzzle.rating, oppRd: PUZZLE_OPP_RD, score: solved ? 1 : 0, elapsedMs: Date.now() - before.updatedAt },
    ])
    identity.ratings.puzzle = after
    saveIdentity(identity)
    setRatingDelta(Math.round(after.rating - before.rating))
    void pushPuzzleRating(solved, timeMs, before.rating)
  }

  /** adopt server truth (rate limits, ignores and replays all arrive here) */
  const pushPuzzleRating = (solved: boolean, timeMs: number | null, previewBefore: number) => {
    void submitPuzzleResult({ puzzleId: puzzle.id, solved, timeMs, attemptNo }).then((res) => {
      if (res.offline || !res.ok) {
        if (res.error) toast.show(res.error, 'info')
        return
      }
      if (typeof res.rating !== 'number') return
      const id = loadIdentity()
      id.ratings.puzzle = clampRating({
        rating: res.rating,
        rd: res.rd ?? id.ratings.puzzle.rd,
        vol: id.ratings.puzzle.vol,
        updatedAt: Date.now(),
      })
      saveIdentity(id)
      setRatingDelta(Math.round(res.rating - previewBefore))
      if (res.ignored) toast.show('Solved faster than possible — recorded, but not rated', 'info')
    })
  }

  const giveUp = () => {
    if (solvedSec !== null || lossRecorded.current) return
    lossRecorded.current = true
    setShowSolution(true)
    recordPuzzleResult(stats, puzzle.themes, false)
    applyPuzzleResult(false, null)
    onRecord(loadPuzzleStats())
    sounds.play('end-draw')
  }

  const retry = () => {
    lossRecorded.current = false
    setWrongCount(0)
    setShowSolution(false)
    setSolvedSec(null)
    setRatingDelta(0)
    setAttemptNo(nextAttemptNo())
    setAttemptKey((k) => k + 1)
  }

  const solved = solvedSec !== null

  return (
    <div className="game-layout" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="game-main">
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 12 }}>
          <span className="chip">{modeLabel}</span>
          <b style={{ fontSize: 15.5 }}>{puzzle.title}</b>
          <span className="hint">
            {mySide === 'w' ? '⬜ White' : '⬛ Black'} to move · ~{puzzle.rating}
          </span>
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={onExit}>
            ← Exit
          </button>
        </div>

        <PuzzleBoard
          key={`${puzzle.id}-${attemptKey}`}
          puzzle={puzzle}
          onSolved={recordSolved}
          onWrong={() => setWrongCount((w) => w + 1)}
          showSolution={showSolution}
        />
      </div>

      <div className="game-side" data-tab="moves">
        {solved && (
          <div className="result-banner">
            <div className="rb-title">✅ Solved in {solvedSec.toFixed(1)}s</div>
            <div className="rb-sub">
              {wrongCount > 0 ? `${wrongCount} wrong attempt${wrongCount > 1 ? 's' : ''} · ` : 'First try! · '}
              puzzle rating {ratingDelta >= 0 ? `+${ratingDelta}` : ratingDelta}
            </div>
          </div>
        )}

        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>{modeLabel}</b>
            <span>~{puzzle.rating}</span>
          </div>

          <div className="game-controls">
            {!solved && !showSolution && (
              <button className="btn btn-sm" onClick={giveUp}>
                Show solution
              </button>
            )}
            {showSolution && !solved && (
              <span className="hint">
                Answer: <span className="mono">{solutionSan(puzzle)}</span> — press retry for a fresh board.
              </span>
            )}
            {solved && onNext && (
              <button className="btn btn-primary" onClick={onNext}>
                Next puzzle →
              </button>
            )}
            {solved && !onNext && (
              <button className="btn btn-primary" onClick={onExit}>
                Back to puzzles
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={retry}>
              ↻ Restart
            </button>
          </div>

          <p className="hint" style={{ marginTop: 10, lineHeight: 1.45 }}>
            Puzzle ratings are computed on the server from your result, but the solutions ship
            with the app — they can&apos;t be fully cheat-proof, so puzzles keep their own board
            and stay off the main leaderboards.
          </p>

          {!solved && wrongCount > 0 && (
            <div className="hint">Not the move — try again! ({wrongCount} wrong)</div>
          )}

          {isDaily && (
            <div className="card" style={{ padding: 12 }}>
              <div className="hint">
                This is the daily puzzle — everyone gets the same one today.{' '}
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => void copyText(`${location.origin}/puzzle/${puzzle.id}`).then((ok) => ok && toast.show('Link copied'))}
                >
                  Copy share link
                </button>
              </div>
            </div>
          )}
          <div className="card" style={{ padding: 12 }}>
            <div className="hint">
              Find the best move — here, a forced checkmate. Legal-move dots work as usual; wrong tries don&apos;t change the
              position.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function solutionSan(puzzle: Puzzle): string {
  try {
    const c = new Chess(puzzle.fen)
    const uci = puzzle.solution[0]
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined })
    return m?.san ?? uci
  } catch {
    return puzzle.solution[0]
  }
}
