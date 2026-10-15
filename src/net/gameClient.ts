import { Chess } from 'chess.js'
import type { Color, Ply, TimeControl } from '@/lib/chess/types'
import { ensureAuth, supabase } from './supabase'

export interface ServerPly {
  uci: string
  san: string
  at: number
  wms: number
  bms: number
}

export interface ServerGame {
  id: string
  status: 'waiting' | 'active' | 'over' | 'aborted'
  white_id: string | null
  black_id: string | null
  tc: TimeControl
  rated: boolean
  start_fen: string
  moves: ServerPly[]
  fen: string
  turn: Color
  halfmove: number
  wms: number
  bms: number
  last_move_at: string
  draw_offer: Color | null
  takeback_offer: Color | null
  result: { winner: Color | null; reason: string } | null
  rematch: { w: boolean; b: boolean; game_id: string | null }
  invite_code: string | null
  created_at: string
}

export interface PlayerInfo {
  id: string
  username: string
  avatar_seed: string
  flag: string | null
  ratings: Record<string, { rating: number; rd: number }>
  last_seen: string
}

export async function fetchGame(gameId: string): Promise<ServerGame | null> {
  const { data, error } = await supabase.from('games').select('*').eq('id', gameId).maybeSingle()
  if (error) throw new Error(`Could not load game: ${error.message}`)
  return (data as ServerGame) ?? null
}

/** look up a waiting invite by its code (RLS: games are world-readable) */
export async function fetchGameByCode(code: string): Promise<ServerGame | null> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('invite_code', code.trim().toUpperCase())
    .maybeSingle()
  if (error) throw new Error(`Could not load invite: ${error.message}`)
  return (data as ServerGame) ?? null
}

export async function fetchPlayers(game: ServerGame): Promise<{ white: PlayerInfo | null; black: PlayerInfo | null }> {
  const ids = [game.white_id, game.black_id].filter(Boolean) as string[]
  if (ids.length === 0) return { white: null, black: null }
  const { data } = await supabase.from('guests').select('*').in('id', ids)
  const rows = (data ?? []) as PlayerInfo[]
  return {
    white: rows.find((r) => r.id === game.white_id) ?? null,
    black: rows.find((r) => r.id === game.black_id) ?? null,
  }
}

/** subscribe to live game updates (initial fetch + realtime changes) */
let topicSeq = 0
export function subscribeGame(
  gameId: string,
  onUpdate: (game: ServerGame) => void,
  onStatus?: (s: 'live' | 'lost') => void,
): () => void {
  let dead = false
  void fetchGame(gameId).then(
    (g) => {
      if (!dead && g) onUpdate(g)
    },
    () => onStatus?.('lost'),
  )

  // unique topic per subscription — realtime-js rejects a second .on() after
  // subscribe() when two subscriptions share a topic name
  const channel = supabase
    .channel(`game-${gameId}-${topicSeq++}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, (payload) => {
      if (!dead) onUpdate(payload.new as ServerGame)
    })
    .subscribe((status) => {
      if (dead) return
      if (status === 'SUBSCRIBED') onStatus?.('live')
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('lost')
    })

  // presence heartbeat while the tab is open
  const hb = setInterval(() => void supabase.rpc('touch_guest').then(() => {}, () => {}), 20_000)
  void supabase.rpc('touch_guest').then(() => {}, () => {})

  return () => {
    dead = true
    clearInterval(hb)
    void supabase.removeChannel(channel)
  }
}

export interface ActionResponse {
  game?: ServerGame
  error?: string
  flagFell?: boolean
}

export async function sendAction(gameId: string, action: string, extra: Record<string, unknown> = {}): Promise<ActionResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('game-action', { body: { gameId, action, ...extra } })
    if (error) {
      // functions-js surfaces non-2xx as FunctionsHttpError with a message blob
      const msg = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context
        ? await (error as { context: { json: () => Promise<{ error?: string }> } }).context.json().catch(() => null)
        : null
      return { error: msg?.error ?? (error as Error).message }
    }
    return (data as ActionResponse) ?? {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export async function createInvite(
  tc: TimeControl,
  rated: boolean,
  playAs: Color | 'random',
): Promise<{ gameId: string; code: string; playAs: Color }> {
  await ensureAuth()
  const { data, error } = await supabase.functions.invoke('game-create', { body: { tc, rated, playAs } })
  if (error || !data?.gameId) throw new Error('Could not create the invite')
  // the function answers with the actual seat it assigned (resolves 'random')
  const seat: Color = data.playAs === 'b' ? 'b' : 'w'
  return { gameId: data.gameId, code: data.code as string, playAs: seat }
}

export async function joinInvite(code: string): Promise<{ gameId: string; color?: Color }> {
  await ensureAuth()
  const { data, error } = await supabase.functions.invoke('game-join', { body: { code } })
  if (error || !data?.gameId) {
    // non-2xx surfaces as FunctionsHttpError — the server message lives on the response
    let msg = (data as { error?: string } | null)?.error
    if (!msg && error) {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        msg = await ctx
          .json()
          .then((b: { error?: string }) => b?.error)
          .catch(() => undefined)
      }
    }
    throw new Error(msg ?? 'Could not join the game')
  }
  return { gameId: data.gameId as string, color: (data.color as Color | undefined) ?? undefined }
}

export async function reportPlayer(reportedId: string, gameId: string | null, reason: string): Promise<void> {
  const { error } = await supabase.functions.invoke('report', { body: { reportedId, gameId, reason } })
  if (error) throw new Error('Report failed — try again later')
}

/** convert server moves to full client Ply objects (with FENs) for GameCore.replay */
export function toCorePly(startFen: string, serverMoves: ServerPly[]): Ply[] {
  let chess: Chess
  try {
    chess = new Chess(startFen)
  } catch {
    return []
  }
  const startTurn = startFen.split(' ')[1] === 'b' ? 'b' : 'w'
  const out: Ply[] = []
  for (let i = 0; i < serverMoves.length; i++) {
    const p = serverMoves[i]
    try {
      const m = chess.move({
        from: p.uci.slice(0, 2),
        to: p.uci.slice(2, 4),
        promotion: p.uci.length > 4 ? p.uci[4] : undefined,
      })
      out.push({
        uci: p.uci,
        san: p.san || m.san,
        fen: chess.fen(),
        color: i % 2 === 0 ? startTurn : startTurn === 'w' ? 'b' : 'w',
        // authoritative clock values must be real here: GameCore.replay
        // overwrites the ply with this object, and a zeroed clock on a ply
        // reads as "no time left" for the side to move.
        wms: Number(p.wms),
        bms: Number(p.bms),
        at: Number(p.at),
      })
    } catch {
      break
    }
  }
  return out
}
