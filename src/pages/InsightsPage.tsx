import { useMemo, useState } from 'react'
import { Link } from '@/router'
import { loadHistory, resultForMe, type GameRecord } from '@/lib/history'
import { loadPuzzleStats } from '@/lib/puzzleStats'
import { loadIdentity } from '@/lib/identity'
import { load } from '@/lib/storage'
import { buildInsights, buildMastery, ACHIEVEMENTS, type AchievementCtx, type MasteryEntry } from '@/lib/stats'
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
    const mastery = buildMastery(records)
    const byId = new Map(records.map((r) => [r.id, r]))
    return { insights, puzzles, ctx, mastery, byId }
  }, [])

  const { insights, puzzles, ctx, mastery, byId } = data
  const [openLine, setOpenLine] = useState<string | null>(null)
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
        <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Opening mastery</h3>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          The lines you keep returning to are your repertoire. Levels grow with games played and
          results held: Rookie, Student, Specialist, Expert, Master.{' '}
          <Link to="/masters">See how the masters play their lines</Link>
        </p>
        {mastery.length === 0 && <p className="hint" style={{ margin: 0 }}>No recognized lines yet. Your first mastered route starts with your first games.</p>}
        {mastery.map((m) => (
          <MasteryRow
            key={m.name}
            entry={m}
            byId={byId}
            open={openLine === m.name}
            onToggle={() => setOpenLine(openLine === m.name ? null : m.name)}
          />
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
        <Link to="/studies">studies</Link> · <Link to="/puzzles">puzzles</Link> ·{' '}
        <Link to="/masters">the masters</Link>
      </p>
    </div>
  )
}

function MasteryRow({
  entry,
  byId,
  open,
  onToggle,
}: {
  entry: MasteryEntry
  byId: Map<string, GameRecord>
  open: boolean
  onToggle: () => void
}) {
  const games = entry.gameIds.map((id) => byId.get(id)).filter((g): g is GameRecord => !!g)
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, textAlign: 'left' }}
      >
        <span style={{ fontSize: 14 }}>
          {entry.name} <span className="hint">{entry.eco}</span>{' '}
          <span className="chip" style={{ marginLeft: 4 }}>{entry.level}</span>
        </span>
        <span className="hint" style={{ whiteSpace: 'nowrap' }}>
          {entry.games} games · {entry.wins}W {entry.draws}D {entry.losses}L · {entry.winPct}% won {open ? '▾' : '▸'}
        </span>
      </button>
      <div className="hint" style={{ marginTop: 2 }}>
        {entry.nextAt
          ? `${Math.max(0, entry.nextAt - entry.games)} more games in this line to the next level, results permitting.`
          : 'Top level. This line is yours.'}
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {games.length === 0 && <span className="hint">Those games are no longer stored on this device.</span>}
          {games.map((g) => {
            const opp = g.myColor === 'w' ? g.black : g.white
            const me = resultForMe(g)
            return (
              <Link key={g.id} to={`/review/${g.id}`} className="chip" style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>
                  {me === 'win' ? 'Won' : me === 'loss' ? 'Lost' : 'Drew'} vs {opp.name}
                </span>
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                  {g.tc?.label ?? 'Untimed'} · {new Date(g.date).toLocaleDateString()}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
