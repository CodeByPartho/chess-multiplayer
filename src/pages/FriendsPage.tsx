import { useCallback, useEffect, useState } from 'react'
import { Link, useRoute } from '@/router'
import { useToast } from '@/components/Toast'
import { Avatar } from '@/components/Avatar'
import { useAuth } from '@/net/auth'
import { onlineEnabled } from '@/net/supabase'
import { createInvite, fetchGame, joinInvite } from '@/net/gameClient'
import {
  acceptFriendRequest,
  createChallenge,
  deleteChallenge,
  fetchChallenges,
  fetchFriends,
  removeFriend,
  searchProfiles,
  sendFriendRequest,
  type Challenge,
  type FriendEntry,
} from '@/net/socialClient'
import type { ProfileRow } from '@/net/profileClient'
import type { TimeControl } from '@/lib/chess/types'

const CHALLENGE_TCS: { label: string; tc: TimeControl | null }[] = [
  { label: '5 + 0 Blitz', tc: { type: 'blitz', base: 300_000, inc: 0, label: '5 + 0' } },
  { label: '10 + 0 Rapid', tc: { type: 'rapid', base: 600_000, inc: 0, label: '10 + 0' } },
  { label: 'Correspondence', tc: null },
]

export default function FriendsPage() {
  const { navigate } = useRoute()
  const toast = useToast()
  const auth = useAuth()
  const [friends, setFriends] = useState<FriendEntry[]>([])
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProfileRow[]>([])
  const [tcIdx, setTcIdx] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [f, c] = await Promise.all([fetchFriends(), fetchChallenges()])
    setFriends(f)
    setChallenges(c)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = setTimeout(() => {
      void searchProfiles(query).then(setResults)
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  const signedIn = !!auth.user && !auth.isGuest && onlineEnabled
  const friendIds = new Set(friends.map((f) => f.other.id))

  const act = async (key: string, fn: () => Promise<void>, okMsg?: string) => {
    setBusy(key)
    try {
      await fn()
      if (okMsg) toast.show(okMsg)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(null)
  }

  const challenge = async (friend: ProfileRow) => {
    setBusy(`challenge-${friend.id}`)
    try {
      const pick = CHALLENGE_TCS[tcIdx]
      const created = await createInvite(pick.tc, false, 'random')
      await createChallenge(friend.id, created.gameId)
      toast.show(`Challenge sent to ${friend.username}`)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(null)
  }

  const acceptChallenge = async (c: Challenge) => {
    setBusy(`accept-${c.id}`)
    try {
      const game = await fetchGame(c.game_id)
      if (!game?.invite_code) throw new Error('That game is no longer waiting')
      const joined = await joinInvite(game.invite_code)
      await deleteChallenge(c.id)
      navigate(`/play/${joined.gameId}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(null)
  }

  if (!onlineEnabled) {
    return (
      <div className="page-narrow">
        <h1 className="page-title">Friends</h1>
        <p className="hint">Online play is not configured on this build.</p>
      </div>
    )
  }

  const incoming = challenges.filter((c) => c.direction === 'in')
  const accepted = friends.filter((f) => f.status === 'accepted')
  const pendingIn = friends.filter((f) => f.status === 'pending-in')
  const pendingOut = friends.filter((f) => f.status === 'pending-out')

  return (
    <div className="page-narrow">
      <h1 className="page-title">Friends</h1>
      {!signedIn && (
        <p className="hint" style={{ marginBottom: 12 }}>
          You are playing as a guest. <Link to="/login">Sign in</Link> to add friends, challenge them and keep the list
          across devices.
        </p>
      )}

      {incoming.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 14, borderColor: 'var(--accent)' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Challenges for you</h3>
          {incoming.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', flexWrap: 'wrap' }}>
              <b>{c.fromName}</b>
              <span className="hint">wants a game</span>
              <button className="btn btn-sm btn-primary" disabled={busy === `accept-${c.id}`} onClick={() => void acceptChallenge(c)}>
                Play
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => void act(`del-${c.id}`, () => deleteChallenge(c.id))}>
                Decline
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Find players</h3>
        <input
          className="input"
          placeholder="Search by username…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />
        {results.map((p) => (
          <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
            <Avatar seed={p.avatar_seed} path={p.avatar_path} name={p.username} size={24} />
            <Link to={`/@${p.username}`}>{p.username}</Link>
            <span style={{ marginLeft: 'auto' }}>
              {friendIds.has(p.id) ? (
                <span className="hint">connected</span>
              ) : (
                <button
                  className="btn btn-sm"
                  disabled={!signedIn || busy === `add-${p.id}`}
                  onClick={() => void act(`add-${p.id}`, () => sendFriendRequest(p.id), 'Request sent')}
                >
                  Add friend
                </button>
              )}
            </span>
          </div>
        ))}
        {query.trim().length >= 2 && results.length === 0 && <p className="hint">No players match that name.</p>}
      </div>

      {pendingIn.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Requests</h3>
          {pendingIn.map((f) => (
            <div key={f.other.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
              <Avatar seed={f.other.avatar_seed} path={f.other.avatar_path} name={f.other.username} size={24} />
              <span>{f.other.username}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn btn-sm btn-primary" onClick={() => void act(`acc-${f.other.id}`, () => acceptFriendRequest(f.other.id))}>
                  Accept
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => void act(`dec-${f.other.id}`, () => removeFriend(f.other.id))}>
                  Decline
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Your friends</h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <span className="hint">Challenge at</span>
          {CHALLENGE_TCS.map((t, i) => (
            <button key={t.label} className={`btn btn-sm ${tcIdx === i ? 'btn-primary' : ''}`} onClick={() => setTcIdx(i)}>
              {t.label}
            </button>
          ))}
        </div>
        {accepted.length === 0 && pendingOut.length === 0 && <p className="hint">No friends yet. Search above and send a request.</p>}
        {accepted.map((f) => (
          <div key={f.other.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', flexWrap: 'wrap' }}>
            <Avatar seed={f.other.avatar_seed} path={f.other.avatar_path} name={f.other.username} size={24} />
            <Link to={`/@${f.other.username}`}>{f.other.username}</Link>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <Link to={`/messages/${f.other.id}`} className="btn btn-sm">
                Message
              </Link>
              <button className="btn btn-sm btn-primary" disabled={busy === `challenge-${f.other.id}`} onClick={() => void challenge(f.other)}>
                Challenge
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => void act(`rm-${f.other.id}`, () => removeFriend(f.other.id))}>
                Remove
              </button>
            </span>
          </div>
        ))}
        {pendingOut.map((f) => (
          <div key={f.other.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
            <Avatar seed={f.other.avatar_seed} path={f.other.avatar_path} name={f.other.username} size={24} />
            <span>{f.other.username}</span>
            <span className="hint" style={{ marginLeft: 'auto' }}>
              request sent
            </span>
          </div>
        ))}
      </div>

      <p className="hint">
        Prefer a link anyone can open? Create one in the <Link to="/play">lobby</Link> or start a{' '}
        <Link to="/correspondence">correspondence game</Link>.
      </p>
    </div>
  )
}
