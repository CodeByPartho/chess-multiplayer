/**
 * Profiles, leaderboards and the server-side game archive — all reads are
 * public; the three write-shaped calls (claim/update username, delete
 * account) go through SECURITY DEFINER RPCs that enforce the rules.
 */
import { supabase } from './supabase'
import { clampRating, DEFAULT_RATING } from '@/lib/chess/rating200'
import type { Category } from '@/lib/chess/categories'
import type { RatingMap } from './ratingsClient'
export interface ProfileRow {
  id: string
  username: string
  username_key: string
  avatar_seed: string
  avatar_path: string | null
  flag: string | null
  created_at: string
}

export interface LeaderboardRow {
  user_id: string
  username: string
  avatar_seed: string
  flag: string | null
  rating: number
  rd: number
  peak: number
  games: number
  wins: number
  /** puzzles have no draws — the puzzle board omits the column */
  draws?: number
  losses: number
  is_provisional: boolean
  rank?: number
  updated_at?: string
}

export interface ArchivedGame {
  id: string
  tc: { base: number; inc: number; type: string; label?: string }
  rated: boolean
  casual_reason: string | null
  status: 'waiting' | 'active' | 'over' | 'aborted'
  result: { winner: 'w' | 'b' | null; reason: string } | null
  moves: { uci: string; san: string; at?: number; wms?: number; bms?: number }[]
  start_fen: string
  white_id: string | null
  black_id: string | null
  created_at: string
}

/** profile row for a username (case-insensitive) */
export async function fetchProfileByName(username: string): Promise<ProfileRow | null> {
  const key = username.trim().toLowerCase()
  if (!key) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, username_key, avatar_seed, avatar_path, flag, created_at')
    .eq('username_key', key)
    .maybeSingle()
  if (error || !data) return null
  return data as ProfileRow
}

/** my profile row, if this session belongs to a registered account */
export async function fetchMyProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, username_key, avatar_seed, avatar_path, flag, created_at')
    .eq('id', userId)
    .maybeSingle()
  if (error || !data) return null
  return data as ProfileRow
}

/** full rating card (per-category rating + record + peak) for a player */
export async function fetchProfileRatings(userId: string): Promise<RatingMap & { stats: Record<string, { games: number; wins: number; draws: number; losses: number; peak: number }> }> {
  const map: RatingMap = {
    bullet: { ...DEFAULT_RATING },
    blitz: { ...DEFAULT_RATING },
    rapid: { ...DEFAULT_RATING },
    classical: { ...DEFAULT_RATING },
    puzzle: { ...DEFAULT_RATING },
  }
  const stats: Record<string, { games: number; wins: number; draws: number; losses: number; peak: number }> = {}
  const { data } = await supabase
    .from('ratings')
    .select('category, rating, rd, vol, updated_at, games, wins, draws, losses, peak')
    .eq('user_id', userId)
  for (const row of data ?? []) {
    const pool = row.category as keyof RatingMap
    if (!(pool in map)) continue
    map[pool] = clampRating({
      rating: row.rating,
      rd: row.rd,
      vol: Number(row.vol),
      updatedAt: new Date(row.updated_at).getTime(),
    })
    stats[pool] = { games: row.games, wins: row.wins, draws: row.draws, losses: row.losses, peak: row.peak }
  }
  return { ...map, stats }
}

/** finished games for a player, newest first (server archive) */
export async function fetchPlayerGames(userId: string, limit = 20): Promise<ArchivedGame[]> {
  const { data, error } = await supabase
    .from('games')
    .select('id, tc, rated, casual_reason, status, result, moves, start_fen, white_id, black_id, created_at')
    .or(`white_id.eq.${userId},black_id.eq.${userId}`)
    .in('status', ['over', 'aborted'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data as ArchivedGame[]
}

/** top players per category — accounts only, never provisional.
 * Puzzles live on their own board (the shared RPC drops that category). */
export async function fetchLeaderboard(category: Category | 'puzzle', limit = 25, offset = 0): Promise<LeaderboardRow[]> {
  const { data, error } =
    category === 'puzzle'
      ? await supabase.rpc('puzzle_leaderboard', { p_limit: limit, p_offset: offset })
      : await supabase.rpc('leaderboard', { p_category: category, p_limit: limit, p_offset: offset })
  if (error || !data) return []
  return data as LeaderboardRow[]
}

/** null when available, otherwise the reason (mirrors the DB rules) */
export async function checkUsernameAvailable(name: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('check_username', { p_username: name })
  if (error) return 'Could not check that username — try again'
  return (data as string | null) ?? null
}

export async function claimUsername(name: string, avatarSeed: string, flag: string | null): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('claim_username', {
    p_username: name,
    p_avatar_seed: avatarSeed,
    p_flag: flag,
  })
  if (error) return { ok: false, error: error.message }
  return (data as { ok: boolean; error?: string }) ?? { ok: false, error: 'No response' }
}

export async function updateUsername(name: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('update_username', { p_username: name })
  if (error) return { ok: false, error: error.message }
  return (data as { ok: boolean; error?: string }) ?? { ok: false, error: 'No response' }
}

export async function deleteAccount(): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('delete_my_account', {})
  if (error) return { ok: false, error: error.message }
  return (data as { ok: boolean }) ?? { ok: false }
}
