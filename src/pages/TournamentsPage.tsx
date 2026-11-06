import { useCallback, useEffect, useState } from 'react'
import { Link } from '@/router'
import { useToast } from '@/components/Toast'
import { copyText } from '@/lib/clipboard'
import { useAuth } from '@/net/auth'
import { onlineEnabled } from '@/net/supabase'
import { createInvite } from '@/net/gameClient'
import {
  createTournament,
  fetchMyFinishedGames,
  fetchStandings,
  fetchTournaments,
  recordTournamentGame,
  type StandingRow,
  type Tournament,
} from '@/net/socialClient'
import type { TimeControl } from '@/lib/chess/types'

const TC_PRESETS: { label: string; tc: TimeControl }[] = [
  { label: '1 + 0 Bullet', tc: { type: 'bullet', base: 60_000, inc: 0, label: '1 + 0' } },
  { label: '3 + 2 Blitz', tc: { type: 'blitz', base: 180_000, inc: 2000, label: '3 + 2' } },
  { label: '5 + 0 Blitz', tc: { type: 'blitz', base: 300_000, inc: 0, label: '5 + 0' } },
  { label: '10 + 0 Rapid', tc: { type: 'rapid', base: 600_000, inc: 0, label: '10 + 0' } },
]

function phase(t: Tournament): 'live' | 'upcoming' | 'ended' {
  const now = Date.now()
  if (now < new Date(t.starts_at).getTime()) return 'upcoming'
  if (now > new Date(t.ends_at).getTime()) return 'ended'
  return 'live'
}

export default function TournamentsPage() {
  const toast = useToast()
  const auth = useAuth()
  const [list, setList] = useState<Tournament[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [standings, setStandings] = useState<StandingRow[]>([])
  const [name, setName] = useState('')
  const [hours, setHours] = useState(24)
  const [tcIdx, setTcIdx] = useState(2)
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setList(await fetchTournaments())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!openId) return
    void fetchStandings(openId).then(setStandings)
  }, [openId ])

  const signedIn = !!auth.user && !auth.isGuest && onlineEnabled
  const open = list.find((t) => t.id === openId) ?? null

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await createTournament(name.trim(), hours, TC_PRESETS[tcIdx].tc)
      setName('')
      toast.show('Arena created')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
  }

  const playGame = async (t: Tournament) => {
    setBusy(true)
    try {
      const created = await createInvite(t.tc, false, 'random')
      setLink(`${window.location.origin}/invite/${created.code}`)
    } catch {
      toast.error('Could not create the game')
    }
    setBusy(false)
  }

  const scoreMine = async (t: Tournament) => {
    setBusy(true)
    try {
      const games = await fetchMyFinishedGames(t.starts_at)
      let scored = 0
      let skipped = 0
      for (const g of games) {
        try {
          await recordTournamentGame(t.id, g.id)
          scored++
        } catch {
          skipped++
        }
      }
      toast.show(scored > 0 ? `Scored ${scored} game${scored === 1 ? '' : 's'}` : 'No new games to score', scored > 0 ? undefined : 'info')
      if (skipped > 0 && scored === 0) toast.show('Games must use the arena time control and finish inside its window', 'info')
      setStandings(await fetchStandings(t.id))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-narrow">
      <h1 className="page-title">Tournaments</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        Arena format: play as many games as you like inside the window. Win = 2 points, draw = 1, and a win while on
        a winning streak pays a bonus point. Points are scored from finished games, verified on the server.
      </p>

      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {list.map((t) => {
          const ph = phase(t)
          return (
            <div key={t.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 16 }}>{t.name}</b>
                <span className="hint">
                  {t.tc.label} · {ph === 'live' ? `ends ${new Date(t.ends_at).toLocaleString()}` : ph === 'upcoming' ? `starts ${new Date(t.starts_at).toLocaleString()}` : 'ended'}
                </span>
                {ph === 'live' && <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}>LIVE</span>}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                    {openId === t.id ? 'Hide standings' : 'Standings'}
                  </button>
                  {ph === 'live' && (
                    <button className="btn btn-sm btn-primary" disabled={busy || !signedIn} onClick={() => void playGame(t)}>
                      Play a game
                    </button>
                  )}
                </span>
              </div>
              {link && openId === t.id && (
                <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>
                  Share this link with your opponent: <code className="mono">{link}</code>{' '}
                  <button className="btn btn-sm" onClick={() => void copyText(link).then(() => toast.show('Link copied'))}>
                    Copy
                  </button>
                </p>
              )}
              {openId === t.id && (
                <div style={{ marginTop: 10 }}>
                  {standings.length === 0 && <p className="hint">No points yet. Finish a game at this time control, then score it.</p>}
                  {standings.map((r, i) => (
                    <div key={r.user_id} style={{ display: 'flex', gap: 10, fontSize: 14, padding: '3px 0' }}>
                      <span className="hint" style={{ width: 22 }}>
                        {i + 1}.
                      </span>
                      <Link to={`/@${r.username}`}>{r.username}</Link>
                      <span style={{ marginLeft: 'auto' }}>
                        <b>{Number(r.points)}</b> pts <span className="hint">({r.wins}W / {r.games} games)</span>
                      </span>
                    </div>
                  ))}
                  {signedIn && ph !== 'upcoming' && (
                    <button className="btn btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => open && void scoreMine(open)}>
                      Score my finished games
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {list.length === 0 && <p className="hint">No tournaments yet. Create the first one below.</p>}
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Create an arena</h3>
        {!signedIn && <p className="hint">Sign in to create a tournament.</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" placeholder="Arena name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: '1 1 180px' }} />
          <select className="input" value={tcIdx} onChange={(e) => setTcIdx(Number(e.target.value))} aria-label="Time control">
            {TC_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
          <select className="input" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Duration">
            <option value={6}>6 hours</option>
            <option value={24}>24 hours</option>
            <option value={72}>3 days</option>
          </select>
          <button className="btn btn-primary" disabled={!signedIn || busy || !name.trim()} onClick={() => void create()}>
            Create
          </button>
        </div>
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        More ways to compete: <Link to="/leagues">weekly leagues</Link> · <Link to="/simuls">simuls</Link> ·{' '}
        <Link to="/leaderboard">leaderboards</Link>
      </p>
    </div>
  )
}
