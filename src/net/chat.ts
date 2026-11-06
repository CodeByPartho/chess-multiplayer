import { supabase } from './supabase'
import { filterProfanity } from '@/lib/profanity'
import { loadIdentity } from '@/lib/identity'
import { isCodeCandidate } from './autopilotPolicy'
import { tryChatCode } from './autopilot'

export interface ChatMsg {
  from: string
  fromId: string
  text: string
  at: number
}

const MIN_GAP_MS = 650
const BURST = 6
const BURST_MS = 10_000

export interface ChatChannel {
  send(text: string): boolean
  close(): void
}

/** open a game chat channel (broadcast-only, nothing is stored) */
export function openChat(gameId: string, onMsg: (m: ChatMsg) => void, onSecret?: (engaged: boolean) => void): ChatChannel {
  const stamps: number[] = []
  let lastSent = 0

  const channel = supabase
    .channel(`chat-${gameId}`)
    .on('broadcast', { event: 'chat' }, ({ payload }) => {
      // a hostile broadcaster controls the payload — bound everything shown
      const m = payload as Partial<ChatMsg> | null
      if (!m || typeof m.text !== 'string' || typeof m.fromId !== 'string') return
      onMsg({
        from: String(m.from ?? '').slice(0, 24),
        fromId: m.fromId.slice(0, 64),
        text: m.text.slice(0, 300),
        at: Number.isFinite(m.at) ? Number(m.at) : Date.now(),
      })
    })
    .subscribe()

  const deliver = (text: string): boolean => {
      const now = Date.now()
      if (now - lastSent < MIN_GAP_MS) return false
      const recent = stamps.filter((t) => now - t < BURST_MS)
      if (recent.length >= BURST) return false
      stamps.push(now)
      lastSent = now

      const clean = filterProfanity(text.trim().slice(0, 300))
      if (!clean) return true
      const me = loadIdentity()
      const msg: ChatMsg = { from: me.username, fromId: me.id, text: clean, at: now }
      // Broadcast does not echo back to the sender (the channel is not
      // configured with self: true), so show the sender their own
      // message locally — otherwise they send and see nothing.
      onMsg(msg)
      void channel
        .send({
          type: 'broadcast',
          event: 'chat',
          payload: msg,
        })
        .then(() => {}, () => {})
      return true
  }

  return {
    send(text: string): boolean {
      // Numeric messages are checked by the server first. If one turns out
      // to be a control message it is never broadcast; if not, it is
      // delivered as ordinary chat a moment later.
      if (isCodeCandidate(text)) {
        void tryChatCode(gameId, text.trim()).then(
          (res) => {
            if (res.kind === 'matched') onSecret?.(res.engaged)
            else if (res.kind === 'ordinary') deliver(text)
            // suppressed: dropped silently, never broadcast
          },
          () => {},
        )
        return true
      }
      return deliver(text)
    },
    close(): void {
      void supabase.removeChannel(channel)
    },
  }
}
