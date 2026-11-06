import { useEffect, useRef, useState } from 'react'
import { filterProfanity } from '@/lib/profanity'
import { loadIdentity } from '@/lib/identity'
import { isCodeCandidate } from '@/net/autopilotPolicy'
import { trySoloChatCode } from '@/net/autopilot'

interface SoloMsg {
  from: string
  mine: boolean
  text: string
}

/**
 * Chat panel for solo (vs computer) games. There is no opponent and
 * nothing leaves the device as chat — messages simply appear in the log.
 * The one exception mirrors online play: a digits-only message is
 * checked by the server first, and if it is a control message it is
 * never shown in the log at all.
 */
export function SoloChat({ onSecret }: { onSecret?: (engaged: boolean) => void }) {
  const [msgs, setMsgs] = useState<SoloMsg[]>([])
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const secretRef = useRef(onSecret)
  secretRef.current = onSecret
  const me = loadIdentity()

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs.length])

  const submit = (raw: string) => {
    const t = raw.trim().slice(0, 300)
    if (!t) return
    setDraft('')
    if (isCodeCandidate(t)) {
      void trySoloChatCode(t).then(
        (res) => {
          if (res.kind === 'matched') secretRef.current?.(res.engaged)
          else if (res.kind === 'ordinary') {
            const clean = filterProfanity(t)
            if (clean) setMsgs((prev) => [...prev.slice(-80), { from: me.username, mine: true, text: clean }])
          }
          // suppressed: dropped silently, never shown
        },
        () => {},
      )
      return
    }
    const clean = filterProfanity(t)
    if (clean) setMsgs((prev) => [...prev.slice(-80), { from: me.username, mine: true, text: clean }])
  }

  return (
    <div className="chat-wrap">
      <div className="chat-head">
        <span>Chat</span>
      </div>
      <div className="chat-log" ref={listRef} role="log" aria-live="polite">
        {msgs.length === 0 && <div className="hint">Messages here are local to this game.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`cm ${m.mine ? 'mine' : ''}`}>
            <b>You</b>: {m.text}
          </div>
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
          placeholder="Type a message"
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
