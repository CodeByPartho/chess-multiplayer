import data from './puzzles.json'

export interface Puzzle {
  id: string
  fen: string
  /** uci moves: user, opponent, user… (mate-in-1 puzzles are a single user move) */
  solution: string[]
  themes: string[]
  rating: number
  title: string
}

export const puzzles: Puzzle[] = data as Puzzle[]

export const PUZZLE_THEMES: { id: string; name: string; icon: string }[] = [
  { id: 'backRank', name: 'Back rank', icon: '🏰' },
  { id: 'corridor', name: 'Corridor', icon: '🚪' },
  { id: 'smothered', name: 'Smothered mate', icon: '🐎' },
  { id: 'promotion', name: 'Promotion', icon: '♛' },
  { id: 'ladder', name: 'Ladder mate', icon: '🪜' },
  { id: 'krEndgame', name: 'King + rook', icon: '♜' },
  { id: 'kqEndgame', name: 'King + queen', icon: '♕' },
]

export function puzzleById(id: string): Puzzle | null {
  return puzzles.find((p) => p.id === id) ?? null
}

export function puzzlesByTheme(theme: string): Puzzle[] {
  return puzzles.filter((p) => p.themes.includes(theme))
}

export function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w'
}

/** deterministic daily puzzle (same for everyone on the same day) */
export function dailyPuzzle(now = new Date()): Puzzle {
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000)
  return puzzles[(day * 7919) % puzzles.length]
}

/** mulberry32 seeded shuffle — deterministic for daily puzzles and rush order */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr]
  let a = seed >>> 0
  const rnd = () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** practice queue: shuffled set within a rating band around the player's puzzle rating */
export function practiceSet(rating: number, count = 30): Puzzle[] {
  const band = puzzles.filter((p) => Math.abs(p.rating - rating) <= 250)
  const pool = band.length >= count ? band : puzzles
  return seededShuffle(pool, rating + puzzles.length).slice(0, count)
}

/** rush queue: easiest first, gently ramping — deterministic per day+mode */
export function rushOrder(now = new Date(), count = 60): Puzzle[] {
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000)
  const sorted = [...puzzles].sort((a, b) => a.rating - b.rating)
  const bands: Puzzle[][] = []
  const per = Math.ceil(sorted.length / 5)
  for (let i = 0; i < 5; i++) bands.push(sorted.slice(i * per, (i + 1) * per))
  const shuffled = bands.map((b, i) => seededShuffle(b, day * 31 + i * 7))
  const out: Puzzle[] = []
  let round = 0
  while (out.length < count) {
    for (const b of shuffled) {
      const p = b[round % b.length]
      if (p && !out.includes(p)) out.push(p)
      if (out.length >= count) break
    }
    round++
  }
  return out.slice(0, count)
}
