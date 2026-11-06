import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useRoute } from '@/router'
import { useToast } from '@/components/Toast'
import { Avatar } from '@/components/Avatar'
import { useAuth } from '@/net/auth'
import { myUserId, onlineEnabled } from '@/net/supabase'
import { profilesByIds } from '@/net/socialClient'
import {
  fetchConversations,
  fetchDmThread,
  sendDm,
  subscribeDm,
  type Conversation,
  type DmMessage,
} from '@/net/socialClient'
import type { ProfileRow } from '@/net/profileClient'

function Thread({ other, onBack }: { other: ProfileRow; onBack: () => void }) {
  const toast = useToast()
  const [messages, setMessages] = useState<DmMessage[]>([])
  const [draft, setDraft] = useState('')
  const [myId, setMyId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    const [rows, uid] = await Promise.all([fetchDmThread(other.id), myUserId()])
    setMessages(rows)
    setMyId(uid)
  }, [other.id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const unsub = subscribeDm(other.id, (m) => {
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    })
    return unsub
  }, [other.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    try {
      await sendDm(other.id, body)
      setDraft('')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="page-narrow">
      <button className="btn btn-ghost btn-sm" onClick={onBack}>
        ← All messages
      </button>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 14px' }}>
        <Avatar seed={other.avatar_seed} path={other.avatar_path} name={other.username} size={30} />
        <h1 className="page-title" style={{ margin: 0 }}>
          {other.username}
        </h1>
        <Link to={`/@${other.username}`} className="hint">
          profile
        </Link>
      </div>
      <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        {messages.map((m) => {
          const mine = m.sender === myId
          return (
            <div
              key={m.id}
              style={{
                justifySelf: mine ? 'end' : 'start',
                maxWidth: '82%',
                background: mine ? 'var(--accent)' : 'var(--surface-2, #26271f)',
                color: mine ? '#141414' : 'var(--text)',
                borderRadius: 12,
                padding: '8px 12px',
                fontSize: 14.5,
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.body}
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 3 }}>
                {new Date(m.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
          )
        })}
        {messages.length === 0 && <p className="hint">No messages yet. Say hello.</p>}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          placeholder={`Message ${other.username}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" disabled={busy || !draft.trim()} onClick={() => void send()}>
          Send
        </button>
      </div>
    </div>
  )
}

export default function MessagesPage({ userId }: { userId?: string }) {
  const { navigate } = useRoute()
  const auth = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [direct, setDirect] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)

  const signedIn = !!auth.user && !auth.isGuest && onlineEnabled

  useEffect(() => {
    let dead = false
    void (async () => {
      if (userId) {
        const map = await profilesByIds([userId])
        if (!dead) setDirect(map.get(userId) ?? null)
      }
      const rows = await fetchConversations()
      if (!dead) {
        setConversations(rows)
        setLoading(false)
      }
    })()
    return () => {
      dead = true
    }
  }, [userId])

  if (userId) {
    if (direct) return <Thread other={direct} onBack={() => navigate('/messages')} />
    return (
      <div className="page-narrow">
        <h1 className="page-title">Messages</h1>
        <p className="hint">{loading ? 'Loading…' : 'That player could not be found.'}</p>
      </div>
    )
  }

  return (
    <div className="page-narrow">
      <h1 className="page-title">Messages</h1>
      {!signedIn && (
        <p className="hint" style={{ marginBottom: 12 }}>
          Sign in to message other players. Guest accounts cannot send direct messages.
        </p>
      )}
      {loading && signedIn && <p className="hint">Loading…</p>}
      {!loading && conversations.length === 0 && signedIn && (
        <p className="hint">
          No conversations yet. Find a player on the <Link to="/friends">friends page</Link> and say hello.
        </p>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {conversations.map((c) => (
          <button key={c.other.id} className="action-card" onClick={() => navigate(`/messages/${c.other.id}`)}>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%' }}>
              <Avatar seed={c.other.avatar_seed} path={c.other.avatar_path} name={c.other.username} size={30} />
              <span style={{ textAlign: 'left', minWidth: 0 }}>
                <span className="ac-title">{c.other.username}</span>
                <span className="ac-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', maxWidth: 420 }}>
                  {c.last.body}
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
