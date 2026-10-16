/**
 * The 200-rating-scale adapter around the shared Glicko-2 implementation.
 *
 * Everyone starts at 200 (floor 100). Glicko-2 maths keeps its 1500
 * reference internally, so displayed ratings are offset by 1300 points on
 * the way into `updateGlicko` and back on the way out — deltas are linear,
 * so gains/losses carry over 1:1. RD and volatility are scale-free.
 *
 * Shared by: client live preview, local/compat rating storage, and the
 * puzzle rating. The server-side SQL port in migration 0008 implements the
 * same maths and is checked against this module by the integration test.
 */
import { updateGlicko, type GlickoPlayer } from './glicko'

/** rating every new player starts at */
export const RATING_START = 200
/** displayed 200 ≡ internal 1500 */
export const RATING_OFFSET = 1300
/** a rating can never drop below this */
export const RATING_FLOOR = 100
/** initial rating deviation */
export const RD_START = 350
/** deviation floor — keeps established players responsive */
export const RD_FLOOR = 45
/** deviation cap (Glicko-2 default) */
export const RD_CAP = 350
/** above this deviation the rating is provisional ("?") */
export const RD_PROVISIONAL = 110
/** initial volatility */
export const VOL_START = 0.06

export interface Rating200 {
  rating: number
  rd: number
  vol: number
  /** timestamp of the last update (ms) */
  updatedAt: number
}

export const DEFAULT_RATING: Rating200 = {
  rating: RATING_START,
  rd: RD_START,
  vol: VOL_START,
  updatedAt: 0,
}

/**
 * Puzzle difficulty behaves like a fixed, well-measured opponent: Lichess
 * ratings the problem itself, so the opponent RD is pinned low (rather than a
 * human's 350 start) and a solve moves the player by a sensible amount.
 */
export const PUZZLE_OPP_RD = 80

export function isProvisional(rd: number): boolean {
  return rd > RD_PROVISIONAL
}

/** keep a rating record inside the DB CHECK bounds (rating>=100, rd 45..350, vol .01...5) */
export function clampRating(p: Partial<Rating200>): Rating200 {
  const rating = Math.max(RATING_FLOOR, Math.min(3000, Math.round(p.rating ?? RATING_START)))
  const rd = Math.max(RD_FLOOR, Math.min(RD_CAP, Math.round(p.rd ?? RD_START)))
  const vol = Math.max(0.01, Math.min(0.5, p.vol ?? VOL_START))
  return { rating, rd, vol, updatedAt: p.updatedAt ?? 0 }
}

export interface RatingResult {
  /** opponent rating on the 200 scale */
  oppRating: number
  oppRd: number
  /** 1 win, 0.5 draw, 0 loss */
  score: number
  /** ms since the player's last update */
  elapsedMs: number
}

/**
 * One rating period of results on the 200 scale. Same maths as the fixed
 * Glicko-2 implementation (tau/volatility clamps), with the ±1300 offset.
 */
export function updateRating200(player: Rating200, results: RatingResult[]): Rating200 {
  if (results.length === 0) return { ...player }
  const shifted: GlickoPlayer = { ...player, rating: player.rating + RATING_OFFSET }
  const out = updateGlicko(
    shifted,
    results.map((r) => ({ ...r, oppRating: r.oppRating + RATING_OFFSET })),
  )
  return clampRating({
    rating: out.rating - RATING_OFFSET,
    rd: out.rd,
    vol: out.vol,
    updatedAt: out.updatedAt,
  })
}

/** expected score vs an opponent (200 scale) — for draw odds and previews */
export function expectedScore200(me: Pick<Rating200, 'rating' | 'rd'>, opp: Pick<Rating200, 'rating' | 'rd'>): number {
  const scale = 173.7178
  const mu = (me.rating + RATING_OFFSET - 1500) / scale
  const muj = (opp.rating + RATING_OFFSET - 1500) / scale
  const phij = Math.max(0.05, opp.rd) / scale
  const g = 1 / Math.sqrt(1 + (3 * phij * phij) / (Math.PI * Math.PI))
  return 1 / (1 + Math.exp(-g * (mu - muj)))
}

/**
 * Live "if you win / draw / lose" preview next to the clocks: the rating the
 * player would reach after this one game, without committing anything.
 * Calculated from the exact same function the server applies at game end.
 */
export function previewDeltas(
  me: Rating200,
  opp: Rating200,
  now: number,
): { win: number; draw: number; loss: number; next: { win: number; draw: number; loss: number } } {
  const elapsedMs = Math.max(0, now - (me.updatedAt || now))
  const at = (score: number) =>
    updateRating200(me, [{ oppRating: opp.rating, oppRd: opp.rd, score, elapsedMs }]).rating
  const win = at(1)
  const draw = at(0.5)
  const loss = at(0)
  return { win: win - me.rating, draw: draw - me.rating, loss: loss - me.rating, next: { win, draw, loss } }
}

/** convert a legacy 1500-based record (guests.jsonb / old localStorage) to the 200 scale */
export function fromLegacy(p: { rating: number; rd?: number; vol?: number; updatedAt?: number }): Rating200 {
  return clampRating({
    rating: (p.rating ?? 1500) - RATING_OFFSET,
    rd: p.rd ?? RD_START,
    vol: p.vol ?? VOL_START,
    updatedAt: p.updatedAt ?? 0,
  })
}

/** the "?" marker for provisional ratings */
export function ratingLabel(r: Pick<Rating200, 'rating' | 'rd'>): string {
  return `${r.rating}${isProvisional(r.rd) ? '?' : ''}`
}
