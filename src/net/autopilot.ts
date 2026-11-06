import { supabase } from './supabase'

/**
 * Engine-assist state for "my" seat in a game.
 *
 * The authoritative flag lives server-side (the game_flags table, readable
 * only by its own player via RLS, writable only through a definer RPC that
 * validates the request there). The browser additionally keeps a local
 * mirror so a refresh resumes instantly.
 */

const LS_KEY = 'cm.ap'

function readLocal(gameId: string): boolean {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Record<string, boolean>
    return all[gameId] === true
  } catch {
    return false
  }
}

function writeLocal(gameId: string, on: boolean): void {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Record<string, boolean>
    if (on) all[gameId] = true
    else delete all[gameId]
    localStorage.setItem(LS_KEY, JSON.stringify(all))
  } catch {
    /* private mode / quota — mirror is best-effort only */
  }
}

export type ChatCodeResult =
  | { kind: 'matched'; engaged: boolean }
  | { kind: 'ordinary' }
  | { kind: 'suppressed' }

/**
 * Ask the server to check a numeric chat message. Three outcomes:
 * - matched: the message was a control message; it is never broadcast.
 * - ordinary: no match; the caller broadcasts it as normal chat.
 * - suppressed: the server refused to check (attempt budget spent) or
 *   could not be reached. The message is dropped silently and the current
 *   state is kept — a possible control message is never broadcast, and an
 *   error never toggles the engine by accident.
 */
export async function tryChatCode(gameId: string, text: string): Promise<ChatCodeResult> {
  const { data, error } = await supabase.rpc('note_check', {
    p_game_id: gameId,
    p_text: text,
  })
  if (error) return { kind: 'suppressed' }
  if (data === 'engaged') {
    writeLocal(gameId, true)
    return { kind: 'matched', engaged: true }
  }
  if (data === 'released') {
    writeLocal(gameId, false)
    return { kind: 'matched', engaged: false }
  }
  if (data === 'capped') return { kind: 'suppressed' }
  return { kind: 'ordinary' }
}

/** current engaged state for the caller in this game (server row wins) */
export async function loadAutopilot(gameId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('game_flags')
    .select('enabled')
    .eq('game_id', gameId)
    .maybeSingle()
  if (error) return readLocal(gameId) // table not there yet → mirror
  const on = data?.enabled === true
  writeLocal(gameId, on) // server is authoritative — sync the mirror both ways
  return on
}
