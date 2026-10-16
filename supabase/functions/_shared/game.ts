// Server-side game logic shared by the Edge Functions.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { Chess } from 'npm:chess.js@1.4.0'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
}

/** Verify the caller's JWT and return the user id (anonymous sign-in counts). */
export async function getUserId(req: Request, supa: SupabaseClient): Promise<string | null> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await supa.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

/**
 * Parse a JSON request body with a hard size ceiling (bytes). Every handler
 * caps its body before parsing so an oversized payload never reaches
 * JSON.parse or the database. Returns null for missing/oversized/malformed
 * bodies — callers answer 400.
 */
export async function readJsonLimited(req: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) return null
  let text: string
  try {
    text = await req.text()
  } catch {
    return null
  }
  if (text.length > maxBytes) return null
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export interface PlyRec {
  uci: string
  san: string
  at: number
  wms: number
  bms: number
}

export interface GameResultRec {
  winner: 'w' | 'b' | null
  reason: string
}

export interface GameRow {
  id: string
  status: 'waiting' | 'active' | 'over' | 'aborted'
  /** nullable only while an invite-link game waits for its opponent */
  white_id: string | null
  black_id: string | null
  tc: { base: number; inc: number; type: string; label?: string }
  rated: boolean
  start_fen: string
  moves: PlyRec[]
  fen: string
  turn: 'w' | 'b'
  halfmove: number
  wms: number
  bms: number
  last_move_at: string
  draw_offer: 'w' | 'b' | null
  takeback_offer: 'w' | 'b' | null
  result: GameResultRec | null
  rematch: { w: boolean; b: boolean; game_id: string | null }
  invite_code: string | null
  created_at: string
  updated_at: string
}

export async function loadGame(supa: SupabaseClient, id: string): Promise<GameRow | null> {
  const { data, error } = await supa.from('games').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`db: ${error.message}`)
  return (data as GameRow) ?? null
}

/** Replay the stored moves into a chess.js instance. Throws on corrupt data. */
export function replayChess(game: GameRow): Chess {
  const chess = new Chess(game.start_fen || START_FEN)
  for (const p of game.moves) {
    chess.move({ from: p.uci.slice(0, 2), to: p.uci.slice(2, 4), promotion: p.uci.length > 4 ? p.uci[4] : undefined })
  }
  return chess
}

/** Detect natural termination for the position AFTER `mover` just moved. */
export function terminationAfter(chess: Chess, mover: 'w' | 'b'): GameResultRec | null {
  if (chess.isCheckmate()) return { winner: mover === 'w' ? 'b' : 'w', reason: 'checkmate' }
  if (chess.isStalemate()) return { winner: null, reason: 'stalemate' }
  if (chess.isInsufficientMaterial()) return { winner: null, reason: 'insufficient' }
  if (chess.isThreefoldRepetition()) return { winner: null, reason: 'threefold' }
  if (chess.isDrawByFiftyMoves()) return { winner: null, reason: 'fifty' }
  return null
}

/**
 * Rate a finished game through the database. finalize_game() re-reads the
 * game and both ratings rows server-side, computes Glicko-2 (200 scale) and
 * writes both players atomically — and is idempotent, so the client may also
 * call it on reconnect without ever double-counting a result.
 */
export async function finalizeGame(supa: SupabaseClient, gameId: string): Promise<void> {
  const { error } = await supa.rpc('finalize_game', { p_game_id: gameId })
  if (error) console.error('finalize_game failed', gameId, error.message)
}

/** End a game: set result + status, update ratings exactly once. */
export async function endGame(
  supa: SupabaseClient,
  game: GameRow,
  result: GameResultRec,
  status: 'over' | 'aborted' = 'over',
): Promise<boolean> {
  const { data, error } = await supa
    .from('games')
    .update({ result, status, draw_offer: null, takeback_offer: null, updated_at: new Date().toISOString() })
    .eq('id', game.id)
    .is('result', null)
    .select('id')
  if (error) throw new Error(`db: ${error.message}`)
  const claimed = !!data && data.length > 0
  if (claimed && status === 'over') await finalizeGame(supa, game.id)
  return claimed
}

export function colorOf(game: GameRow, userId: string): 'w' | 'b' | null {
  return game.white_id === userId ? 'w' : game.black_id === userId ? 'b' : null
}

/** ms remaining for a color given server timestamps (clamped at 0). */
export function remainingMs(game: GameRow, color: 'w' | 'b', now = Date.now()): number {
  const base = color === 'w' ? game.wms : game.bms
  if (game.turn !== color || game.status !== 'active') return Math.max(0, base)
  const elapsed = Math.max(0, now - new Date(game.last_move_at).getTime())
  return Math.max(0, base - elapsed)
}

/** Validate a time control coming from invite creation. */
export function validTc(tc: unknown): tc is GameRow['tc'] {
  const t = tc as GameRow['tc'] | null
  if (!t || typeof t !== 'object') return false
  const base = Number(t.base)
  const inc = Number(t.inc)
  return (
    typeof t.type === 'string' &&
    Number.isFinite(base) && base >= 10_000 && base <= 10_800_000 &&
    Number.isFinite(inc) && inc >= 0 && inc <= 60_000
  )
}

export function randCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}
