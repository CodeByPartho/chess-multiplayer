import type { TimeControl } from '@/lib/chess/types'
import { ensureAuth, syncGuestProfile, supabase } from './supabase'
import { fetchRatingFor, fetchRatings } from './ratingsClient'
import { loadIdentity, saveIdentity, type Pool } from '@/lib/identity'
import { categoryOf } from '@/lib/chess/categories'

export type QueueEvent =
  | { type: 'connecting' }
  | { type: 'waiting'; since: number; window: number }
  | { type: 'matched'; gameId: string; color: 'w' | 'b'; notice?: string }
  | { type: 'error'; message: string }

const POLL_MS = 2500

/** the player's rating for this category — server value, else local seed */
async function myRatingFor(tc: TimeControl): Promise<number> {
  const category = categoryOf(tc)
  const uid = await supabase.auth.getUser().then((r) => r.data.user?.id ?? null).catch(() => null)
  if (uid) {
    const r = await fetchRatingFor(uid, category).catch(() => null)
    if (r) return Math.round(r.rating)
  }
  const local = loadIdentity().ratings[category]
  return Math.round(local?.rating ?? 200)
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
      const res = data as { status: string; game_id?: string; color?: 'w' | 'b'; notice?: string; window?: number }
      if (res.status === 'matched' && res.game_id) {
        onEvent({ type: 'matched', gameId: res.game_id, color: res.color ?? 'w', notice: res.notice })
        return
      }
      if (!waitingSince) waitingSince = Date.now()
      onEvent({ type: 'waiting', since: waitingSince, window: res.window ?? 100 })
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

/** merge server ratings into the local identity (post-game / on login) */
export async function syncRatingsToLocal(lastPool?: Pool): Promise<void> {
  const server = await fetchRatings()
  if (!server) return
  const identity = loadIdentity()
  for (const pool of ['bullet', 'blitz', 'rapid', 'classical'] as const) {
    const s = server[pool]
    if (s && typeof s.rating === 'number') {
      identity.ratings[pool] = { ...s }
    }
  }
  if (lastPool && lastPool !== 'puzzle') identity.lastPool = lastPool
  saveIdentity(identity)
}
