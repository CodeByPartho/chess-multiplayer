import { useCallback, useEffect, useState } from 'react'
import { Link, useRoute } from '@/router'
import { useToast } from '@/components/Toast'
import { copyText } from '@/lib/clipboard'
import { useAuth } from '@/net/auth'
import { myUserId, onlineEnabled } from '@/net/supabase'
import { createInvite, fetchGame, joinInvite } from '@/net/gameClient'
import {
  addSimulBoard,
  createSimul,
  fetchSimulBoards,
  fetchSimuls,
  setSimulOpen,
  type Simul,
} from '@/net/socialClient'
import type { ServerGame } from '@/net/gameClient'
import type { TimeControl } from '@/lib/chess/types'

interface BoardRow {
  game: ServerGame
  link: string | null
}

function SimulBoards({ simul, isHost }: { simul: Simul; isHost: boolean }) {
  const { navigate } = useRoute()
  const toast = useToast()
  const [boards, setBoards] = useState<BoardRow[]>([])
  const [busy, setBusy] = useState(false)
  const [untimed, setUntimed] = useState(true)

  const load = useCallback(async () => {
    const ids = await fetchSimulBoards(simul.id)
    const rows: BoardRow[] = []
    for (const id of ids) {
      const game = await fetchGame(id).catch(() => null)
      if (game) rows.push({ game, link: game.invite_code ? `${window.location.origin}/invite/${game.invite_code}` : null })
    }
    setBoards(rows)
  }, [simul.id])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 20_000)
    return () => clearInterval(id)
  }, [load])

  const addBoard = async () => {
    setBusy(true)
    try {
      const tc: TimeControl | null = untimed ? null : { type: 'rapid', base: 600_000, inc: 0, label: '10 + 0' }
      const created = await createInvite(tc, false, 'w')
      await addSimulBoard(simul.id, created.gameId)
      toast.show('Board opened. Share its link with the player who takes it.')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
  }

  const takeSeat = async (game: ServerGame) => {
    if (!game.invite_code) return
    setBusy(true)
    try {
      const joined = await joinInvite(game.invite_code)
      navigate(`/play/${joined.gameId}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div style={{ marginTop: 10 }}>
      {boards.length === 0 && <p className="hint">No boards yet.</p>}
      {boards.map(({ game, link }) => (
        <div key={game.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', flexWrap: 'wrap', fontSize: 14 }}>
          <span>
            Board: {game.status === 'waiting' ? 'open seat' : game.status === 'active' ? `live, move ${Math.floor(game.moves.length / 2) + 1}` : `finished${game.result ? ` (${game.result.reason})` : ''}`}
            {' · '}
            {game.tc?.label ?? 'Correspondence'}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {game.status === 'waiting' && link && (
              <button className="btn btn-sm" onClick={() => void copyText(link).then(() => toast.show('Link copied'))}>
                Copy invite
              </button>
            )}
            {game.status === 'waiting' && !isHost && (
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void takeSeat(game)}>
                Take the seat
              </button>
            )}
            {game.status !== 'waiting' && (
              <Link to={`/watch/${game.id}`} className="btn btn-sm">
                Watch
              </Link>
            )}
            {isHost && game.status === 'active' && (
              <Link to={`/play/${game.id}`} className="btn btn-sm btn-primary">
                Play
              </Link>
            )}
          </span>
        </div>
      ))}
      {isHost && simul.open && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" disabled={busy} onClick={() => void addBoard()}>
            + Open a board
          </button>
          <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={untimed} onChange={(e) => setUntimed(e.target.checked)} />
            untimed boards (10 + 0 rapid when off)
          </label>
        </div>
      )}
    </div>
  )
}

export default function SimulsPage() {
  const toast = useToast()
  const auth = useAuth()
  const [simuls, setSimuls] = useState<Simul[]>([])
  const [myId, setMyId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [rows, uid] = await Promise.all([fetchSimuls(), myUserId()])
    setSimuls(rows)
    setMyId(uid)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const signedIn = !!auth.user && !auth.isGuest && onlineEnabled

  const create = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      const id = await createSimul(title.trim())
      setTitle('')
      setOpenId(id)
      toast.show('Simul created. Open boards and share their links.')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="page-narrow">
      <h1 className="page-title">Simuls</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        One host, many boards at once. The host opens boards and shares each invite link; players take a seat and the
        host cycles through the games. Classic exhibition chess, run from the browser.
      </p>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Host a simul</h3>
        {!signedIn && <p className="hint">Sign in to host. Anyone can take a seat from a link.</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Simul title, e.g. Saturday club simul"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ flex: '1 1 220px' }}
          />
          <button className="btn btn-primary" disabled={!signedIn || busy || !title.trim()} onClick={() => void create()}>
            Create simul
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {simuls.map((s) => {
          const isHost = myId !== null && s.host === myId
          return (
            <div key={s.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 16 }}>{s.title}</b>
                <span className="hint">hosted by {s.hostName}</span>
                <span style={{ color: s.open ? 'var(--accent)' : 'var(--text-dim)', fontSize: 13, fontWeight: 700 }}>
                  {s.open ? 'OPEN' : 'CLOSED'}
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {isHost && s.open && (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => void setSimulOpen(s.id, false).then(load)}
                    >
                      Close simul
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                    {openId === s.id ? 'Hide boards' : 'Boards'}
                  </button>
                </span>
              </div>
              {openId === s.id && <SimulBoards simul={s} isHost={isHost} />}
            </div>
          )
        })}
        {simuls.length === 0 && <p className="hint">No simuls yet. Host the first one above.</p>}
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        Hosts: your active boards also appear in the <Link to="/play">lobby</Link> resume and on the{' '}
        <Link to="/correspondence">correspondence page</Link> when untimed.
      </p>
    </div>
  )
}
