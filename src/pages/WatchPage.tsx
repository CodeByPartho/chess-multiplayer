import { useEffect, useState } from 'react'
import { Link, useRoute } from '@/router'
import { Board } from '@/board/Board'
import { useSettings } from '@/lib/settings'
import { fetchLiveGames, fetchWatchGame, type LiveGameRow } from '@/net/socialClient'
import { fetchPlayers, type ServerGame } from '@/net/gameClient'
import type { PieceColor } from '@/board/pieces'

export function WatchPage() {
  const { navigate } = useRoute()
  const [games, setGames] = useState<LiveGameRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let dead = false
    const load = async () => {
      const rows = await fetchLiveGames()
      if (!dead) {
        setGames(rows)
        setLoading(false)
      }
    }
    void load()
    const id = setInterval(() => void load(), 15_000)
    return () => {
      dead = true
      clearInterval(id)
    }
  }, [])

  return (
    <div className="page-narrow">
      <h1 className="page-title">Watch</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        Live games being played right now. Open one to follow it move by move.
      </p>
      {loading && <p className="hint">Loading…</p>}
      {!loading && games.length === 0 && (
        <p className="hint">
          No games are live at this moment. <Link to="/play">Start one</Link> and it will show up here.
        </p>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {games.map((g) => (
          <button key={g.id} className="action-card" onClick={() => navigate(`/watch/${g.id}`)}>
            <span>
              <span className="ac-title">
                {g.white_name} vs {g.black_name}
              </span>
              <span className="ac-sub">
                {g.tc_label} · {g.rated ? 'Rated' : 'Casual'} · {Math.floor(g.moves_count / 2) + 1} moves in ·{' '}
                {g.turn === 'w' ? 'White' : 'Black'} to move
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function SpectatePage({ gameId }: { gameId: string }) {
  const settings = useSettings()
  const [game, setGame] = useState<ServerGame | null>(null)
  const [names, setNames] = useState<{ w: string; b: string }>({ w: 'White', b: 'Black' })
  const [flipped, setFlipped] = useState(false)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let dead = false
    const load = async () => {
      const g = await fetchWatchGame(gameId)
      if (dead) return
      if (!g) {
        setMissing(true)
        return
      }
      setGame(g)
      try {
        const players = await fetchPlayers(g)
        setNames({
          w: players.white?.username ?? 'White',
          b: players.black?.username ?? 'Black',
        })
      } catch {
        /* keep defaults */
      }
    }
    void load()
    const id = setInterval(() => void load(), 4000)
    return () => {
      dead = true
      clearInterval(id)
    }
  }, [gameId])

  if (missing) {
    return (
      <div className="page-narrow">
        <h1 className="page-title">Game not found</h1>
        <p className="hint">
          This game is not available to watch. <Link to="/watch">Back to live games</Link>
        </p>
      </div>
    )
  }
  if (!game) {
    return (
      <div className="center-page">
        <div className="spinner" />
      </div>
    )
  }

  const bottom: PieceColor = flipped ? 'b' : 'w'
  const last = game.moves[game.moves.length - 1]
  const lastMove = last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) } : null
  const over = game.status === 'over'

  return (
    <div className="game-layout" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="game-main">
        <div className="board-slot">
          <Board
            fen={game.fen}
            orientation={bottom}
            pieceSet={settings.pieceSet}
            coords={settings.coords}
            lastMove={lastMove}
            ariaLabel={`Spectating ${names.w} versus ${names.b}`}
          />
        </div>
      </div>
      <div className="game-side" data-tab="moves">
        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>
              {names.w} vs {names.b}
            </b>
            <span>{over ? 'finished' : 'live'}</span>
          </div>
          <div className="card" style={{ padding: 12 }}>
            <p style={{ margin: 0, fontSize: 14 }}>
              {game.tc?.label ?? 'Correspondence'} · {game.rated ? 'Rated' : 'Casual'}
              {over && game.result
                ? ` · ${game.result.winner ? `${game.result.winner === 'w' ? names.w : names.b} won (${game.result.reason})` : `Draw (${game.result.reason})`}`
                : ` · ${game.turn === 'w' ? names.w : names.b} to move`}
            </p>
          </div>
          <div className="card" style={{ padding: 12, maxHeight: 260, overflowY: 'auto' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 13.5, lineHeight: 1.7 }}>
              {game.moves.length === 0 && <span className="hint">No moves yet</span>}
              {game.moves.map((m, i) => (
                <span key={i} style={{ marginRight: 8 }}>
                  {i % 2 === 0 && <span className="hint">{i / 2 + 1}. </span>}
                  {m.san}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setFlipped((f) => !f)}>
              ⇅ Flip
            </button>
            <Link to="/watch" className="btn btn-sm btn-ghost">
              ← All live games
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
