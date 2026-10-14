import { load, save } from './storage'

export interface PuzzleStats {
  solved: number
  attempts: number
  streak: number
  bestStreak: number
  rushBest: number
  themeStats: Record<string, { solved: number; attempts: number }>
  /** daily puzzle completion per day key (YYYY-MM-DD) */
  dailyDone: Record<string, boolean>
}

const EMPTY: PuzzleStats = {
  solved: 0,
  attempts: 0,
  streak: 0,
  bestStreak: 0,
  rushBest: 0,
  themeStats: {},
  dailyDone: {},
}

export function loadPuzzleStats(): PuzzleStats {
  return { ...EMPTY, ...load<PuzzleStats>('cm.puzzleStats', EMPTY) }
}

export function savePuzzleStats(s: PuzzleStats): void {
  save('cm.puzzleStats', s)
}

export function recordPuzzleResult(stats: PuzzleStats, themes: string[], solved: boolean): PuzzleStats {
  const next: PuzzleStats = {
    ...stats,
    attempts: stats.attempts + 1,
    solved: stats.solved + (solved ? 1 : 0),
    streak: solved ? stats.streak + 1 : 0,
    bestStreak: solved ? Math.max(stats.bestStreak, stats.streak + 1) : stats.bestStreak,
    themeStats: { ...stats.themeStats },
  }
  for (const t of themes) {
    const cur = next.themeStats[t] ?? { solved: 0, attempts: 0 }
    next.themeStats[t] = { solved: cur.solved + (solved ? 1 : 0), attempts: cur.attempts + 1 }
  }
  savePuzzleStats(next)
  return next
}

export function markDailyDone(stats: PuzzleStats, dayKey: string): PuzzleStats {
  const next = { ...stats, dailyDone: { ...stats.dailyDone, [dayKey]: true } }
  savePuzzleStats(next)
  return next
}

export function recordRushBest(score: number): PuzzleStats {
  const stats = loadPuzzleStats()
  const next = { ...stats, rushBest: Math.max(stats.rushBest, score) }
  savePuzzleStats(next)
  return next
}

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
