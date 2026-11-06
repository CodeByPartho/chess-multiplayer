import { useEffect, useState } from 'react'
import { Link } from '@/router'
import { myUserId, onlineEnabled } from '@/net/supabase'
import { fetchLeague, leagueTier, LEAGUE_TIERS, type LeagueRow } from '@/net/socialClient'

export default function LeaguesPage() {
  const [rows, setRows] = useState<LeagueRow[]>([])
  const [myId, setMyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let dead = false
    void (async () => {
      const [league, uid] = await Promise.all([fetchLeague(), myUserId()])
      if (dead) return
      setRows(league)
      setMyId(uid)
      setLoading(false)
    })()
    return () => {
      dead = true
    }
  }, [])

  const mine = rows.find((r) => r.user_id === myId) ?? null
  const myWins = mine?.wins ?? 0
  const tier = leagueTier(myWins)

  return (
    <div className="page-narrow">
      <h1 className="page-title">Leagues</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        Win games this week to climb from Wood to Legends. The table counts every finished game from the last seven
        days, and the ladder resets on a rolling basis.
      </p>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Your climb</h3>
        {!onlineEnabled && <p className="hint">Online play is not configured on this build.</p>}
        {onlineEnabled && (
          <>
            <p style={{ margin: '0 0 10px', fontSize: 14 }}>
              You are in the <b>{tier.name} League</b> with {myWins} win{myWins === 1 ? '' : 's'} this week.
              {tier.next && (
                <>
                  {' '}
                  {tier.next.min - myWins} more win{tier.next.min - myWins === 1 ? '' : 's'} reaches {tier.next.name}.
                </>
              )}
              {!mine && ' Play a game to enter the table.'}
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {LEAGUE_TIERS.map((t) => (
                <span
                  key={t.name}
                  className="side-chip"
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: 13,
                    background: t.name === tier.name ? 'var(--accent)' : undefined,
                    color: t.name === tier.name ? '#141414' : undefined,
                    fontWeight: t.name === tier.name ? 700 : 400,
                    opacity: myWins >= t.min ? 1 : 0.55,
                  }}
                >
                  {t.name}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>This week</h3>
        {loading && <p className="hint">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="hint">
            Nobody has finished a game this week yet. <Link to="/play">Be the first</Link>.
          </p>
        )}
        {rows.map((r, i) => (
          <div
            key={r.user_id}
            style={{ display: 'flex', gap: 10, fontSize: 14, padding: '4px 0', fontWeight: r.user_id === myId ? 700 : 400 }}
          >
            <span className="hint" style={{ width: 24 }}>
              {i + 1}.
            </span>
            <Link to={`/@${r.username}`}>{r.username}</Link>
            <span className="hint">{leagueTier(r.wins).name}</span>
            <span style={{ marginLeft: 'auto' }}>
              {r.wins} wins <span className="hint">/ {r.games} games</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
