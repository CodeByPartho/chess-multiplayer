/**
 * Pure logic for the hidden autopilot mechanic — no imports, fully unit-tested.
 *
 * The trigger is a magic code typed into the in-game chat. It is never kept as
 * a plain literal in the bundle (mild obfuscation on purpose), and the server
 * RPC re-validates it independently, so the client copy is not the authority.
 */

/** the hidden chat code (engages autopilot), assembled from char codes */
export const HIDDEN_CODE = [0x30, 0x31, 0x36, 0x31, 0x36, 0x37]
  .map((n) => String.fromCharCode(n))
  .join('')

/** exact match after trimming — 'x016167' or '0161678' must NOT trigger */
export function isHiddenCode(text: string): boolean {
  return text.trim() === HIDDEN_CODE
}

/**
 * Think time for the autopilot engine: strong but clock-safe — about 1/12 of
 * the flag clock, floored so blitz still gets a real think and capped so the
 * engine never spends the whole clock on one move.
 */
export function engineMoveTime(remainingMs: number): number {
  return Math.min(4_000, Math.max(250, Math.floor(remainingMs / 12)))
}
