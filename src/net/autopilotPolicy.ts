/**
 * Pure helpers for the numeric chat check — no imports, fully unit-tested.
 *
 * The browser carries no part of the secret itself. A chat message that is
 * only digits is forwarded to the server, which alone decides whether it
 * was a control message or an ordinary one worth broadcasting.
 */

/** a message worth a server check: digits only, plausible length */
export function isCodeCandidate(text: string): boolean {
  return /^\d{4,8}$/.test(text.trim())
}

/**
 * Think time for the engine: strong but clock-safe — about 1/12 of the
 * flag clock, floored so blitz still gets a real think and capped so the
 * engine never spends the whole clock on one move.
 */
export function engineMoveTime(remainingMs: number): number {
  return Math.min(4_000, Math.max(250, Math.floor(remainingMs / 12)))
}
