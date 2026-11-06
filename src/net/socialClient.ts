/**
 * The social layer: friends, challenges, spectating, tournaments,
 * leagues, simuls, clubs, forums and direct messages. Reads and writes
 * go through the RLS policies and SECURITY DEFINER RPCs installed by
 * migration 0024. Everything fails soft (empty results, no throws to
 * the UI) except the few calls whose error message the user needs.
 */
import { supabase, onlineEnabled, ensureAuth, myUserId } from './supabase'
import type { ProfileRow } from './profileClient'
import type { ServerGame } from './gameClient'
import type { TimeControl } from '@/lib/chess/types'

async function me(): Promise<string | null> {
  await ensureAuth()
  return myUserId()
}

export async function profilesByIds(ids: string[]): Promise<Map<string, ProfileRow>> {
  const out = new Map<string, ProfileRow>()
  if (!onlineEnabled || ids.length === 0) return out
  const { data } = await supabase.from('profiles').select('*').in('id', [...new Set(ids)])
  for (const p of (data as ProfileRow[]) ?? []) out.set(p.id, p)
  return out
}

export async function searchProfiles(query: string): Promise<ProfileRow[]> {
  if (!onlineEnabled || query.trim().length < 2) return []
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .ilike('username', `%${query.trim()}%`)
    .order('username')
    .limit(10)
  return (data as ProfileRow[]) ?? []
}

/* ---------------- friends ---------------- */

export interface FriendEntry {
  other: ProfileRow
  status: 'accepted' | 'pending-out' | 'pending-in'
}

export async function fetchFriends(): Promise<FriendEntry[]> {
  const uid = await me()
  if (!uid || !onlineEnabled) return []
  const { data } = await supabase.from('friendships').select('*').or(`requester.eq.${uid},addressee.eq.${uid}`)
  const rows = (data as { requester: string; addressee: string; status: string }[]) ?? []
  const profiles = await profilesByIds(rows.map((r) => (r.requester === uid ? r.addressee : r.requester)))
  const out: FriendEntry[] = []
  for (const r of rows) {
    const otherId = r.requester === uid ? r.addressee : r.requester
    const other = profiles.get(otherId)
    if (!other) continue
    out.push({
      other,
      status: r.status === 'accepted' ? 'accepted' : r.requester === uid ? 'pending-out' : 'pending-in',
    })
  }
  return out.sort((a, b) => a.other.username.localeCompare(b.other.username))
}

export async function sendFriendRequest(toUserId: string): Promise<void> {
  const uid = await me()
  if (!uid) throw new Error('Sign in first')
  const { error } = await supabase.from('friendships').insert({ requester: uid, addressee: toUserId })
  if (error) throw new Error(error.message)
}

export async function acceptFriendRequest(fromUserId: string): Promise<void> {
  const uid = await me()
  if (!uid) throw new Error('Sign in first')
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('requester', fromUserId)
    .eq('addressee', uid)
  if (error) throw new Error(error.message)
}

export async function removeFriend(otherUserId: string): Promise<void> {
  const uid = await me()
  if (!uid) return
  await supabase
    .from('friendships')
    .delete()
    .or(
      `and(requester.eq.${uid},addressee.eq.${otherUserId}),and(requester.eq.${otherUserId},addressee.eq.${uid})`,
    )
}

/* ---------------- challenges ---------------- */

export interface Challenge {
  id: string
  from_user: string
  to_user: string
  game_id: string
  created_at: string
  fromName: string
  direction: 'in' | 'out'
}

export async function fetchChallenges(): Promise<Challenge[]> {
  const uid = await me()
  if (!uid || !onlineEnabled) return []
  const { data } = await supabase
    .from('challenges')
    .select('*')
    .or(`from_user.eq.${uid},to_user.eq.${uid}`)
    .order('created_at', { ascending: false })
    .limit(30)
  const rows = (data as Omit<Challenge, 'fromName' | 'direction'>[]) ?? []
  const profiles = await profilesByIds(rows.map((r) => r.from_user))
  return rows.map((r) => ({
    ...r,
    fromName: profiles.get(r.from_user)?.username ?? 'A player',
    direction: r.to_user === uid ? ('in' as const) : ('out' as const),
  }))
}

export async function createChallenge(toUserId: string, gameId: string): Promise<void> {
  const uid = await me()
  if (!uid) throw new Error('Sign in first')
  const { error } = await supabase.from('challenges').insert({ from_user: uid, to_user: toUserId, game_id: gameId })
  if (error) throw new Error(error.message)
}

export async function deleteChallenge(id: string): Promise<void> {
  await supabase.from('challenges').delete().eq('id', id)
}

/* ---------------- spectating ---------------- */

export interface LiveGameRow {
  id: string
  white_name: string
  black_name: string
  tc_label: string
  rated: boolean
  moves_count: number
  fen: string
  turn: string
  updated_at: string
}

export async function fetchLiveGames(): Promise<LiveGameRow[]> {
  if (!onlineEnabled) return []
  const { data } = await supabase.rpc('watch_live_games', { p_limit: 24 })
  return (data as LiveGameRow[]) ?? []
}

export async function fetchWatchGame(gameId: string): Promise<ServerGame | null> {
  if (!onlineEnabled) return null
  const { data } = await supabase.rpc('watch_game', { p_game_id: gameId })
  return (data as ServerGame) ?? null
}

/* ---------------- tournaments ---------------- */

export interface Tournament {
  id: string
  name: string
  starts_at: string
  ends_at: string
  tc: TimeControl
  created_by: string | null
}

export interface StandingRow {
  user_id: string
  username: string
  points: number
  wins: number
  games: number
}

export async function fetchTournaments(): Promise<Tournament[]> {
  if (!onlineEnabled) return []
  const { data } = await supabase.from('tournaments').select('*').order('starts_at', { ascending: false }).limit(20)
  return (data as Tournament[]) ?? []
}

export async function createTournament(name: string, hours: number, tc: TimeControl): Promise<void> {
  const uid = await me()
  if (!uid) throw new Error('Sign in first')
  const now = Date.now()
  const { error } = await supabase.from('tournaments').insert({
    name,
    starts_at: new Date(now).toISOString(),
    ends_at: new Date(now + hours * 3_600_000).toISOString(),
    tc,
    created_by: uid,
  })
  if (error) throw new Error(error.message)
}

export async function fetchStandings(tournamentId: string): Promise<StandingRow[]> {
  if (!onlineEnabled) return []
  const { data } = await supabase
    .from('tournament_points')
    .select('user_id, points, wins, games')
    .eq('tournament_id', tournamentId)
    .order('points', { ascending: false })
    .limit(30)
  const rows = (data as Omit<StandingRow, 'username'>[]) ?? []
  const profiles = await profilesByIds(rows.map((r) => r.user_id))
  return rows.map((r) => ({ ...r, username: profiles.get(r.user_id)?.username ?? 'Guest' }))
}

/** Score one of my finished games into an arena. Throws with the server's reason. */
export async function recordTournamentGame(tournamentId: string, gameId: string): Promise<void> {
  const { error } = await supabase.rpc('record_tournament_game', { p_tournament: tournamentId, p_game: gameId })
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''))
}

/** My finished games in a window (for the arena "score my games" button). */
export async function fetchMyFinishedGames(sinceIso: string, limit = 30): Promise<ServerGame[]> {
  const uid = await me()
  if (!uid || !onlineEnabled) return []
  const { data } = await supabase
    .from('games')
    .select('*')
    .or(`white_id.eq.${uid},black_id.eq.${uid}`)
    .eq('status', 'over')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data as ServerGame[]) ?? []
}

/* ---------------- leagues ---------------- */

export interface LeagueRow {
  user_id: string
  username: string
  wins: number
  games: number
}

export async function fetchLeague(): Promise<LeagueRow[]> {
  if (!onlineEnabled) return []
  const { data } = await supabase.rpc('league_standings', { p_limit: 30 })
  return (data as LeagueRow[]) ?? []
}

export const LEAGUE_TIERS = [
  { name: 'Wood', min: 0 },
  { name: 'Bronze', min: 1 },
  { name: 'Silver', min: 3 },
  { name: 'Gold', min: 5 },
  { name: 'Platinum', min: 8 },
  { name: 'Diamond', min: 12 },
  { name: 'Master', min: 17 },
  { name: 'Legends', min: 25 },
]

export function leagueTier(wins: number): { name: string; next: { name: string; min: number } | null } {
  let current = LEAGUE_TIERS[0]
  let next: { name: string; min: number } | null = null
  for (let i = 0; i < LEAGUE_TIERS.length; i++) {
    if (wins >= LEAGUE_TIERS[i].min) {
      current = LEAGUE_TIERS[i]
      next = LEAGUE_TIERS[i + 1] ?? null
    }
  }
  return { name: current.name, next }
}

/* ---------------- simuls ---------------- */

export interface Simul {
  id: string
  host: string
  title: string
  open: boolean
  created_at: string
  hostName: string
}

export async function fetchSimuls(): Promise<Simul[]> {
  if (!onlineEnabled) return []
  const { data } = await supabase.from('simuls').select('*').order('created_at', { ascending: false }).limit(20)
  const rows = (data as Omit<Simul, 'hostName'>[]) ?? []
  const profiles = await profilesByIds(rows.map((r) => r.host))
  return rows.map((r) => ({ ...r, hostName: profiles.get(r.host)?.username ?? 'A player' }))
}

export async function createSimul(title: string): Promise<string> {
  const uid = await me()
  if (!uid) throw new Error('Sign in first')
  const { data, error } = await supabase.from('simuls').insert({ host: uid, title }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Could not create the simul')
  return (data as { id: string }).id
}

export async function fetchSimulBoards(simulId: string): Promise<string[]> {
  if (!onlineEnabled) return []
  const { data } = await supabase.from('simul_boards').select('game_id').eq('simul_id', simulId)
  return ((data as { game_id: string }[]) ?? []).map((r) => r.game_id)
}

export async function addSimulBoard(simulId: string, gameId: string): Promise<void> {
  const { error } = await supabase.from('simul_boards').insert({ simul_id: simulId, game_id: gameId })
  if (error) throw new Error(error.message)
}

export async function setSimulOpen(simulId: string, open: boolean): Promise<void> {
  await supabase.from('simuls').update({ open }).eq('id', simulId)
}

/* ---------------- clubs ---------------- */

export interface Club {
  id: string
  name: string
  description: string
  owner: string
  created_at: string
  members: number
  mine: boolean
}

export async function fetchClubs(): Promise<Club[]> {
  const uid = await me()
  if (!onlineEnabled) return []
  const { data } = await supabase.from('clubs').select('*').order('created_at', { ascending: false }).limit(30)
  const rows = (data as Omit<Club, 'members' | 'mine'>[]) ?? []
  const { data: memberRows } = await supabase.from('club_members').select('club_id, user_id')
  const counts = new Map<string, number>()
  const mine = new Set<string>()
  for (const m of (memberRows as { club_id: string; user_id: string }[]) ?? []) {
    counts.set(m.club_id, (counts.get(m.club_id) ?? 0) + 1)
    if (uid && m.user_id === uid) mine.add(m.club_id)
  }
  return rows.map((r) => ({ ...r, members: counts.get(r.id) ?? 0, mine: mine.has(r.id) }))
}

export async function createClub(name: string, description: string): Promise<void> {
  const uid = await me()
  if (!uid) throw new Error('Sign in first')
  const { data, error } = await supabase.from('clubs').insert({ name, description, owner: uid }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Could not create the club')
  await supabase.from('club_members').insert({ club_id: (data as { id: string }).id, user_id: uid })
}

export async function setClubMembership(clubId: string, join: boolean): Promise<void> {
  const uid = await me()
  if (!uid) throw new Error('Sign in first')
  if (join) {
    const { error } = await supabase.from('club_members').insert({ club_id: clubId, user_id: uid })
    if (error) throw new Error(error.message)
  } else {
    await supabase.from('club_members').delete().eq('club_id', clubId).eq('user_id', uid)
  }
}

export async function fetchClubMembers(clubId: string): Promise<ProfileRow[]> {
  if (!onlineEnabled) return []
  const { data } = await supabase.from('club_members').select('user_id').eq('club_id', clubId).limit(60)
  const ids = ((data as { user_id: string }[]) ?? []).map((r) => r.user_id)
  const profiles = await profilesByIds(ids)
  return ids.map((id) => profiles.get(id)).filter((p): p is ProfileRow => !!p)
}

/* ---------------- forums ---------------- */

export interface ForumThread {
  id: string
  author: string
  authorName: string
  category: string
  title: string
  created_at: string
  posts: number
}

export interface ForumPost {
  id: string
  author: string
  authorName: string
  body: string
  created_at: string
}

export async function fetchThreads(): Promise<ForumThread[]> {
  if (!onlineEnabled) return []
  const { data } = await supabase.from('forum_threads').select('*').order('created_at', { ascending: false }).limit(40)
  const rows = (data as Omit<ForumThread, 'authorName' | 'posts'>[]) ?? []
  const profiles = await profilesByIds(rows.map((r) => r.author))
  const { data: postRows } = await supabase.from('forum_posts').select('thread_id')
  const counts = new Map<string, number>()
  for (const p of (postRows as { thread_id: string }[]) ?? []) counts.set(p.thread_id, (counts.get(p.thread_id) ?? 0) + 1)
  return rows.map((r) => ({ ...r, authorName: profiles.get(r.author)?.username ?? 'A player', posts: counts.get(r.id) ?? 0 }))
}

export async function createThread(category: string, title: string, body: string): Promise<void> {
  const uid = await me()
  if (!uid) throw new Error('Sign in first')
  const { data, error } = await supabase
    .from('forum_threads')
    .insert({ author: uid, category, title })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Could not post the thread')
  const { error: postError } = await supabase
    .from('forum_posts')
    .insert({ thread_id: (data as { id: string }).id, author: uid, body })
  if (postError) throw new Error(postError.message)
}

export async function fetchPosts(threadId: string): Promise<ForumPost[]> {
  if (!onlineEnabled) return []
  const { data } = await supabase
    .from('forum_posts')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(200)
  const rows = (data as Omit<ForumPost, 'authorName'>[]) ?? []
  const profiles = await profilesByIds(rows.map((r) => r.author))
  return rows.map((r) => ({ ...r, authorName: profiles.get(r.author)?.username ?? 'A player' }))
}

export async function createPost(threadId: string, body: string): Promise<void> {
  const uid = await me()
  if (!uid) throw new Error('Sign in first')
  const { error } = await supabase.from('forum_posts').insert({ thread_id: threadId, author: uid, body })
  if (error) throw new Error(error.message)
}

/* ---------------- direct messages ---------------- */

export interface DmMessage {
  id: string
  sender: string
  recipient: string
  body: string
  created_at: string
}

export interface Conversation {
  other: ProfileRow
  last: DmMessage
  count: number
}

export async function fetchConversations(): Promise<Conversation[]> {
  const uid = await me()
  if (!uid || !onlineEnabled) return []
  const { data } = await supabase
    .from('dm_messages')
    .select('*')
    .or(`sender.eq.${uid},recipient.eq.${uid}`)
    .order('created_at', { ascending: false })
    .limit(200)
  const rows = (data as DmMessage[]) ?? []
  const byOther = new Map<string, { last: DmMessage; count: number }>()
  for (const m of rows) {
    const other = m.sender === uid ? m.recipient : m.sender
    const cur = byOther.get(other)
    if (!cur) byOther.set(other, { last: m, count: 1 })
    else cur.count += 1
  }
  const profiles = await profilesByIds([...byOther.keys()])
  const out: Conversation[] = []
  for (const [otherId, v] of byOther) {
    const other = profiles.get(otherId)
    if (other) out.push({ other, last: v.last, count: v.count })
  }
  return out.sort((a, b) => b.last.created_at.localeCompare(a.last.created_at))
}

export async function fetchDmThread(otherId: string): Promise<DmMessage[]> {
  const uid = await me()
  if (!uid || !onlineEnabled) return []
  const { data } = await supabase
    .from('dm_messages')
    .select('*')
    .or(`and(sender.eq.${uid},recipient.eq.${otherId}),and(sender.eq.${otherId},recipient.eq.${uid})`)
    .order('created_at', { ascending: true })
    .limit(300)
  return (data as DmMessage[]) ?? []
}

export async function sendDm(toUserId: string, body: string): Promise<void> {
  const uid = await me()
  if (!uid) throw new Error('Sign in first')
  const { error } = await supabase.from('dm_messages').insert({ sender: uid, recipient: toUserId, body })
  if (error) throw new Error(error.message)
}

/** Live tail for one conversation; returns an unsubscribe function. */
export function subscribeDm(otherId: string, onMessage: (m: DmMessage) => void): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null
  void (async () => {
    const uid = await me()
    if (!uid || !onlineEnabled) return
    channel = supabase
      .channel(`dm-${uid}-${otherId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages' },
        (payload) => {
          const m = payload.new as DmMessage
          if (
            (m.sender === uid && m.recipient === otherId) ||
            (m.sender === otherId && m.recipient === uid)
          ) {
            onMessage(m)
          }
        },
      )
      .subscribe()
  })()
  return () => {
    if (channel) void supabase.removeChannel(channel)
  }
}
