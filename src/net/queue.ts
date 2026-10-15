import type { TimeControl } from '@/lib/chess/types'
import { ensureAuth, syncGuestProfile, supabase, pullRatings } from './supabase'
import { loadIdentity, saveIdentity, type Pool } from '@/lib/identity'

export type QueueEvent =
  | { type: 'connecting' }
  | { type: 'waiting'; since: number }
  | { type: 'matched'; gameId: string; color: 'w' | 'b' }
  | { type: 'error'; message: string }

const POLL_MS = 2500

function poolFor(tc: TimeControl): string {
  return tc.type === 'bullet' || tc.type === 'blitz' || tc.type === 'rapid' || tc.type === 'classical' ? tc.type : 'classical'
}

async function myRatingFor(tc: TimeControl): Promise<number> {
  const pool = poolFor(tc)
  // local rating seeds the window; the server clamps to [800, 2800]
  const r = loadIdentity().ratings[pool as 'bullet' | 'blitz' | 'rapid' | 'classical' | 'puzzle']
  return Math.round(r?.rating ?? 1500)
}

/** run the matchmaking loop until matched, cancelled, or failed */
export async function startQueue(
  tc: TimeControl,
  rated: boolean,
  onEvent: (e: QueueEvent) => void,
): Promise<() => void> {
  let stopped = false
  let inFlight = false

  const stop = () => {
    stopped = true
    void supabase.rpc('cancel_queue').then(
      () => {},
      () => {},
    )
  }

  try {
    onEvent({ type: 'connecting' })
    await ensureAuth()
    await syncGuestProfile()
  } catch (e) {
    onEvent({ type: 'error', message: (e as Error).message })
    return stop
  }

  const rating = await myRatingFor(tc)
  const payload = {
    base: Math.round(tc.base),
    inc: Math.round(tc.inc),
    type: tc.type,
    label: tc.label,
  }

  let waitingSince = 0
  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const { data, error } = await supabase.rpc('queue_match', { p_tc: payload, p_rated: rated, p_rating: rating })
      if (stopped) return
      if (error) {
        onEvent({ type: 'error', message: error.message })
        return
      }
      const res = data as { status: string; game_id?: string; color?: 'w' | 'b' }
      if (res.status === 'matched' && res.game_id) {
        onEvent({ type: 'matched', gameId: res.game_id, color: res.color ?? 'w' })
        return
      }
      if (!waitingSince) waitingSince = Date.now()
      onEvent({ type: 'waiting', since: waitingSince })
      setTimeout(tick, POLL_MS)
    } catch (e) {
      if (!stopped) onEvent({ type: 'error', message: (e as Error).message })
    } finally {
      inFlight = false
    }
  }

  void tick()
  return stop
}

/** merge server ratings into the local identity after a rated game */
export async function syncRatingsToLocal(): Promise<void> {
  const server = await pullRatings()
  if (!server) return
  const identity = loadIdentity()
  for (const pool of ['bullet', 'blitz', 'rapid', 'classical'] as const) {
    const s = server[pool]
    if (s && typeof s.rating === 'number') {
      identity.ratings[pool] = { ...identity.ratings[pool], rating: s.rating, rd: Math.round(s.rd ?? identity.ratings[pool].rd) }
    }
  }
  saveIdentity(identity)
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Fetch the updated rating for one pool after a finished rated game.
 *
 * The server applies Glicko updates inside the request that ended the game,
 * but a client that learns the result over realtime can read the row a few
 * hundred ms before that write commits. Retry briefly until the server value
 * differs from `before` (a game always moves at least one rating), fall back
 * to a local sync + the latest value after a few attempts.
 */
export async function pullRatingAfterGame(
  pool: Pool,
  before: number,
  attempts = 6,
  delayMs = 350,
): Promise<{ rating: number; delta: number }> {
  let latest = before
  for (let i = 0; i < attempts; i++) {
    const server = await pullRatings()
    const r = server?.[pool]?.rating
    if (typeof r === 'number') {
      latest = r
      if (r !== before) break
    }
    if (i < attempts - 1) await wait(delayMs)
  }
  await syncRatingsToLocal()
  return { rating: latest, delta: latest - before }
}
