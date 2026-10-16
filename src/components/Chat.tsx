import { useEffect, useRef, useState } from 'react'
import { openChat, type ChatMsg } from '@/net/chat'
import { loadIdentity } from '@/lib/identity'

const EMOJI = ['👍', 'gg', '😅', '🔥', '🤔', '👋', '🫡', '😤']

export function Chat({
  gameId,
  onReport,
  muted,
  onToggleMute,
}: {
  gameId: string
  onReport: () => void
  muted: boolean
  onToggleMute: () => void
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [draft, setDraft] = useState('')
  const [blocked, setBlocked] = useState(false)
  const channelRef = useRef<ReturnType<typeof openChat> | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const lastMineRef = useRef(false)
  const me = loadIdentity()

  useEffect(() => {
    if (muted) return
    const ch = openChat(gameId, (m) => {
      lastMineRef.current = m.fromId === me.id
      setMsgs((prev) => [...prev.slice(-80), m])
    })
    channelRef.current = ch
    return () => {
      ch.close()
      channelRef.current = null
    }
  }, [gameId, muted]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    // scroll only this panel, and only when the user is already near the
    // bottom (or it is their own message) — never yank the page around
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90
    if (nearBottom || lastMineRef.current) el.scrollTop = el.scrollHeight
  }, [msgs.length])

  const submit = (text: string) => {
    const t = text.trim()
    if (!t) return
    const ok = channelRef.current?.send(t) ?? false
    if (!ok) {
      setBlocked(true)
      setTimeout(() => setBlocked(false), 1600)
      return
    }
    setDraft('')
  }

  if (muted) {
    return (
      <div className="chat-wrap muted">
        <div className="chat-head">
          <span>Chat</span>
          <button className="btn btn-sm btn-ghost" onClick={onToggleMute}>
            Unmute
          </button>
        </div>
        <p className="hint" style={{ padding: 10, margin: 0 }}>
          Chat is muted. You won&apos;t see messages from your opponent.
        </p>
      </div>
    )
  }

  return (
    <div className="chat-wrap">
      <div className="chat-head">
        <span>Chat</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button className="btn btn-sm btn-ghost" onClick={onToggleMute} title="Mute chat">
            🔕
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onReport} title="Report opponent">
            🚩
          </button>
        </span>
      </div>
      <div className="chat-log" ref={listRef} role="log" aria-live="polite">
        {msgs.length === 0 && <div className="hint">Say hi — messages disappear when you leave.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`cm ${m.fromId === me.id ? 'mine' : ''}`}>
            <b>{m.fromId === me.id ? 'You' : m.from}</b>: {m.text}
          </div>
        ))}
      </div>
      <div className="chat-reactions">
        {EMOJI.map((e) => (
          <button key={e} onClick={() => submit(e)} aria-label={`Send ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          submit(draft)
        }}
      >
        <input
          className="input"
          placeholder={blocked ? 'Slow down…' : 'Type a message'}
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Chat message"
        />
        <button className="btn btn-sm" type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
