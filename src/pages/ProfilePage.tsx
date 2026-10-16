import { useEffect, useMemo, useState } from 'react'
import { Link, useRoute } from '@/router'
import { Avatar } from '@/components/Avatar'
import { RatingChart } from '@/components/RatingChart'
import {
  fetchProfileByName,
  fetchProfileRatings,
  fetchPlayerGames,
  type ArchivedGame,
  type ProfileRow,
} from '@/net/profileClient'
import { fetchRatingHistory, type RatingHistoryRow } from '@/net/ratingsClient'
import type { Category } from '@/lib/chess/categories'
import { CATEGORIES } from '@/lib/chess/categories'
import { onlineEnabled } from '@/net/supabase'

const ALL_CATS: (Category | 'puzzle')[] = [...CATEGORIES, 'puzzle']

type Load<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error' } | { state: 'empty' }

/**
 * Public profile at /@username — identity, per-category ratings with
 * record + peak, the rating curve, and the game archive (replayable).
 */
export default function ProfilePage() {
  const { path } = useRoute()
  const username = useMemo(() => decodeURIComponent(path.replace(/^\/@/, '')), [path])

  const [profile, setProfile] = useState<Load<ProfileRow>>({ state: 'loading' })
  const [ratings, setRatings] = useState<Awaited<ReturnType<typeof fetchProfileRatings>> | null>(null)
  const [games, setGames] = useState<ArchivedGame[] | null>(null)
  const [opponentNames, setOpponentNames] = useState<Record<string, string>>({})
  const [cat, setCat] = useState<Category | 'puzzle'>('classical')
  const [history, setHistory] = useState<RatingHistoryRow[] | null>(null)

  useEffect(() => {
    if (!username) {
      setProfile({ state: 'empty' })
      return
    }
    if (!onlineEnabled) {
      setProfile({ state: 'error' })
      return
    }
    let dead = false
    setProfile({ state: 'loading' })
    setRatings(null)
    setGames(null)
    setHistory(null)
    void fetchProfileByName(username).then((p) => {
      if (dead) return
      if (!p) {
        setProfile({ state: 'empty' })
        return
      }
      setProfile({ state: 'ready', data: p })
      void Promise.all([fetchProfileRatings(p.id), fetchPlayerGames(p.id, 20)]).then(([r, g]) => {
        if (dead) return
        setRatings(r)
        setGames(g)
        // default the chart to the category with the most games
        const best = (['classical', 'blitz', 'rapid', 'bullet', 'puzzle'] as const).find(
          (c) => (r.stats[c]?.games ?? 0) > 0,
        )
        if (best) setCat(best)
        // opponent display names (guests rows carry profile-synced names)
        const ids = new Set<string>()
        for (const g2 of g) {
          for (const id of [g2.white_id, g2.black_id]) if (id) ids.add(id)
        }
        if (ids.size && p) ids.delete(p.id)
        if (ids.size) {
          void import('@/net/supabase').then(({ supabase }) =>
            supabase
              .from('guests')
              .select('id, username')
              .in('id', [...ids])
              .then(({ data }) => {
                if (dead || !data) return
                const map: Record<string, string> = {}
                for (const row of data) map[row.id] = row.username
                setOpponentNames(map)
              }),
          )
        }
      })
    })
    return () => {
      dead = true
    }
  }, [username])

  useEffect(() => {
    const p = profile.state === 'ready' ? profile.data : null
    if (!p) return
    let dead = false
    setHistory(null)
    void fetchRatingHistory(p.id, cat, 150).then((h) => {
      if (!dead) setHistory(h)
    })
    return () => {
      dead = true
    }
  }, [profile, cat])

  if (profile.state === 'loading') {
    return (
      <div className="page narrow">
        <div className="card">
          <div className="skel skel-row" />
          <div className="skel" style={{ height: 96, marginTop: 12 }} />
        </div>
        <div className="card">
          <div className="skel" style={{ height: 170 }} />
        </div>
      </div>
    )
  }

  if (profile.state === 'empty') {
    return (
      <div className="center-page">
        <div style={{ fontSize: 42 }}>♙</div>
        <h1 style={{ margin: 0 }}>No such player</h1>
        <p style={{ color: 'var(--text-dim)' }}>
          <b>@{username}</b> hasn&apos;t claimed this username (usernames are unique — maybe they use
          a slightly different spelling).
        </p>
        <div className="auth-row" style={{ justifyContent: 'center' }}>
          <Link to="/leaderboard" className="btn btn-primary">
            Browse leaderboards
          </Link>
          <Link to="/" className="btn btn-ghost">
            Back home
          </Link>
        </div>
      </div>
    )
  }

  if (profile.state === 'error') {
    return (
      <div className="center-page">
        <div className="spinner" />
        <p style={{ color: 'var(--text-dim)' }}>Online play isn’t configured on this deployment.</p>
      </div>
    )
  }

  const p = profile.data
  const stat = (c: string) => ratings?.stats?.[c]
  const totalGames = ALL_CATS.reduce((n, c) => n + (stat(c)?.games ?? 0), 0)
  const points = (history ?? []).map((h) => ({ t: new Date(h.created_at).getTime(), rating: h.rating_after }))

  return (
    <div className="page narrow">
      <div className="card profile-head">
        <Avatar seed={p.avatar_seed} size={64} />
        <div className="profile-id">
          <h1 style={{ margin: 0 }}>
            {p.username}
            {p.flag && (
              <span className="profile-flag" title={p.flag}>
                {' '}
                {flagEmoji(p.flag)}
              </span>
            )}
          </h1>
          <p className="auth-note" style={{ margin: 0 }}>
            Member since {new Date(p.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} ·{' '}
            {totalGames} rated game{totalGames === 1 ? '' : 's'}
          </p>
        </div>
        <Link to="/play" className="btn btn-primary profile-play">
          Play rated
        </Link>
      </div>

      <div className="rating-grid" role="list">
        {ALL_CATS.map((c) => {
          const r = ratings?.[c]
          const s = stat(c)
          return (
            <button
              key={c}
              role="listitem"
              className={`rating-card ${cat === c ? 'active' : ''}`}
              onClick={() => setCat(c)}
              aria-pressed={cat === c}
            >
              <span className="rc-cat">{c}</span>
              <span className="rc-value">
                {ratings ? (r ? `${r.rating}${r.rd > 110 ? '?' : ''}` : '—') : <span className="skel" style={{ width: 52, height: 20, display: 'inline-block' }} />}
              </span>
              <span className="rc-meta">
                {s
                  ? `peak ${s.peak} · ${s.wins}W ${s.draws}D ${s.losses}L`
                  : 'no games yet'}
              </span>
            </button>
          )
        })}
      </div>

      <div className="card">
        <div className="card-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>{cat} rating</h2>
          <div className="cat-tabs" role="tablist" aria-label="Rating category">
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
        </div>
        {cat === 'puzzle' && (
          <p className="auth-note" style={{ margin: '0 0 8px' }}>
            Separate board — computed on the server, but puzzle solutions ship in the browser, so
            this rating isn&apos;t cheat-proof and stays off the main leaderboards.
          </p>
        )}
        {history === null ? (
          <div className="skel" style={{ height: 170 }} />
        ) : (
          <RatingChart points={points} label={`${p.username} ${cat} rating`} />
        )}
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Recent games</h2>
        {games === null ? (
          <>
            <div className="skel" style={{ height: 44, marginBottom: 8 }} />
            <div className="skel" style={{ height: 44 }} />
          </>
        ) : games.length === 0 ? (
          <p className="auth-note">No finished games yet — they’ll show up here with replays.</p>
        ) : (
          <ul className="game-list">
            {games.map((g) => {
              const mine = g.white_id === p.id ? 'w' : g.black_id === p.id ? 'b' : null
              const oppId = mine === 'w' ? g.black_id : g.white_id
              const opp = oppId ? (opponentNames[oppId] ?? 'Opponent') : 'Opponent'
              const out = outcomeOf(g, mine)
              return (
                <li key={g.id} className="game-row">
                  <span className={`wl-badge ${out.cls}`}>{out.letter}</span>
                  <span className="game-vs">
                    <b>{mine === 'w' ? p.username : opp}</b> vs <b>{mine === 'w' ? opp : p.username}</b>
                  </span>
                  <span className="game-meta">
                    {g.tc?.label ?? `${g.tc?.base / 1000}+${g.tc?.inc / 1000}`} · {g.rated ? 'rated' : 'casual'} ·{' '}
                    {out.score}
                  </span>
                  <span className="game-date">{new Date(g.created_at).toLocaleDateString()}</span>
                  <Link to={`/play/${g.id}`} className="btn btn-ghost btn-sm">
                    Replay
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function outcomeOf(g: ArchivedGame, myColor: 'w' | 'b' | null): { cls: string; letter: string; score: string } {
  if (g.status === 'aborted' || !g.result) return { cls: 'draw', letter: '–', score: 'aborted' }
  if (g.result.winner === null) return { cls: 'draw', letter: 'D', score: '½-½' }
  if (myColor && g.result.winner === myColor) return { cls: 'win', letter: 'W', score: '1-0' }
  if (myColor) return { cls: 'loss', letter: 'L', score: '0-1' }
  return { cls: g.result.winner === 'w' ? 'win' : 'loss', letter: g.result.winner === 'w' ? 'W' : 'L', score: g.result.winner === 'w' ? '1-0' : '0-1' }
}

function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...code.split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
