import type { Color } from './types'

/**
 * Clock model: we store remaining ms per side plus the wall-clock timestamp of
 * the last move. Remaining time for the side to move is derived, never ticked,
 * so it survives tab suspension and reconnects. `now` is always passed in so
 * the logic is pure and testable; callers pass latency-corrected server time.
 */
export interface ClockState {
  wms: number
  bms: number
  lastMoveAt: number
  turn: Color
}

export function initialClock(baseMs: number, now: number): ClockState {
  return { wms: baseMs, bms: baseMs, lastMoveAt: now, turn: 'w' }
}

export function remaining(state: ClockState, side: Color, now: number): number {
  const ms = side === 'w' ? state.wms : state.bms
  if (state.turn !== side) return ms
  return Math.max(0, ms - Math.max(0, now - state.lastMoveAt))
}

/** Apply a move by `side`: consume elapsed time, award the increment, hand over the turn. */
export function applyMove(state: ClockState, side: Color, incMs: number, now: number): ClockState {
  const elapsed = Math.max(0, now - state.lastMoveAt)
  const afterMove = Math.max(0, (side === 'w' ? state.wms : state.bms) - elapsed + incMs)
  return side === 'w'
    ? { wms: afterMove, bms: state.bms, lastMoveAt: now, turn: 'b' }
    : { wms: state.wms, bms: afterMove, lastMoveAt: now, turn: 'w' }
}

/** True when `side` has run out of time (only meaningful when it is their turn). */
export function flagFallen(state: ClockState, side: Color, now: number): boolean {
  return state.turn === side && remaining(state, side, now) <= 0
}

/**
 * When a player disconnects we freeze nothing; instead we record the moment we
 * last heard from them. `disconnectedAt` is null while connected.
 */
export function graceDeadline(disconnectedAt: number | null, graceMs: number): number | null {
  return disconnectedAt === null ? null : disconnectedAt + graceMs
}
