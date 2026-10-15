import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@/router'
import {
  fetchGame,
  fetchGameByCode,
  fetchPlayers,
  joinInvite,
  subscribeGame,
  type PlayerInfo,
  type ServerGame,
} from '@/net/gameClient'
import { joinViewState, type JoinView } from '@/net/joinState'
import { ensureAuth, myUserId, onlineEnabled } from '@/net/supabase'
import { Avatar } from '@/components/Avatar'

/**
 * Landing page for /join/<gameId> (and legacy /invite/<code>).
 *
 * Shows what the game is before joining — who invited you, the time control,
 * the color you'll get — with an explicit Join button. Every outcome gets a
 * clear screen: not found, already full, finished, expired, cancelled, or the
 * friendly "you created this game" explainer when the same guest profile opens
 * their own invite. Live-subscribes so a cancel/full flip updates in place.
 */
export default function JoinScreen({
  gameId,
  code,
  onGo,
}: {
  gameId?: string
  code?: string
  onGo: (to: string) => void
}) {
  const [game, setGame] = useState<ServerGame | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [myId, setMyId] = useState<string | null>(null)
  const [creator, setCreator] = useState<PlayerInfo | null>(null)
  const [error, setError] = useState<string | null>(onlineEnabled ? null : 'Online play needs the server keys — they are not configured on this build.')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const resolvedIdRef = useRef<string | null>(gameId ?? null)

  // load: guest sign-in (own anonymous profile), then the game row itself
  useEffect(() => {
    if (!onlineEnabled) return
    let dead = false
    ;(async () => {
      try {
        await ensureAuth()
        const id = await myUserId()
        let g = gameId ? await fetchGame(gameId) : null
        if (!g && code && !gameId) {
          g = await fetchGameByCode(code)
          if (g) resolvedIdRef.current = g.id
        }
        if (dead) return
        setMyId(id)
        setGame(g)
        setLoaded(true)
        // name + avatar of the host for the join card (whichever seat is filled)
        if (g) {
          const hostId = g.white_id ?? g.black_id
          if (hostId) {
            const p = await fetchPlayers(g).catch(() => null)
            if (!dead && p) setCreator(g.white_id ? p.white : p.black)
          }
        }
      } catch (e) {
        if (!dead) {
          setError((e as Error).message)
          setLoaded(true)
        }
      }
    })()
    return () => {
      dead = true
    }
  }, [gameId, code])

  // live updates: a cancel by the creator or someone else joining first
  // must flip this screen immediately, not after a refresh
  const applyGame = useCallback((g: ServerGame) => setGame(g), [])
  useEffect(() => {
    const id = resolvedIdRef.current
    if (!loaded || !id) return
    return subscribeGame(id, applyGame)
  }, [loaded, applyGame])

  // creator or returning player: move them straight to the game screen
  const view: JoinView = joinViewState(game, myId, Date.now())
  const viewState = view.state
  const viewGameId = view.state === 'not-found' || view.state === 'cancelled' ? null : view.gameId
  useEffect(() => {
    if (viewState === 'reconnect' && viewGameId) onGo(`/play/${viewGameId}`)
  }, [viewState, viewGameId, onGo])

  const doJoin = async () => {
    if (!game?.invite_code) {
      setJoinError('This invite has no join code — ask for a fresh link.')
      return
    }
    setJoining(true)
    setJoinError(null)
    try {
      const r = await joinInvite(game.invite_code)
      onGo(`/play/${r.gameId}`)
    } catch (e) {
      setJoinError((e as Error).message)
      // re-fetch: the seat may have been taken between load and click
      if (resolvedIdRef.current) {
        const fresh = await fetchGame(resolvedIdRef.current).catch(() => null)
        if (fresh) setGame(fresh)
      }
    } finally {
      setJoining(false)
    }
  }

  /* ---------------- render: every state has a screen ---------------- */

  if (error) {
    return (
      <div className="center-page">
        <h2>Could not open the invite</h2>
        <p className="error-text">{error}</p>
        <Link to="/play" className="btn btn-primary">
          Go to lobby
        </Link>
      </div>
    )
  }

  if (!loaded || (view.state !== 'not-found' && !game)) {
    return (
      <div className="center-page">
        <div className="spinner" />
        <p>Loading invite…</p>
      </div>
    )
  }

  switch (view.state) {
    case 'not-found':
      return (
        <div className="center-page">
          <h2>Game not found</h2>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, textAlign: 'center' }}>
            This invite link isn&apos;t valid — it may have been mistyped or the game was deleted.
          </p>
          <Link to="/play" className="btn btn-primary">
            Go to lobby
          </Link>
        </div>
      )

    case 'cancelled':
      return (
        <div className="center-page">
          <h2>The creator cancelled this game</h2>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, textAlign: 'center' }}>
            Ask them to create a new invite and send you a fresh link.
          </p>
          <Link to="/play" className="btn btn-primary">
            Go to lobby
          </Link>
        </div>
      )

    case 'expired':
      return (
        <div className="center-page">
          <h2>This invite has expired</h2>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, textAlign: 'center' }}>
            Invites are valid for 24 hours — ask for a new link.
          </p>
          <Link to="/play" className="btn btn-primary">
            Go to lobby
          </Link>
        </div>
      )

    case 'full':
      return (
        <div className="center-page">
          <h2>This game is already full</h2>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, textAlign: 'center' }}>
            Someone else joined first. Ask your friend for a new invite link.
          </p>
          <Link to="/play" className="btn btn-primary">
            Go to lobby
          </Link>
        </div>
      )

    case 'finished':
      return (
        <div className="center-page">
          <h2>This game has already finished</h2>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, textAlign: 'center' }}>
            The invite was already used and the game was played out.
          </p>
          <Link to="/play" className="btn btn-primary">
            Go to lobby
          </Link>
        </div>
      )

    case 'creator-waiting':
      return (
        <div className="center-page" style={{ gap: 10 }}>
          <h2>You created this game</h2>
          <p style={{ color: 'var(--text-dim)', maxWidth: 430, textAlign: 'center' }}>
            Open the link in a different browser or send it to a friend — the game starts as soon as they join.
          </p>
          <button className="btn btn-primary" onClick={() => onGo(`/play/${view.gameId}`)}>
            Go to waiting room
          </button>
        </div>
      )

    case 'joinable':
      return (
        <div className="center-page" style={{ gap: 12 }}>
          <div className="card" style={{ width: 'min(420px, 92vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {creator ? (
                <Avatar seed={creator.avatar_seed} size={36} />
              ) : (
                <div className="spinner" />
              )}
              <div>
                <div style={{ fontWeight: 600 }}>
                  {creator ? `${creator.username} invited you to a game` : 'Loading the host…'}
                </div>
                <div className="hint" style={{ margin: 0 }}>
                  {view.tc.label} · {view.tc.type} · {view.rated ? 'Rated' : 'Casual'}
                </div>
              </div>
            </div>
            <div className="chip" style={{ justifyContent: 'space-between' }}>
              <span>You will play as</span>
              <b>{view.myColor === 'w' ? '⬜ White' : '⬛ Black'}</b>
            </div>
            {joinError && <p className="error-text" style={{ margin: 0 }}>{joinError}</p>}
            <button className="btn btn-primary btn-lg btn-block" onClick={() => void doJoin()} disabled={joining}>
              {joining ? 'Joining…' : 'Join game'}
            </button>
            <Link to="/play" className="btn btn-ghost btn-sm">
              Back to lobby
            </Link>
          </div>
        </div>
      )
  }
}
