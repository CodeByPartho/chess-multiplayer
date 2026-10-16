import { useEffect, useState } from 'react'
import { Link } from '@/router'
import { Avatar } from '@/components/Avatar'
import { fetchLeaderboard, type LeaderboardRow } from '@/net/profileClient'
import { CATEGORIES, type Category } from '@/lib/chess/categories'
import { useAuth } from '@/net/auth'
import { onlineEnabled } from '@/net/supabase'

const ALL_CATS: (Category | 'puzzle')[] = [...CATEGORIES, 'puzzle']

/** top 100 per category — registered, non-provisional accounts only */
export default function LeaderboardPage() {
  const auth = useAuth()
  const [cat, setCat] = useState<Category | 'puzzle'>('blitz')
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!onlineEnabled) {
      setError(true)
      return
    }
    let dead = false
    setRows(null)
    setError(false)
    void fetchLeaderboard(cat, 100, 0).then((r) => {
      if (dead) return
      setRows(r)
      // an empty array from a failed RPC would also be [] — distinguish once
      if (r.length === 0) {
        // could be legitimately empty; error state only when nothing loads
        setRows(r)
      }
    })
    return () => {
      dead = true
    }
  }, [cat, auth.user?.id])

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1 style={{ margin: 0 }}>Leaderboards</h1>
        <p className="auth-note" style={{ margin: 0 }}>
          {cat === 'puzzle'
            ? 'Puzzles have their own board · server-checked, but solutions ship in the browser — not cheat-proof, not part of the main leaderboards'
            : 'Top 100 per category · ranked accounts only (guests and provisional ratings are excluded)'}
        </p>
      </div>

      <div className="cat-tabs big" role="tablist" aria-label="Leaderboard category">
        {ALL_CATS.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={cat === c}
            className={cat === c ? 'active' : ''}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="card">
        {rows === null ? (
          <>
            <div className="skel" style={{ height: 42, marginBottom: 8 }} />
            <div className="skel" style={{ height: 42, marginBottom: 8 }} />
            <div className="skel" style={{ height: 42 }} />
          </>
        ) : error ? (
          <div className="empty-state">
            <div style={{ fontSize: 34 }}>📡</div>
            <p>Couldn’t load the leaderboard — online play may not be configured.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 34 }}>🏆</div>
            <p>
              No ranked {cat} players yet.{' '}
              {auth.isGuest || !auth.user ? (
                <>
                  Create an account and win some rated games to claim the first spot —{' '}
                  <Link to="/play">start playing</Link>.
                </>
              ) : (
                <>
                  Win rated {cat} games to appear here — <Link to="/play">play now</Link>.
                </>
              )}
            </p>
          </div>
        ) : (
          <ol className="lb-list">
            {rows.map((r, i) => (
              <li key={r.user_id} className={`lb-row ${i < 3 ? 'top' : ''}`}>
                <span className="lb-rank" aria-label={`Rank ${i + 1}`}>
                  {i + 1}
                </span>
                <Avatar seed={r.avatar_seed} size={32} />
                <Link to={`/@${r.username}`} className="lb-name">
                  {r.username}
                  {r.flag && <span className="lb-flag">{flagEmoji(r.flag)}</span>}
                </Link>
                <span className="lb-record">
                  {r.wins}W {r.draws ?? 0}D {r.losses}L
                </span>
                <span className="lb-games" title="Rated games">
                  {r.games} games
                </span>
                <span className="lb-rating">
                  {r.rating}
                  {r.is_provisional ? '?' : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {!auth.isGuest && auth.user && (
        <p className="auth-note">
          Climb the board with rated games — <Link to="/play">open the lobby</Link>.
        </p>
      )}
    </div>
  )
}

function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...code.split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
