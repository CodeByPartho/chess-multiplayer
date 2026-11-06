import { useMemo } from 'react'
import { Link } from '@/router'
import { loadHistory } from '@/lib/history'
import { loadPuzzleStats } from '@/lib/puzzleStats'
import { loadIdentity } from '@/lib/identity'
import { load } from '@/lib/storage'
import { buildInsights, ACHIEVEMENTS, type AchievementCtx } from '@/lib/stats'
import { LESSONS } from './LessonsPage'
import { DRILLS } from './PracticePage'

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="hint">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800 }}>{value}</div>
      {sub && <div className="hint">{sub}</div>}
    </div>
  )
}

function WinBar({ label, pct, games }: { label: string; pct: number; games: number }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 4 }}>
        <span>{label}</span>
        <span className="hint">
          {pct}% of {games} games
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-2, #2a2b29)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
    </div>
  )
}

export default function InsightsPage() {
  const data = useMemo(() => {
    const records = loadHistory()
    const puzzles = loadPuzzleStats()
    const insights = buildInsights(records, puzzles)
    const modeBests = load<Record<string, number>>('fc.puzzleModeBests', {})
    const ctx: AchievementCtx = {
      insights,
      puzzlesSolved: puzzles.solved,
      puzzleBestStreak: puzzles.bestStreak,
      rushBest: puzzles.rushBest,
      dailyDoneCount: Object.keys(puzzles.dailyDone).length,
      lessonsDone: load<string[]>('fc.lessonsDone', []).length,
      lessonsTotal: LESSONS.length,
      drillsDone: load<string[]>('fc.drillsDone', []).length,
      drillsTotal: DRILLS.length,
      coordBest: load<number>('fc.coordBest', 0),
      stormBest: modeBests.storm ?? 0,
      streakBest: modeBests.streak ?? 0,
    }
    return { insights, puzzles, ctx }
  }, [])

  const { insights, puzzles, ctx } = data
  const identity = loadIdentity()
  const unlockedCount = ACHIEVEMENTS.filter((a) => a.unlocked(ctx)).length

  return (
    <div className="page-narrow" style={{ maxWidth: 860 }}>
      <h1 className="page-title">Your insights</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        From the games and puzzles stored on this device. Review more games to grow the accuracy and opening numbers.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <StatCard label="Games" value={String(insights.total)} sub={`${insights.wins}W · ${insights.draws}D · ${insights.losses}L`} />
        <StatCard label="Win rate" value={`${insights.winPct}%`} />
        <StatCard label="Puzzles solved" value={String(puzzles.solved)} sub={`best streak ${puzzles.bestStreak}`} />
        <StatCard label="Avg accuracy" value={insights.avgAccuracy === null ? '—' : `${insights.avgAccuracy}%`} sub={insights.avgAccuracy === null ? 'review a game to start' : `over ${insights.reviewed} reviewed games`} />
        <StatCard label="Achievements" value={`${unlockedCount}/${ACHIEVEMENTS.length}`} />
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Win rate by color</h3>
        <WinBar label="As White" pct={insights.asWhite.winPct} games={insights.asWhite.games} />
        <WinBar label="As Black" pct={insights.asBlack.winPct} games={insights.asBlack.games} />
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Your openings</h3>
        {insights.topOpenings.length === 0 && <p className="hint" style={{ margin: 0 }}>No recognized openings yet. Play a few games from the standard start.</p>}
        {insights.topOpenings.map((o) => (
          <div key={o.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '4px 0' }}>
            <span>
              {o.name} <span className="hint">{o.eco}</span>
            </span>
            <span className="hint">
              {o.games} games · {o.winPct}% won
            </span>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Ratings on this device</h3>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {Object.entries(identity.ratings).map(([pool, r]) => (
            <span key={pool} style={{ fontSize: 14 }}>
              <span className="hint" style={{ textTransform: 'capitalize' }}>{pool} </span>
              <b>{r.rating}</b>
            </span>
          ))}
        </div>
      </div>

      <h2 style={{ fontSize: 18, margin: '18px 0 10px' }}>Achievements</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {ACHIEVEMENTS.map((a) => {
          const un = a.unlocked(ctx)
          return (
            <div
              key={a.id}
              className="card"
              style={{ padding: 12, opacity: un ? 1 : 0.62, borderColor: un ? 'var(--accent)' : undefined }}
            >
              <div style={{ fontSize: 24, lineHeight: 1 }}>{a.glyph}</div>
              <div style={{ fontWeight: 700, marginTop: 6 }}>{a.name}</div>
              <div className="hint">{a.desc}</div>
              <div className="hint" style={{ marginTop: 4, color: un ? 'var(--accent)' : undefined }}>
                {un ? 'Unlocked' : a.progress(ctx)}
              </div>
            </div>
          )
        })}
      </div>

      <p className="hint" style={{ marginTop: 16 }}>
        Keep going: <Link to="/lessons">lessons</Link> · <Link to="/practice">practice drills</Link> ·{' '}
        <Link to="/puzzles">puzzles</Link>
      </p>
    </div>
  )
}
