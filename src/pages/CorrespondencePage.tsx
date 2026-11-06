import { useCallback, useEffect, useState } from 'react'
import { Link, useRoute } from '@/router'
import { useToast } from '@/components/Toast'
import { copyText } from '@/lib/clipboard'
import { onlineEnabled } from '@/net/supabase'
import { createInvite, fetchMyGames, fetchPlayers, subscribeGame, type ServerGame } from '@/net/gameClient'
import { myUserId } from '@/net/supabase'
import type { Color } from '@/lib/chess/types'

interface Row {
  game: ServerGame
  opponent: string
  myColor: Color
  yourMove: boolean
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/**
 * Correspondence hub: untimed games with no clock at all. Start one by
 * invite link, play a move whenever you come back; this page is the
 * list of everything waiting on you.
 */
export default function CorrespondencePage() {
  const { navigate } = useRoute()
  const toast = useToast()
  const [rows, setRows] = useState<Row[]>([])
  const [waiting, setWaiting] = useState<ServerGame[]>([])
  const [loading, setLoading] = useState(true)
  const [playAs, setPlayAs] = useState<Color | 'random'>('random')
  const [invite, setInvite] = useState<{ gameId: string; code: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!onlineEnabled) {
      setLoading(false)
      return
    }
    try {
      const uid = await myUserId()
      const games = await fetchMyGames()
      const waits = games.filter((g) => g.status === 'waiting')
      const actives = games.filter((g) => g.status === 'active')
      const built: Row[] = []
      for (const g of actives) {
        const myColor: Color = g.white_id === uid ? 'w' : 'b'
        let opponent = 'Opponent'
        try {
          const players = await fetchPlayers(g)
          opponent = (myColor === 'w' ? players.black?.username : players.white?.username) ?? 'Opponent'
        } catch {
          /* name lookup is decoration */
        }
        built.push({ game: g, opponent, myColor, yourMove: g.turn === myColor })
      }
      built.sort((a, b) => Number(b.yourMove) - Number(a.yourMove))
      setWaiting(waits)
      setRows(built)
    } catch {
      /* list is best effort */
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 60_000)
    return () => clearInterval(id)
  }, [load])

  // follow a fresh invite until the opponent lands
  useEffect(() => {
    if (!invite) return
    const unsub = subscribeGame(invite.gameId, (g) => {
      if (g.status === 'active') {
        toast.show('Your opponent joined')
        navigate(`/play/${g.id}`)
      }
    })
    return unsub
  }, [invite, navigate, toast])

  const start = async () => {
    setBusy(true)
    try {
      const created = await createInvite(null, false, playAs)
      setInvite({ gameId: created.gameId, code: created.code })
    } catch {
      toast.error('Could not create the game. Try again.')
    }
    setBusy(false)
  }

  if (!onlineEnabled) {
    return (
      <div className="page-narrow">
        <h1 className="page-title">Correspondence</h1>
        <p className="hint">Online play is not configured on this build.</p>
      </div>
    )
  }

  const yourMoveCount = rows.filter((r) => r.yourMove).length

  return (
    <div className="page-narrow">
      <h1 className="page-title">Correspondence</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        No clock, ever. Start a game by link, make a move when you visit, take a day or a week over the next one.
        {yourMoveCount > 0 && (
          <>
            {' '}
            <b style={{ color: 'var(--accent)' }}>
              {yourMoveCount} game{yourMoveCount === 1 ? ' is' : 's are'} waiting on your move.
            </b>
          </>
        )}
      </p>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>New correspondence game</h3>
        {!invite ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="hint">Play as</span>
            {(['w', 'random', 'b'] as const).map((c) => (
              <button key={c} className={`btn btn-sm ${playAs === c ? 'btn-primary' : ''}`} onClick={() => setPlayAs(c)}>
                {c === 'w' ? 'White' : c === 'b' ? 'Black' : 'Random'}
              </button>
            ))}
            <button className="btn btn-primary" disabled={busy} onClick={() => void start()}>
              {busy ? 'Creating…' : 'Create invite link'}
            </button>
          </div>
        ) : (
          <div>
            <p style={{ margin: '0 0 8px', fontSize: 14 }}>
              Send this link to your opponent. The game starts when they open it, and this page will take you in.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <code className="mono" style={{ fontSize: 14, alignSelf: 'center' }}>
                {window.location.origin}/invite/{invite.code}
              </code>
              <button
                className="btn btn-sm"
                onClick={() => void copyText(`${window.location.origin}/invite/${invite.code}`).then(() => toast.show('Link copied'))}
              >
                Copy link
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setInvite(null)}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {waiting.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Waiting for an opponent</h3>
          {waiting.map((g) => (
            <div key={g.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', flexWrap: 'wrap' }}>
              <code className="mono">{g.invite_code}</code>
              <span className="hint">{g.tc ? g.tc.label : 'Correspondence'} · created {ago(g.created_at)}</span>
              {g.invite_code && (
                <button
                  className="btn btn-sm"
                  onClick={() => void copyText(`${window.location.origin}/invite/${g.invite_code}`).then(() => toast.show('Link copied'))}
                >
                  Copy link
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 17, margin: '16px 0 10px' }}>Your games in progress</h2>
      {loading && <p className="hint">Loading…</p>}
      {!loading && rows.length === 0 && <p className="hint">Nothing in progress. Create a game above, or join one from an invite link.</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map(({ game, opponent, myColor, yourMove }) => (
          <button key={game.id} className="action-card" onClick={() => navigate(`/play/${game.id}`)}>
            <span>
              <span className="ac-title">
                vs {opponent} {yourMove && <span style={{ color: 'var(--accent)' }}>· your move</span>}
              </span>
              <span className="ac-sub">
                {game.tc ? game.tc.label : 'Correspondence'} · you play {myColor === 'w' ? 'White' : 'Black'} · move{' '}
                {Math.floor(game.moves.length / 2) + 1} · last move {ago(game.last_move_at)}
              </span>
            </span>
          </button>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        Looking for a live game instead? The <Link to="/play">lobby</Link> pairs you in seconds.
      </p>
    </div>
  )
}
