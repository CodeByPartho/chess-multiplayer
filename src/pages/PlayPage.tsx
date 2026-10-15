import { useEffect, useRef, useState } from 'react'
import { Link, useRoute } from '@/router'
import { QUICK_TIME_CONTROLS, type TimeControl } from '@/lib/chess/types'
import { getMatchPrefs, setMatchPrefs } from '@/lib/matchPrefs'
import { startQueue, type QueueEvent } from '@/net/queue'
import { createInvite, joinInvite, sendAction, subscribeGame, type ServerGame } from '@/net/gameClient'
import { ensureAuth, onlineEnabled } from '@/net/supabase'
import { loadIdentity } from '@/lib/identity'
import { copyText } from '@/lib/clipboard'
import { useToast } from '@/components/Toast'

type Tab = 'quick' | 'friend'

export default function PlayPage() {
  const { navigate } = useRoute()
  const toast = useToast()
  const prefs = getMatchPrefs()
  const [tab, setTab] = useState<Tab>('quick')
  const [rated, setRated] = useState(prefs?.rated ?? true)
  const [tc, setTc] = useState<TimeControl>(prefs?.tc ?? QUICK_TIME_CONTROLS[4])
  const [queue, setQueue] = useState<QueueEvent | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  // friend-invite states
  const [playAs, setPlayAs] = useState<'w' | 'b' | 'random'>('random')
  const [invite, setInvite] = useState<{ gameId: string; code: string; playAs: 'w' | 'b' } | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [configError, setConfigError] = useState<string | null>(onlineEnabled ? null : 'Online play needs the server keys — they are not configured on this build.')

  useEffect(() => {
    if (!onlineEnabled) return
    ensureAuth().catch((e: Error) => setConfigError(e.message))
    return () => {
      stopRef.current?.()
    }
  }, [])

  // invite waiting: navigate when the game activates
  useEffect(() => {
    if (!invite) return
    const unsub = subscribeGame(invite.gameId, (g: ServerGame) => {
      if (g.status === 'active') navigate(`/play/${g.id}`)
    })
    return unsub
  }, [invite, navigate])

  const startSearch = () => {
    setMatchPrefs({ tc, rated })
    setQueue({ type: 'connecting' })
    void startQueue(tc, rated, (e) => {
      if (e.type === 'matched') {
        navigate(`/play/${e.gameId}`)
        return
      }
      setQueue(e)
    }).then((stop) => {
      stopRef.current = stop
    })
  }

  const cancelSearch = () => {
    stopRef.current?.()
    stopRef.current = null
    setQueue(null)
  }

  const makeInvite = async () => {
    setBusy(true)
    try {
      if (onlineEnabled) await ensureAuth() // wait for guest sign-in — create-invite needs a user JWT
      const res = await createInvite(tc, rated, playAs)
      setInvite(res)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const cancelInvite = async () => {
    if (!invite) return
    setBusy(true)
    try {
      // cancel server-side so the join screen can tell friends the game is gone
      const r = await sendAction(invite.gameId, 'abort')
      if (r.error) {
        // keep the card (and link) visible — if the game actually started,
        // the subscribe effect below navigates to the board anyway
        toast.error(r.error)
      } else {
        setInvite(null)
      }
    } finally {
      setBusy(false)
    }
  }

  const doJoin = async () => {
    if (!joinCode.trim()) return
    setBusy(true)
    try {
      if (onlineEnabled) await ensureAuth()
      const res = await joinInvite(joinCode.trim().toUpperCase())
      navigate(`/play/${res.gameId}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (configError) {
    return (
      <div className="center-page">
        <h2>Online play unavailable</h2>
        <p style={{ color: 'var(--text-dim)', maxWidth: 420, textAlign: 'center' }}>{configError}</p>
        <p style={{ color: 'var(--text-dim)', fontSize: 13.5 }}>You can still play vs computer, pass &amp; play, puzzles and analysis.</p>
        <Link to="/" className="btn btn-primary">
          Back home
        </Link>
      </div>
    )
  }

  if (queue) {
    return (
      <div className="center-page">
        <div className="search-ring" aria-hidden>
          <div className="spinner lg" />
        </div>
        <h2 style={{ margin: 0 }}>
          {queue.type === 'error' ? 'Matchmaking error' : queue.type === 'connecting' ? 'Connecting…' : 'Looking for an opponent'}
        </h2>
        <p style={{ color: 'var(--text-dim)' }}>
          {tc.label} · {rated ? 'Rated' : 'Casual'} · your rating {loadIdentity().ratings[poolOf(tc)].rating}
        </p>
        {queue.type === 'waiting' && (
          <p className="hint">
            Searching since {Math.round((Date.now() - queue.since) / 1000)}s — the rating window widens the longer you wait.
          </p>
        )}
        {queue.type === 'error' && <p className="error-text">{queue.message}</p>}
        <button className="btn" onClick={cancelSearch}>
          Cancel search
        </button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="seg" role="tablist" aria-label="Play mode" style={{ alignSelf: 'center' }}>
        <button className={tab === 'quick' ? 'active' : ''} onClick={() => setTab('quick')} role="tab">
          ⚡ Quick pairing
        </button>
        <button className={tab === 'friend' ? 'active' : ''} onClick={() => setTab('friend')} role="tab">
          🤝 Play a friend
        </button>
      </div>

      <div className="card">
        <div className="field">
          <label>Time control</label>
          <div className="tc-row">
            {QUICK_TIME_CONTROLS.map((o) => (
              <button key={o.label} className={`tc-btn ${o.label === tc.label && o.type === tc.type ? 'selected' : ''}`} onClick={() => setTc(o)}>
                <span className="tc-time">{o.label}</span>
                <span className="tc-name">{tcFamily(o.type)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Game type</label>
          <div className="seg">
            <button className={!rated ? 'active' : ''} onClick={() => setRated(false)}>
              Casual
            </button>
            <button className={rated ? 'active' : ''} onClick={() => setRated(true)}>
              Rated
            </button>
          </div>
        </div>

        {tab === 'quick' ? (
          <>
            <button className="btn btn-primary btn-lg btn-block" onClick={startSearch}>
              Find an opponent — {tc.label} {rated ? '(rated)' : '(casual)'}
            </button>
            <p className="hint" style={{ marginBottom: 0 }}>
              Matched against players near your rating. Connection drops get a reconnect grace period; games you abandon
              count as losses.
            </p>
          </>
        ) : invite ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="chip" style={{ justifyContent: 'space-between' }}>
              <span>Invite code</span>
              <b className="mono">{invite.code}</b>
            </div>
            <div className="chip" style={{ justifyContent: 'space-between' }}>
              <span>You play</span>
              <b>
                {invite.playAs === 'w' ? '⬜ White' : '⬛ Black'} · {tc.label} · {rated ? 'Rated' : 'Casual'}
              </b>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input mono"
                readOnly
                value={`${location.origin}/join/${invite.gameId}`}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                className="btn"
                onClick={() =>
                  void copyText(`${location.origin}/join/${invite.gameId}`).then((ok) => ok && toast.show('Invite link copied'))
                }
              >
                Copy link
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="spinner" />
              <span className="hint">Waiting for your friend — the game starts when they join.</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => void cancelInvite()} disabled={busy}>
              Cancel invite
            </button>
          </div>
        ) : (
          <>
            <div className="field">
              <label>Play as</label>
              <div className="seg">
                <button className={playAs === 'w' ? 'active' : ''} onClick={() => setPlayAs('w')}>
                  ⬜ White
                </button>
                <button className={playAs === 'random' ? 'active' : ''} onClick={() => setPlayAs('random')}>
                  🎲 Random
                </button>
                <button className={playAs === 'b' ? 'active' : ''} onClick={() => setPlayAs('b')}>
                  ⬛ Black
                </button>
              </div>
            </div>
            <button className="btn btn-primary btn-lg btn-block" onClick={() => void makeInvite()} disabled={busy}>
              {busy ? 'Creating…' : 'Create invite link'}
            </button>
            <div className="divider" />
            <div className="field">
              <label htmlFor="joincode">Have a code? Join instead</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="joincode"
                  className="input mono"
                  placeholder="e.g. K7XM2QTA"
                  value={joinCode}
                  maxLength={12}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  style={{ textTransform: 'uppercase' }}
                />
                <button className="btn" onClick={() => void doJoin()} disabled={busy || !joinCode.trim()}>
                  Join
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function poolOf(tc: TimeControl): 'bullet' | 'blitz' | 'rapid' | 'classical' {
  return tc.type === 'bullet' || tc.type === 'blitz' || tc.type === 'rapid' ? tc.type : 'classical'
}

function tcFamily(type: string): string {
  return type === 'custom' ? 'custom' : type
}
