import { supabase } from './supabase'

/**
 * Engine-assist state for "my" seat in a game.
 *
 * The authoritative flag lives server-side (the game_flags table, readable
 * only by its own player via RLS, writable only through a definer RPC that
 * validates the request there). The browser additionally keeps a local
 * mirror so a refresh resumes instantly, and so the mechanic still works
 * if the server piece is ever unreachable (the check simply errors and we
 * fall back to the mirror).
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

/**
 * Ask the server to check a numeric chat message. Returns the new state
 * when the server says the message matched, or null when it was just an
 * ordinary message (the caller then broadcasts it as normal chat).
 * If the server cannot be reached at all, the local mirror decides, so a
 * control message is never broadcast by accident.
 */
export async function tryChatCode(
  gameId: string,
  text: string,
): Promise<{ engaged: boolean } | null> {
  const { data, error } = await supabase.rpc('note_check', {
    p_game_id: gameId,
    p_text: text,
  })
  if (error) {
    const next = !readLocal(gameId)
    writeLocal(gameId, next)
    return { engaged: next }
  }
  if (typeof data !== 'boolean') return null // no match — ordinary message
  writeLocal(gameId, data) // mirror the server answer
  return { engaged: data }
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
