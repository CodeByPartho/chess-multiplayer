import type { Color, TimeControl } from '@/lib/chess/types'

/**
 * Pure state machine for the invite join screen. Everything a guest can see
 * when opening a /join/<id> or /invite/<code> link derives from this one
 * function, so every outcome (not found / full / finished / expired /
 * cancelled / own invite) has a defined, testable screen — never blank.
 */

/** waiting invites stop being joinable after 24h */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000

/** the subset of a games row the join screen needs (ServerGame satisfies it) */
export interface JoinGameInfo {
  id: string
  status: 'waiting' | 'active' | 'over' | 'aborted'
  white_id: string | null
  black_id: string | null
  invite_code: string | null
  created_at: string
  tc: TimeControl
  rated: boolean
}

export type JoinView =
  /** no game row for this id/code */
  | { state: 'not-found' }
  /** the creator cancelled the game (status aborted) */
  | { state: 'cancelled' }
  /** sat in waiting too long — the link is dead */
  | { state: 'expired'; gameId: string }
  /** game started and I'm not one of the two players */
  | { state: 'full'; gameId: string }
  /** game already played out and I'm not one of the two players */
  | { state: 'finished'; gameId: string }
  /** I'm seated and the game is live or over — go (back) to the board */
  | { state: 'reconnect'; gameId: string }
  /** I created this invite and nobody joined yet — friendly explainer */
  | { state: 'creator-waiting'; gameId: string; code: string | null }
  /** an open seat is waiting for me */
  | {
      state: 'joinable'
      gameId: string
      code: string | null
      myColor: Color
      tc: TimeControl
      rated: boolean
    }

export function joinViewState(game: JoinGameInfo | null, myId: string | null, now: number): JoinView {
  if (!game) return { state: 'not-found' }
  const seated = !!myId && (game.white_id === myId || game.black_id === myId)

  if (game.status === 'aborted') return { state: 'cancelled' }
  if (game.status === 'over') {
    return seated ? { state: 'reconnect', gameId: game.id } : { state: 'finished', gameId: game.id }
  }
  if (game.status === 'active') {
    return seated ? { state: 'reconnect', gameId: game.id } : { state: 'full', gameId: game.id }
  }
  // status === 'waiting'
  if (seated) return { state: 'creator-waiting', gameId: game.id, code: game.invite_code }
  if (now - new Date(game.created_at).getTime() > INVITE_TTL_MS) return { state: 'expired', gameId: game.id }
  // the open seat: game-create always seats the creator, so exactly one is free
  const myColor: Color = game.white_id === null ? 'w' : 'b'
  return { state: 'joinable', gameId: game.id, code: game.invite_code, myColor, tc: game.tc, rated: game.rated }
}
