/**
 * Account username rules — mirrored exactly by the claim_username RPC in
 * migration 0007 (the database is authoritative; this keeps client-side
 * validation instant and identical).
 *
 * 3-20 chars, letters/numbers/underscore/hyphen, case-insensitive unique,
 * profanity + impersonation filter.
 */

export const USERNAME_MIN = 3
export const USERNAME_MAX = 20

/** ASCII letters, numbers, underscore, hyphen */
export const ACCOUNT_USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/

/** exact names that would let a player impersonate the site or its team */
export const RESERVED_USERNAMES = new Set(
  [
    'admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'help', 'root',
    'system', 'official', 'team', 'freechess', 'chess', 'god', 'superuser', 'chat',
    'api', 'security', 'sales', 'service', 'billing', 'owner', 'creator', 'founder',
    'ceo', 'cto', 'employee', 'bot', 'null', 'undefined', 'anonymous', 'everyone',
    'all', 'me', 'you', 'player', 'guest', 'anonymoususer', 'nobody', 'website',
    'webmaster', 'postmaster', 'abuse', 'info', 'contact', 'feedback', 'news',
    'operator', 'supervisor', 'chief', 'editor', 'watchman', 'guard', 'modteam',
  ],
)

/**
 * impersonation words that also block surrounding padding:
 * "theadmin", "admin1", "mod_team", "x_moderator" — but not unrelated words
 * that merely start the same ("chessking", "admiration").
 */
const PREFIX_BLOCK = [
  'admin', 'administrator', 'moderator', 'modteam', 'support', 'staff', 'root',
  'official', 'superuser', 'webmaster', 'freechess', 'anonymous', 'system',
]

/** reserved-name check (case-insensitive) */
export function isReservedUsername(name: string): boolean {
  const t = name.trim().toLowerCase()
  if (RESERVED_USERNAMES.has(t)) return true
  const bare = t.replace(/[_-]/g, '')
  if (bare !== t && RESERVED_USERNAMES.has(bare)) return true
  for (const r of PREFIX_BLOCK) {
    if (bare.startsWith(r) || bare.endsWith(r)) return true
  }
  return false
}

/**
 * Full client-side validation. Returns an error message or null when valid.
 * `taken` (case-insensitive) marks the name as already used.
 */
export function validateAccountUsername(name: string, taken = false): string | null {
  const t = name.trim()
  if (t.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters`
  if (t.length > USERNAME_MAX) return `Username must be at most ${USERNAME_MAX} characters`
  if (!ACCOUNT_USERNAME_RE.test(t)) return 'Use letters, numbers, underscores or hyphens only'
  if (isReservedUsername(t)) return 'That username is reserved — pick another one'
  if (taken) return 'That username is already taken'
  return null
}

/** canonical form for the case-insensitive unique index */
export function usernameKey(name: string): string {
  return name.trim().toLowerCase()
}
