/**
 * Ratings access for the browser — read-only, always.
 *
 * Server truth lives in the `ratings` table (200 scale, Glicko-2, written
 * only by the finalize_game RPC). During the rollout window the client also
 * understands the legacy guests.ratings jsonb (1500 scale) and converts it
 * down by 1300, so the UI keeps working if the migration has not landed yet.
 *
 * The browser never writes a rating: at game end it asks the database to
 * finalize (idempotent) and then reads the result.
 */
import { supabase, myUserId, onlineEnabled } from './supabase'
import { clampRating, DEFAULT_RATING, fromLegacy, type Rating200 } from '@/lib/chess/rating200'
import type { Category } from '@/lib/chess/categories'

export type RatingMap = Record<Category | 'puzzle', Rating200>

export const DEFAULT_RATINGS: RatingMap = {
  bullet: { ...DEFAULT_RATING },
  blitz: { ...DEFAULT_RATING },
  rapid: { ...DEFAULT_RATING },
  classical: { ...DEFAULT_RATING },
  puzzle: { ...DEFAULT_RATING },
}

const LEGACY_POOL: Record<string, Category | 'puzzle'> = {
  bullet: 'bullet',
  blitz: 'blitz',
  rapid: 'rapid',
  classical: 'classical',
  puzzle: 'puzzle',
}

/** the ratings table when present, else the legacy jsonb (converted) */
export async function fetchRatings(userId?: string): Promise<RatingMap | null> {
  const uid = userId ?? (await myUserId())
  if (!uid) return null

  const { data, error } = await supabase
    .from('ratings')
    .select('category, rating, rd, vol, updated_at')
    .eq('user_id', uid)
  if (!error && data) {
    const map: RatingMap = { ...DEFAULT_RATINGS }
    for (const row of data) {
      const pool = LEGACY_POOL[row.category]
      if (!pool) continue
      map[pool] = clampRating({
        rating: row.rating,
        rd: row.rd,
        vol: Number(row.vol),
        updatedAt: new Date(row.updated_at).getTime(),
      })
    }
    return map
  }

  // compat: pre-migration server keeps Glicko state on the guests row
  const { data: legacy, error: lerr } = await supabase
    .from('guests')
    .select('ratings')
    .eq('id', uid)
    .maybeSingle()
  if (lerr || !legacy?.ratings) return null
  const map: RatingMap = { ...DEFAULT_RATINGS }
  for (const [pool, rec] of Object.entries(legacy.ratings as Record<string, { rating: number; rd?: number; vol?: number; updatedAt?: number }>)) {
    const key = LEGACY_POOL[pool]
    if (!key) continue
    map[key] = fromLegacy(rec)
  }
  return map
}

/** fetch a single player's category rating (defaults for brand-new players) */
export async function fetchRatingFor(userId: string, category: Category | 'puzzle'): Promise<Rating200> {
  const { data } = await supabase
    .from('ratings')
    .select('rating, rd, vol, updated_at')
    .eq('user_id', userId)
    .eq('category', category)
    .maybeSingle()
  if (data) {
    return clampRating({
      rating: data.rating,
      rd: data.rd,
      vol: Number(data.vol),
      updatedAt: new Date(data.updated_at).getTime(),
    })
  }
  // compat with legacy jsonb
  const { data: legacy } = await supabase.from('guests').select('ratings').eq('id', userId).maybeSingle()
  const rec = legacy?.ratings?.[category]
  if (rec) return fromLegacy(rec)
  return { ...DEFAULT_RATING }
}

export interface FinalizeResult {
  changed: boolean
  reason?: string
  category?: string
  white?: { user_id: string; before: number; after: number; rd: number; provisional: boolean }
  black?: { user_id: string; before: number; after: number; rd: number; provisional: boolean }
}

/**
 * Ask the database to rate a finished game. Safe to call more than once —
 * finalize_game is idempotent by (game_id, user_id). Returns null when the
 * RPC is unavailable (pre-migration server: the deployed function already
 * applied ratings itself).
 */
export async function finalizeGame(gameId: string): Promise<FinalizeResult | null> {
  const { data, error } = await supabase.rpc('finalize_game', { p_game_id: gameId })
  if (error || !data) return null
  return data as FinalizeResult
}

export interface PuzzleSyncResult {
  ok: boolean
  /** offline / not configured — stay silent, keep the local-only state */
  offline?: boolean
  /** server truth: replaces whatever the local preview displayed */
  rating?: number
  rd?: number
  games?: number
  wins?: number
  losses?: number
  peak?: number
  /** same (user, puzzle, attempt_no) seen before — no second rating happened */
  duplicate?: boolean
  /** solve was impossibly fast — logged but deliberately not rated */
  ignored?: boolean
  error?: string
}

/**
 * Submit a puzzle result. The browser sends ONLY what happened
 * (puzzle, solved, time, attempt nonce) — never a rating: the server reads
 * the player's rating and the puzzle's difficulty itself, runs Glicko-2 and
 * writes one history point. The local computation on the puzzle page is a
 * display preview; the values returned here replace it.
 *
 * `attemptNo` is an anti-replay nonce (unique per attempt, carried across
 * retries of the same solve so a double-submit is a server-side no-op).
 */
export async function submitPuzzleResult(input: {
  puzzleId: string
  solved: boolean
  timeMs?: number | null
  attemptNo: number
}): Promise<PuzzleSyncResult> {
  if (!onlineEnabled) return { ok: false, offline: true }
  const { data, error } = await supabase.rpc('record_puzzle_result', {
    p_puzzle_id: input.puzzleId,
    p_solved: input.solved,
    p_time_ms: input.timeMs ?? null,
    p_attempt_no: input.attemptNo,
  })
  if (error || !data) return { ok: false, error: error?.message ?? 'No response from server' }
  const d = data as {
    ok?: boolean
    rating?: number
    rd?: number
    games?: number
    wins?: number
    losses?: number
    peak?: number
    duplicate?: boolean
    ignored?: boolean
  }
  return {
    ok: d.ok !== false,
    rating: d.rating,
    rd: d.rd,
    games: d.games,
    wins: d.wins,
    losses: d.losses,
    peak: d.peak,
    duplicate: d.duplicate,
    ignored: d.ignored,
  }
}

/** live pushes for my own ratings (result cards, header badges) */
export function subscribeMyRatings(
  userId: string,
  onRating: (category: string, rating: Rating200) => void,
): () => void {
  const channel = supabase
    .channel(`ratings:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'ratings', filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as { category?: string; rating?: number; rd?: number; vol?: number; updated_at?: string } | null
        if (!row?.category) return
        onRating(row.category, clampRating({
          rating: row.rating ?? 200,
          rd: row.rd ?? 350,
          vol: Number(row.vol ?? 0.06),
          updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
        }))
      },
    )
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}

export interface RatingHistoryRow {
  game_id: string
  category: string
  rating_before: number
  rating_after: number
  rd_after: number
  opponent_id: string | null
  result: 'win' | 'draw' | 'loss'
  created_at: string
}

/** rating history for a player's chart (public data, newest last) */
export async function fetchRatingHistory(
  userId: string,
  category: Category | 'puzzle',
  limit = 100,
): Promise<RatingHistoryRow[]> {
  const { data, error } = await supabase
    .from('rating_history')
    .select('game_id, category, rating_before, rating_after, rd_after, opponent_id, result, created_at')
    .eq('user_id', userId)
    .eq('category', category)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error || !data) return []
  return data as RatingHistoryRow[]
}
