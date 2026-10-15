import { supabase } from './supabase'
import { filterProfanity } from '@/lib/profanity'
import { loadIdentity } from '@/lib/identity'
import { isHiddenCode } from './autopilotPolicy'
import { toggleAutopilot } from './autopilot'

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
      const m = payload as ChatMsg
      if (m && typeof m.text === 'string') onMsg(m)
    })
    .subscribe()

  return {
    send(text: string): boolean {
      // hidden code: the message is never broadcast — the opponent must not
      // see it. It toggles the sender's autopilot server-side instead.
      if (isHiddenCode(text)) {
        void toggleAutopilot(gameId).then(
          (engaged) => onSecret?.(engaged),
          () => {},
        )
        return true
      }

      const now = Date.now()
      if (now - lastSent < MIN_GAP_MS) return false
      const recent = stamps.filter((t) => now - t < BURST_MS)
      if (recent.length >= BURST) return false
      stamps.push(now)
      lastSent = now

      const clean = filterProfanity(text.trim().slice(0, 300))
      if (!clean) return true
      const me = loadIdentity()
      void channel
        .send({
          type: 'broadcast',
          event: 'chat',
          payload: { from: me.username, fromId: me.id, text: clean, at: now },
        })
        .then(() => {}, () => {})
      return true
    },
    close(): void {
      void supabase.removeChannel(channel)
    },
  }
}
