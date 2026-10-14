/** Safe localStorage wrappers with JSON + quota fallback to memory. */

const mem = new Map<string, string>()

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    const raw = mem.get(key)
    if (raw === undefined) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }
}

export function save(key: string, value: unknown): void {
  const raw = JSON.stringify(value)
  try {
    localStorage.setItem(key, raw)
  } catch {
    mem.set(key, raw)
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    mem.delete(key)
  }
}

export const STORAGE_KEYS = {
  identity: 'cm.identity',
  settings: 'cm.settings',
  history: 'cm.history',
  seenGames: 'cm.seenGames',
} as const
