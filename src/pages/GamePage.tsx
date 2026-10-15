import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from '@/board/Board'
import { useGameSession, capturedPieces } from '@/game/useGameSession'
import { GameCore } from '@/lib/chess/game'
import { useNavKeys, type NavAction } from '@/game/useNavKeys'
import { PlayerStrip } from '@/components/PlayerStrip'
import { GameClock } from '@/components/Clock'
import { MoveList } from '@/components/MoveList'
import { Chat } from '@/components/Chat'
import { Modal, Confirm } from '@/components/Modal'
import { useToast } from '@/components/Toast'
import { useSettings } from '@/lib/settings'
import { loadIdentity } from '@/lib/identity'
import { saveGame } from '@/lib/history'
import { sounds } from '@/lib/sounds'
import { buildPgn } from '@/lib/chess/pgn'
import { pgnResult, resultTitle } from '@/game/resultText'
import { copyText } from '@/lib/clipboard'
import { Link, useRoute } from '@/router'
import { ensureAuth, onlineEnabled, myUserId, touchGuest } from '@/net/supabase'
import { fetchGame, fetchPlayers, subscribeGame, sendAction, reportPlayer, toCorePly, type PlayerInfo, type ServerGame } from '@/net/gameClient'
import { pullRatingAfterGame } from '@/net/queue'
import type { Color, EndReason } from '@/lib/chess/types'

const DISCONNECT_CLAIM_MS = 120_000

export default function GamePage({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<ServerGame | null>(null)
  const [players, setPlayers] = useState<{ white: PlayerInfo | null; black: PlayerInfo | null } | null>(null)
  const [conn, setConn] = useState<'connecting' | 'live' | 'lost'>('connecting')
  const [error, setError] = useState<string | null>(onlineEnabled ? null : 'Online play is not configured on this build.')
  const [myId, setMyId] = useState<string | null>(null)

  // initial load + auth + subscription
  useEffect(() => {
    if (!onlineEnabled) return
    let dead = false
    let playersKey = ''
    ensureAuth()
      .then(() => myUserId())
      .then((id) => {
        if (dead) return
        setMyId(id)
        return fetchGame(gameId)
      })
      .then((g) => {
        if (dead || !g) return
        setGame(g)
        return fetchPlayers(g)
      })
      .then((p) => {
        if (!dead && p) setPlayers(p)
      })
      .catch((e: Error) => {
        if (!dead) setError(e.message)
      })

    const unsub = subscribeGame(
      gameId,
      (g) => {
        setGame(g)
        const key = `${g.white_id}:${g.black_id}`
        if (key !== playersKey) {
          playersKey = key
          void fetchPlayers(g).then(setPlayers, () => {})
        }
      },
      (s) => setConn(s),
    )
    return () => {
      dead = true
      unsub()
    }
  }, [gameId])

  // presence heartbeat while a game is open — keeps last_seen fresh so the
  // opponent's disconnect-claim can never fire against a player who is here
  // (background tabs throttle timers to ~1/min, so 30s pings stay well under
  // the 120s claim threshold)
  useEffect(() => {
    if (!onlineEnabled || !myId) return
    touchGuest()
    const id = setInterval(touchGuest, 30_000)
    const onFocus = () => {
      if (!document.hidden) touchGuest()
    }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [myId, onlineEnabled])

  if (error) {
    return (
      <div className="center-page">
        <h2>Could not open the game</h2>
        <p className="error-text">{error}</p>
        <Link to="/play" className="btn btn-primary">
          Back to lobby
        </Link>
      </div>
    )
  }

  if (!game) {
    return (
      <div className="center-page">
        <div className="spinner" />
        <p>Loading game…</p>
      </div>
    )
  }

  const me: Color | null = myId ? (game.white_id === myId ? 'w' : game.black_id === myId ? 'b' : null) : null

  if (me === null && myId !== null) {
    return (
      <div className="center-page">
        <h2>This invite is not for you (yet)</h2>
        <p style={{ color: 'var(--text-dim)' }}>Open the invite link on your own device to join.</p>
        <Link to="/play" className="btn btn-primary">
          Back to lobby
        </Link>
      </div>
    )
  }

  return (
    <OnlineGameView
      key={gameId}
      gameId={gameId}
      game={game}
      setGame={setGame}
      players={players}
      me={me}
      conn={conn}
    />
  )
}

/** server-authoritative remaining ms for a color, or null when not running */
function remainingFromGame(game: ServerGame, color: Color, now: number): number | null {
  if (game.status !== 'active' || game.turn !== color) return null
  const base = color === 'w' ? game.wms : game.bms
  const elapsed = now - new Date(game.last_move_at).getTime()
  return Math.max(0, base - Math.max(0, elapsed))
}

/** server reasons map 1:1 onto EndReason; guard against unknown strings */
function toGameResult(r: { winner: Color | null; reason: string } | null): { winner: Color | null; reason: EndReason } | null {
  if (!r) return null
  const known: EndReason[] = ['checkmate', 'resign', 'timeout', 'stalemate', 'threefold', 'fivemove', 'fifty', 'insufficient', 'agreement', 'aborted', 'disconnect']
  return { winner: r.winner, reason: known.includes(r.reason as EndReason) ? (r.reason as EndReason) : 'resign' }
}

function OnlineGameView({
  gameId,
  game,
  setGame,
  players,
  me,
  conn,
}: {
  gameId: string
  game: ServerGame
  setGame: React.Dispatch<React.SetStateAction<ServerGame | null>>
  players: { white: PlayerInfo | null; black: PlayerInfo | null } | null
  me: Color | null
  conn: 'connecting' | 'live' | 'lost'
}) {
  const settings = useSettings()
  const toast = useToast()
  const { navigate } = useRoute()
  const identity = useMemo(() => loadIdentity(), [])

  const [flipped, setFlipped] = useState(false)
  const [chatMuted, setChatMuted] = useState(false)
  const [sideTab, setSideTab] = useState<'moves' | 'chat'>('moves')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportText, setReportText] = useState('')
  const [confirmResign, setConfirmResign] = useState(false)
  const [confirmAbort, setConfirmAbort] = useState(false)
  const [showPgn, setShowPgn] = useState(false)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [myFinalRating, setMyFinalRating] = useState<number | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [toastOnce, setToastOnce] = useState<string | null>(null)

  const pool = game.tc?.type === 'bullet' || game.tc?.type === 'blitz' || game.tc?.type === 'rapid' ? game.tc.type : 'classical'
  const preRating = useRef(identity.ratings[pool].rating)
  const claimedTimeout = useRef(false)
  const claimedDisconnect = useRef(false)
  const savedRef = useRef(false)
  const rematchNav = useRef(false)

  const applyServerGame = useCallback((g: ServerGame) => setGame(g), [setGame])

  const session = useGameSession({
    mode: 'online',
    fen: game.start_fen,
    tc: game.tc,
    myColors: me ? [me] : [],
    myColorForSound: me,
    premoves: settings.premoves && !!me,
  })

  /* ---------------- sync server state into the local core ---------------- */
  // NOTE: depends ONLY on `game` — the session object is recreated every render,
  // so including it would loop forceUpdate forever. Rebuilding with
  // GameCore.replay keeps the clocks authoritative (server timestamps) and
  // makes any local divergence (optimistic move, stale snapshot) impossible.
  const sessionRef = useRef(session)
  sessionRef.current = session
  const coreKeyRef = useRef('')
  const viewPlyRef = useRef<number | null>(null)
  viewPlyRef.current = session.displayPly === session.plies.length ? null : session.displayPly
  const prevLenRef = useRef(0)
  useEffect(() => {
    const serverLen = game.moves.length
    const key = `${game.id}:${serverLen}:${game.last_move_at}:${game.wms}:${game.bms}:${game.status}`
    if (coreKeyRef.current === key) return
    coreKeyRef.current = key

    // a freshly arrived opponent move should play its sound
    const grew = serverLen > prevLenRef.current && serverLen > 0
    prevLenRef.current = serverLen
    let arrivedSan: string | null = null
    if (grew) {
      const startTurn = game.start_fen.split(' ')[1] === 'b' ? 'b' : 'w'
      const lastColor: Color = (serverLen - 1) % 2 === 0 ? startTurn : startTurn === 'w' ? 'b' : 'w'
      if (lastColor !== me) arrivedSan = game.moves[serverLen - 1].san
    }

    const rebuilt = GameCore.replay(game.start_fen, toCorePly(game.start_fen, game.moves), game.tc, Date.now())

    // server verdict (resign / timeout / disconnect / draws decided server-side)
    const serverResult = toGameResult(game.result)
    if (serverResult && !rebuilt.result) rebuilt.result = serverResult

    // restore where the user was browsing; jump to the end when a move lands
    const wantPly = grew ? null : viewPlyRef.current
    sessionRef.current.replaceCore(rebuilt)
    sessionRef.current.seek(wantPly ?? rebuilt.plies.length)

    if (arrivedSan) sounds.playMove(arrivedSan)
  }, [game])

  /* ---------------- end-of-game side effects ---------------- */
  const result = session.result ?? toGameResult(game.result)
  useEffect(() => {
    if (!result || savedRef.current) return
    savedRef.current = true
    saveGame({
      id: game.id,
      mode: 'online',
      tc: game.tc,
      rated: game.rated,
      startFen: game.start_fen,
      moves: session.plies.map((p) => ({ uci: p.uci, san: p.san })),
      result: { winner: result.winner, reason: result.reason },
      white: {
        name: players?.white?.username ?? 'White',
        rating: players?.white?.ratings?.[pool]?.rating ?? preRating.current,
        avatarSeed: players?.white?.avatar_seed ?? 'white',
        flag: players?.white?.flag ?? null,
      },
      black: {
        name: players?.black?.username ?? 'Black',
        rating: players?.black?.ratings?.[pool]?.rating ?? preRating.current,
        avatarSeed: players?.black?.avatar_seed ?? 'black',
        flag: players?.black?.flag ?? null,
      },
      myColor: me,
      date: Date.now(),
    })
    if (game.rated && me) {
      void pullRatingAfterGame(pool, preRating.current).then(({ rating, delta }) => {
        setRatingDelta(delta)
        setMyFinalRating(rating)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.reason])

  /* ---------------- rematch navigation ---------------- */
  useEffect(() => {
    const g = game.rematch
    if (g?.game_id && g.w && g.b && !rematchNav.current) {
      rematchNav.current = true
      navigate(`/play/${g.game_id}`)
    }
  }, [game.rematch, navigate])

  /* ---------------- auto timeout/disconnect claims ---------------- */
  // read latest state through refs: this interval must never act on a stale
  // snapshot, and it must not be torn down/rebuilt on every game update.
  const stateRef = useRef({ game, players, me })
  stateRef.current = { game, players, me }
  useEffect(() => {
    if (!me) return
    const id = setInterval(() => {
      const { game, players, me } = stateRef.current
      if (!me || game.status !== 'active' || game.result) return
      if (claimedTimeout.current || claimedDisconnect.current) return
      const now = Date.now()
      const opp: Color = me === 'w' ? 'b' : 'w'
      // my own flag fell — ask the server for the verdict (it decides)
      const myMs = remainingFromGame(game, me, now)
      if (myMs !== null && myMs <= 0) {
        claimedTimeout.current = true
        void sendAction(gameId, 'claim_win').then((r) => {
          if (r.game) applyServerGame(r.game)
          if (r.error) claimedTimeout.current = false
        })
        return
      }
      if (game.turn !== opp) return
      const oppMs = remainingFromGame(game, opp, now)
      if (oppMs !== null && oppMs <= 0) {
        claimedTimeout.current = true
        void sendAction(gameId, 'claim_win').then((r) => {
          if (r.game) applyServerGame(r.game)
          if (r.error) claimedTimeout.current = false
        })
        return
      }
      const oppInfo = opp === 'w' ? players?.white : players?.black
      if (oppInfo) {
        const gap = now - new Date(oppInfo.last_seen).getTime()
        if (gap >= DISCONNECT_CLAIM_MS) {
          claimedDisconnect.current = true
          void sendAction(gameId, 'claim_win').then((r) => {
            if (r.game) applyServerGame(r.game)
            if (r.error) claimedDisconnect.current = false
          })
        }
      }
    }, 1500)
    return () => clearInterval(id)
  }, [me, gameId, applyServerGame])

  /* ---------------- one-shot notices (offers) ---------------- */
  useEffect(() => {
    const key =
      game.draw_offer && game.draw_offer !== me
        ? 'draw-offer'
        : game.takeback_offer && game.takeback_offer !== me
          ? 'takeback-offer'
          : null
    if (key && key !== toastOnce) {
      setToastOnce(key)
      toast.show(key === 'draw-offer' ? 'Your opponent offers a draw' : 'Your opponent offers a takeback', 'info')
    }
    if (!key && toastOnce) setToastOnce(null)
  }, [game.draw_offer, game.takeback_offer, me, toastOnce, toast])

  /* ---------------- actions ---------------- */
  const act = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      setActionBusy(true)
      const res = await sendAction(gameId, action, extra)
      setActionBusy(false)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.game) applyServerGame(res.game)
    },
    [gameId, applyServerGame, toast],
  )

  const myMove = useCallback(
    (uci: string) => {
      if (!me || game.status !== 'active' || game.result) return
      const ok = session.tryUserMove(uci)
      if (!ok) return
      void sendAction(gameId, 'move', { uci }).then((r) => {
        if (r.error) {
          toast.error(r.error)
          // roll back to server truth
          void fetchGame(gameId).then((g) => g && applyServerGame(g))
        } else if (r.game) {
          applyServerGame(r.game)
        }
      })
    },
    [me, game.status, game.result, session, gameId, applyServerGame, toast],
  )

  const onSeek = useCallback(
    (action: NavAction) => {
      session.seek(action === 'first' ? 0 : action === 'last' ? session.plies.length : action === 'prev' ? session.displayPly - 1 : session.displayPly + 1)
    },
    [session],
  )
  useNavKeys(onSeek)

  /* ---------------- derived data ---------------- */
  const myColor = me ?? 'w'
  const oppColor: Color = myColor === 'w' ? 'b' : 'w'
  const oppInfo = oppColor === 'w' ? players?.white : players?.black
  const bottomColor = flipped ? oppColor : myColor
  const topColor = flipped ? myColor : oppColor

  const caps = useMemo(() => capturedPieces(session.core.startFen, session.displayFen), [session.core.startFen, session.displayFen])
  const capFor = (c: Color) => (c === 'w' ? caps.byWhite : caps.byBlack)

  const oppStaleMs = oppInfo ? Date.now() - new Date(oppInfo.last_seen).getTime() : 0
  const canClaimDisconnect = game.status === 'active' && !game.result && game.turn === oppColor && oppStaleMs >= DISCONNECT_CLAIM_MS

  const pgn = useMemo(
    () =>
      buildPgn(game.start_fen, session.plies, {
        white: players?.white?.username ?? 'White',
        black: players?.black?.username ?? 'Black',
        result: result ? pgnResult(result) : '*',
        event: game.rated ? 'Rated game' : 'Casual game',
        timecontrol: game.tc ? `${game.tc.base / 1000}+${game.tc.inc / 1000}` : undefined,
      }),
    [game, session.plies, players, result],
  )

  const nameOf = (c: Color) => (c === 'w' ? players?.white?.username ?? 'White' : players?.black?.username ?? 'Black')

  const stripFor = (color: Color, top: boolean) => {
    const info = color === 'w' ? players?.white : players?.black
    const isOpp = color === oppColor
    const stale = info ? Date.now() - new Date(info.last_seen).getTime() > 25_000 : false
    return (
      <PlayerStrip
        top={top}
        name={info?.username ?? (color === 'w' ? 'White' : 'Black')}
        rating={info?.ratings?.[pool]?.rating ?? '—'}
        avatarSeed={info?.avatar_seed ?? `${color}-seat`}
        flag={info?.flag ?? null}
        pieceSet={settings.pieceSet}
        captured={capFor(color)}
        active={!result && game.status === 'active' && session.turn === color}
        connection={isOpp && game.status === 'active' ? (stale ? { state: 'grace' } : { state: 'ok' }) : null}
        subtitle={game.rated ? `Rated ${game.tc?.label ?? ''}` : `Casual ${game.tc?.label ?? ''}`}
        clock={
          game.tc ? (
            <GameClock
              getMs={() => session.core.remaining(color, Date.now()) ?? 0}
              running={!result && game.status === 'active' && session.turn === color}
              lowMs={Math.min(15_000, Math.floor((game.tc.base ?? 600_000) / 6))}
            />
          ) : (
            <GameClock untimed getMs={() => 0} running={false} />
          )
        }
      />
    )
  }

  /* ---------------- waiting room (invite creator) ---------------- */
  if (game.status === 'waiting') {
    const link = `${location.origin}/join/${game.id}`
    const cancelInvite = () => {
      void sendAction(gameId, 'abort').then((r) => {
        if (r.error) toast.error(r.error)
        else navigate('/play')
      })
    }
    return (
      <div className="center-page" style={{ gap: 12 }}>
        <div className="spinner" />
        <h2 style={{ margin: 0 }}>Waiting for your friend</h2>
        <div className="chip" style={{ justifyContent: 'space-between', width: 'min(440px, 92vw)' }}>
          <span>You play</span>
          <b>
            {me === 'w' ? '⬜ White' : '⬛ Black'} · {game.tc?.label} · {game.rated ? 'Rated' : 'Casual'}
          </b>
        </div>
        <div style={{ display: 'flex', gap: 8, width: 'min(440px, 92vw)' }}>
          <input className="input mono" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" onClick={() => void copyText(link).then((ok) => ok && toast.show('Invite link copied'))}>
            Copy
          </button>
        </div>
        <p className="hint">Share the link — the game starts the moment your friend joins.</p>
        <button className="btn btn-ghost" onClick={cancelInvite}>
          Cancel game
        </button>
      </div>
    )
  }

  const gameOver = !!result

  return (
    <div className="game-layout">
      <div className="game-main">
        {stripFor(topColor, true)}
        <div className="board-slot">
          <Board
            fen={session.displayFen}
            orientation={bottomColor}
            movable={session.movable}
            onMove={(uci) => myMove(uci)}
            legalTargets={session.legalTargets}
            lastMove={session.displayLastMove}
            checkSquare={session.checkSquare}
            pieceSet={settings.pieceSet}
            coords={settings.coords}
            autoQueen={settings.autoQueen}
            premove={session.premove}
            ariaLabel="Online game board"
          />
        </div>
        {stripFor(bottomColor, false)}
      </div>

      <div className="game-side" data-tab={sideTab}>
        {conn === 'lost' && (
          <div className="conn-banner lost">Connection lost — reconnecting… Your clock may keep running.</div>
        )}

        {gameOver && result && (
          <div className="result-banner">
            <div className="rb-title">{resultTitle(result, nameOf('w'), nameOf('b'))}</div>
            <div className="rb-sub">
              {result.winner === null ? '½ – ½' : result.winner === me ? 'You won! 🎉' : 'You lost — rematch?'}
              {game.rated && ratingDelta !== null && (
                <span style={{ marginLeft: 8 }}>
                  rating {ratingDelta >= 0 ? `+${ratingDelta}` : ratingDelta} → {myFinalRating ?? preRating.current}
                </span>
              )}
              {game.rated && ratingDelta === null && <span style={{ marginLeft: 8 }}>updating rating…</span>}
            </div>
          </div>
        )}

        {game.draw_offer && !gameOver && (
          <div className="card offer" style={{ padding: 12 }}>
            <div style={{ fontSize: 14 }}>{game.draw_offer === me ? 'Draw offer sent.' : `${nameOf(game.draw_offer)} offers a draw.`}</div>
            {game.draw_offer !== me && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={() => void act('draw_offer')} disabled={actionBusy}>
                  Accept
                </button>
                <button className="btn btn-sm" onClick={() => void act('draw_decline')} disabled={actionBusy}>
                  Decline
                </button>
              </div>
            )}
          </div>
        )}

        {game.takeback_offer && !gameOver && !game.rated && (
          <div className="card offer" style={{ padding: 12 }}>
            <div style={{ fontSize: 14 }}>
              {game.takeback_offer === me ? 'Takeback offer sent.' : `${nameOf(game.takeback_offer)} wants a takeback.`}
            </div>
            {game.takeback_offer !== me && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={() => void act('takeback_accept')} disabled={actionBusy}>
                  Accept
                </button>
                <button className="btn btn-sm" onClick={() => void act('takeback_decline')} disabled={actionBusy}>
                  Decline
                </button>
              </div>
            )}
          </div>
        )}

        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>{game.tc?.label ?? 'Untimed'}</b>
            <span>
              {(game.tc?.type ?? 'friendly') + ' · '}
              {game.rated ? 'rated' : 'casual'}
            </span>
          </div>

          <MoveList sans={session.sans} currentPly={session.displayPly} onSeek={(p) => session.seek(p)} />

          <div className="game-controls">
            {!gameOver && game.status === 'active' && (
              <>
                {game.moves.length < 2 ? (
                  <button className="btn btn-sm" onClick={() => setConfirmAbort(true)} disabled={actionBusy}>
                    Abort
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn-sm"
                      onClick={() => void act('draw_offer')}
                      disabled={actionBusy || game.draw_offer === me}
                      title={game.draw_offer === me ? 'Draw offered' : 'Offer a draw'}
                    >
                      {game.draw_offer === me ? 'Draw offered…' : 'Draw'}
                    </button>
                    {!game.rated && (
                      <button
                        className="btn btn-sm"
                        onClick={() => void act('takeback_offer')}
                        disabled={actionBusy || game.takeback_offer === me || session.plies.length === 0}
                      >
                        {game.takeback_offer === me ? 'Takeback offered…' : 'Takeback'}
                      </button>
                    )}
                  </>
                )}
                <button className="btn btn-sm btn-danger" onClick={() => setConfirmResign(true)} disabled={actionBusy}>
                  Resign
                </button>
                {canClaimDisconnect && (
                  <button className="btn btn-sm btn-primary" onClick={() => void act('claim_win')} disabled={actionBusy}>
                    ⚡ Claim win
                  </button>
                )}
              </>
            )}
            {gameOver && (
              <>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => void act('rematch')}
                  disabled={actionBusy || game.rematch?.[myColor] === true}
                >
                  {game.rematch?.[myColor] ? 'Waiting…' : 'Rematch'}
                </button>
                <Link to={`/review/${game.id}`} className="btn btn-sm">
                  📊 Review
                </Link>
              </>
            )}
            <button className="btn btn-sm" onClick={() => setShowPgn(true)}>
              PGN
            </button>
            <button className="btn btn-sm" onClick={() => setFlipped((f) => !f)} title="Flip board">
              ⇅ Flip
            </button>
          </div>
        </div>

        <div className="pane" data-pane="chat">
          <Chat gameId={gameId} muted={chatMuted} onToggleMute={() => setChatMuted((m) => !m)} onReport={() => setReportOpen(true)} />
        </div>

        <nav className="side-tabs" aria-label="Game panel">
          <button className={sideTab === 'moves' ? 'active' : ''} onClick={() => setSideTab('moves')}>
            Moves
          </button>
          <button className={sideTab === 'chat' ? 'active' : ''} onClick={() => setSideTab('chat')}>
            Chat
          </button>
        </nav>
      </div>

      {confirmResign && (
        <Confirm
          title="Resign"
          message="Resign this game? This loses the game immediately."
          confirmLabel="Resign"
          danger
          onCancel={() => setConfirmResign(false)}
          onConfirm={() => {
            setConfirmResign(false)
            void act('resign')
          }}
        />
      )}
      {confirmAbort && (
        <Confirm
          title="Abort game"
          message="Abort before any moves? The game won't be rated and neither player takes a result."
          confirmLabel="Abort"
          onCancel={() => setConfirmAbort(false)}
          onConfirm={() => {
            setConfirmAbort(false)
            void act('abort')
          }}
        />
      )}
      {reportOpen && (
        <Modal
          title="Report opponent"
          onClose={() => setReportOpen(false)}
          actions={
            <>
              <button className="btn" onClick={() => setReportOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={reportText.trim().length < 3}
                onClick={() => {
                  const target = oppInfo?.id
                  if (target) {
                    void reportPlayer(target, game.id, reportText.trim()).then(
                      () => {
                        toast.show('Report submitted — thank you')
                        setReportOpen(false)
                        setReportText('')
                      },
                      (e: Error) => toast.error(e.message),
                    )
                  }
                }}
              >
                Submit report
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="rr">What happened?</label>
            <textarea
              id="rr"
              className="input"
              rows={3}
              maxLength={300}
              placeholder="Describe the issue (abuse, cheating, sandbagging…)"
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
            />
          </div>
        </Modal>
      )}
      {showPgn && (
        <Modal
          title="PGN"
          onClose={() => setShowPgn(false)}
          actions={
            <>
              <button className="btn" onClick={() => setShowPgn(false)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void copyText(pgn).then((ok) => (ok ? toast.show('PGN copied') : toast.error('Copy failed')))}
              >
                Copy
              </button>
            </>
          }
        >
          <textarea className="input mono" rows={8} readOnly value={pgn} onFocus={(e) => e.currentTarget.select()} />
        </Modal>
      )}
    </div>
  )
}
