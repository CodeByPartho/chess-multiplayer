import { load, save, STORAGE_KEYS } from './storage'
import { DEFAULT_RATING, fromLegacy, type Rating200 } from './chess/rating200'

/** current scale of the stored identity ratings (200 baseline) */
const IDENTITY_SCALE = 200

export interface GuestIdentity {
  id: string
  username: string
  /** avatar seed — drives the generated SVG identicon */
  avatarSeed: string
  /** ISO3166-1 alpha-2 country code, optional; displayed as emoji flag */
  flag: string | null
  ratings: Record<Pool, Rating200>
  /** pool of the last finished online game — the chip's headline rating */
  lastPool?: Pool
  createdAt: number
  /** rating scale the stored numbers use (200 = current, 1500 = legacy) */
  scale?: number
}

export type Pool = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'puzzle'

const POOLS: Pool[] = ['bullet', 'blitz', 'rapid', 'classical', 'puzzle']

export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function randomGuestName(): string {
  return `Guest_${1000 + Math.floor(Math.random() * 9000)}`
}

export function defaultIdentity(): GuestIdentity {
  return {
    id: uuid(),
    username: randomGuestName(),
    avatarSeed: uuid(),
    flag: null,
    ratings: Object.fromEntries(
      POOLS.map((p) => [p, { ...DEFAULT_RATING, updatedAt: Date.now() }]),
    ) as Record<Pool, Rating200>,
    createdAt: Date.now(),
    scale: IDENTITY_SCALE,
  }
}

export function loadIdentity(): GuestIdentity {
  const id = load<GuestIdentity | null>(STORAGE_KEYS.identity, null)
  if (!id || !id.id || !id.ratings) {
    const fresh = defaultIdentity()
    save(STORAGE_KEYS.identity, fresh)
    return fresh
  }
  // migrate legacy 1500-based local ratings to the 200 scale
  if (id.scale !== IDENTITY_SCALE) {
    for (const p of POOLS) {
      const rec = id.ratings[p]
      id.ratings[p] = rec ? fromLegacy(rec) : { ...DEFAULT_RATING, updatedAt: Date.now() }
    }
    id.scale = IDENTITY_SCALE
    save(STORAGE_KEYS.identity, id)
  }
  // backfill any missing pools
  let changed = false
  for (const p of POOLS) {
    if (!id.ratings[p]) {
      id.ratings[p] = { ...DEFAULT_RATING, updatedAt: Date.now() }
      changed = true
    }
  }
  if (changed) save(STORAGE_KEYS.identity, id)
  return id
}

export function saveIdentity(id: GuestIdentity): void {
  save(STORAGE_KEYS.identity, id)
  // the identity is shown outside React state (account chip) — announce every
  // write so live UI can pick the new value up without a reload
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('fc:identity-changed'))
  }
}

export const USERNAME_RE = /^[A-Za-z0-9_À-ɏ一-鿿-]{3,20}$/

export function validateUsername(name: string): string | null {
  const t = name.trim()
  if (t.length < 3) return 'Username must be at least 3 characters'
  if (t.length > 20) return 'Username must be at most 20 characters'
  if (!USERNAME_RE.test(t)) return 'Use letters, numbers, underscores or hyphens'
  return null
}

/**
 * Deterministic SVG identicon from a seed: a symmetric8x8 grid of rounded
 * squares in two hues derived from the seed hash. Original artwork generated
 * at runtime — no image assets, no external service.
 */
export function avatarSvg(seed: string, size = 64): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const rand = () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return ((h >>> 0) % 1000) / 1000
  }
  const hue1 = Math.floor(rand() * 360)
  const hue2 = (hue1 + 40 + Math.floor(rand() * 120)) % 360
  const bg = `hsl(${hue1} 45% 22%)`
  const fg = `hsl(${hue2} 65% 60%)`
  const cell = 8
  const gap = 1
  let rects = ''
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 8; y++) {
      if (rand() > 0.52) {
        const px = x * (cell + gap)
        const py = y * (cell + gap)
        rects += `<rect x="${px}" y="${py}" width="${cell}" height="${cell}" rx="2" fill="${fg}"/>`
        rects += `<rect x="${(7 - x) * (cell + gap)}" y="${py}" width="${cell}" height="${cell}" rx="2" fill="${fg}"/>`
      }
    }
  }
  const total = 8 * (cell + gap) - gap
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}"><rect width="${total}" height="${total}" fill="${bg}"/>${rects}</svg>`
}

export function avatarDataUrl(seed: string, size = 64): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(seed, size))}`
}

/**
 * Last-resort avatar for players with no seed at all: their initials on a
 * card whose hue is derived from the name. Same data-URL contract as
 * avatarDataUrl, so it drops into the same <img>.
 */
export function initialsDataUrl(name: string, size = 64): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = (words.map((w) => [...w][0] ?? '').join('') || '?').slice(0, 2).toUpperCase()
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const hue = (h >>> 0) % 360
  const text = letters.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">` +
    `<rect width="64" height="64" rx="10" fill="hsl(${hue} 42% 24%)"/>` +
    `<text x="32" y="42" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="26" font-weight="600" fill="hsl(${hue} 75% 84%)">${text}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const FLAGS = [
  '🇧🇩', '🇮🇳', '🇵🇰', '🇳🇵', '🇱🇰', '🇺🇸', '🇬🇧', '🇩🇪', '🇫🇷', '🇪🇸', '🇮🇹', '🇷🇺', '🇺🇦',
  '🇧🇷', '🇦🇷', '🇨🇱', '🇲🇽', '🇨🇦', '🇦🇺', '🇳🇿', '🇿🇦', '🇪🇬', '🇳🇬', '🇰🇪', '🇲🇦', '🇹🇷',
  '🇸🇦', '🇦🇪', '🇮🇱', '🇮🇩', '🇲🇾', '🇸🇬', '🇵🇭', '🇹🇭', '🇻🇳', '🇰🇷', '🇯🇵', '🇨🇳', '🇹🇼',
  '🇸🇪', '🇳🇴', '🇫🇮', '🇩🇰', '🇳🇱', '🇧🇪', '🇨🇭', '🇦🇹', '🇵🇱', '🇨🇿', '🇷🇴', '🇬🇷', '🇵🇹',
  '🇮🇪', '🇭🇺', '🇧🇬', '🇭🇷', '🇸🇰', '🇸🇮', '🇮🇸', '🇱🇹', '🇱🇻', '🇪🇪', '🇬🇪', '🇦🇲', '🇦🇿',
]

export function flagOptions(): string[] {
  return FLAGS
}
