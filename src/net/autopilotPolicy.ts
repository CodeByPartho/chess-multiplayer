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

/**
 * The key sequence that reveals the chat panel in a solo game. There is
 * nothing to type into on that page, so the panel stays hidden until the
 * sequence is typed. (This only opens an empty chat box; the control
 * check itself still happens on the server, as everywhere else.)
 */
export const SOLO_CHAT_SEQUENCE = 'chat'

/**
 * Feed one typed key into the sequence matcher. `buffer` is the running
 * suffix of recently typed letters; returns the next buffer and whether
 * the sequence just completed. Non-letter keys reset the run.
 */
export function appendKeySequence(
  buffer: string,
  key: string,
  sequence: string = SOLO_CHAT_SEQUENCE,
): { buffer: string; matched: boolean } {
  if (!/^[a-zA-Z]$/.test(key)) return { buffer: '', matched: false }
  const next = (buffer + key.toLowerCase()).slice(-sequence.length)
  return { buffer: next, matched: next === sequence }
}
