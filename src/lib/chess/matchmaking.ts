/**
 * Matchmaking + anti-abuse rules (pure — mirrored by the SQL queue_match
 * and the games insert trigger in migration 0008, and unit-tested here).
 *
 * Window: starts at ±100 and widens by 50 every 5 seconds while a player
 * waits, up to a configurable maximum.
 */

export const WINDOW_START = 100
export const WINDOW_STEP = 50
export const WINDOW_STEP_MS = 5000
export const WINDOW_MAX = 600

/** rating window (absolute points) for someone who has waited `waitMs` */
export function windowFor(waitMs: number, max: number = WINDOW_MAX): number {
  const steps = Math.max(0, Math.floor(waitMs / WINDOW_STEP_MS))
  return Math.min(max, WINDOW_START + steps * WINDOW_STEP)
}

export function withinWindow(a: number, b: number, waitMs: number, max?: number): boolean {
  return Math.abs(a - b) <= windowFor(waitMs, max)
}

/** visible width for the searching UI, e.g. "±150" */
export function windowLabel(waitMs: number, max?: number): string {
  return `±${windowFor(waitMs, max)}`
}

/**
 * Rating farming: after this many rated games between the SAME two players
 * inside 24 hours, further games between them are casual.
 */
export const FARM_LIMIT = 24 * 60 * 60 * 1000
export const FARM_MAX_RATED = 4

export function isFarmingPair(ratedGamesIn24h: number): boolean {
  return ratedGamesIn24h >= FARM_MAX_RATED
}
