/**
 * Deterministic profanity filter — the same function runs on both clients so
 * both players always see the same text. Obfuscation-aware (leet speak,
 * repeated characters, whitespace/punctuation splitting).
 */

const WORDS = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt', 'pussy', 'cock',
  'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'douche', 'wanker',
  'bollock', 'arsehole', 'twat', 'prick', 'mofucker', 'motherfucker', 'suckmy',
  'kill yourself', 'kys', 'go die', 'delete yourself', 'rape', 'nazihitler',
]

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '+': 't' }

function normalize(s: string): string {
  let t = s.toLowerCase()
  t = t.replace(/[013457@$!+]/g, (c) => LEET[c] ?? c)
  // collapse doubled letters: "fuuck" -> "fuck"
  t = t.replace(/(.)\1{1,}/g, '$1')
  // strip everything non-alphabetic INCLUDING spaces, so "f.u.c.k" and
  // "f u c k" collapse into the same haystack as the word list does
  t = t.replace(/[^a-z]/g, '')
  return t
}

/** Returns masked text with offensive terms replaced by asterisks. */
export function filterProfanity(text: string): string {
  const lower = text.toLowerCase()
  const norm = normalize(text)
  let hit = false
  for (const w of WORDS) {
    const nw = normalize(w)
    if (norm.includes(nw) || lower.includes(w)) {
      hit = true
      break
    }
  }
  if (!hit) return text
  // mask word-ish chunks on the original text
  let masked = text
    .split(/(\s+)/)
    .map((chunk) =>
      normalize(chunk).length > 1 && WORDS.some((w) => normalize(chunk).includes(normalize(w)))
        ? '*'.repeat(Math.max(3, chunk.length))
        : chunk,
    )
    .join('')
  // obfuscated across chunks ("f u c k") — mask the whole message
  if (masked === text) masked = '*'.repeat(text.length)
  return masked
}

export function isOffensive(text: string): boolean {
  return filterProfanity(text) !== text
}
