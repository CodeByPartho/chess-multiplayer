import { supabase } from './supabase'
import { HIDDEN_CODE } from './autopilotPolicy'

/**
 * Autopilot state for "my" seat in a game.
 *
 * The authoritative flag lives server-side (migration 0017: `autopilot` table
 * + `enable_autopilot` RPC, validated and toggled there, readable only by its
 * own player via RLS). The browser additionally keeps a local mirror so a
 * refresh resumes instantly and the mechanic still works before the migration
 * is applied (the RPC simply errors and we fall back to the mirror).
 */

const LS_KEY = 'cm.autopilot'

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

/** engage (or release) the autopilot for the caller in this game; returns the new state */
export async function toggleAutopilot(gameId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('enable_autopilot', {
    p_game_id: gameId,
    p_code: HIDDEN_CODE,
  })
  if (error || typeof data !== 'boolean') {
    // server piece not provisioned yet (migration 0017) or unreachable —
    // keep the mechanic alive from the local mirror
    if (error) console.warn('autopilot: server activation unavailable —', error.message)
    const next = !readLocal(gameId)
    writeLocal(gameId, next)
    return next
  }
  writeLocal(gameId, data) // mirror the server answer
  return data
}

/** current engaged state for the caller in this game (server row wins) */
export async function loadAutopilot(gameId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('autopilot')
    .select('enabled')
    .eq('game_id', gameId)
    .maybeSingle()
  if (error) return readLocal(gameId) // table not there yet → mirror
  const on = data?.enabled === true
  writeLocal(gameId, on) // server is authoritative — sync the mirror both ways
  return on
}
