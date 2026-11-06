import { resultForMe, type GameRecord } from './history'
import { detectOpening } from '@/assets/openings'
import type { PuzzleStats } from './puzzleStats'

export interface OpeningStat {
  name: string
  eco: string
  games: number
  wins: number
  winPct: number
}

export interface Insights {
  total: number
  wins: number
  losses: number
  draws: number
  winPct: number
  asWhite: { games: number; wins: number; winPct: number }
  asBlack: { games: number; wins: number; winPct: number }
  topOpenings: OpeningStat[]
  avgAccuracy: number | null
  reviewed: number
}

function bucket(records: GameRecord[], color: 'w' | 'b') {
  const mine = records.filter((r) => r.myColor === color)
  const wins = mine.filter((r) => resultForMe(r) === 'win').length
  return { games: mine.length, wins, winPct: mine.length ? Math.round((wins / mine.length) * 100) : 0 }
}

export function buildInsights(records: GameRecord[], _puzzles: PuzzleStats): Insights {
  const mine = records.filter((r) => r.myColor)
  const wins = mine.filter((r) => resultForMe(r) === 'win').length
  const losses = mine.filter((r) => resultForMe(r) === 'loss').length
  const draws = mine.filter((r) => resultForMe(r) === 'draw').length

  const byOpening = new Map<string, OpeningStat>()
  for (const r of mine) {
    const op = detectOpening(r.moves.map((m) => m.san))
    if (!op) continue
    const key = op.name
    const cur = byOpening.get(key) ?? { name: op.name, eco: op.eco, games: 0, wins: 0, winPct: 0 }
    cur.games += 1
    if (resultForMe(r) === 'win') cur.wins += 1
    cur.winPct = Math.round((cur.wins / cur.games) * 100)
    byOpening.set(key, cur)
  }

  const accs: number[] = []
  for (const r of mine) {
    if (r.analysis && r.myColor) accs.push(r.myColor === 'w' ? r.analysis.accuracy.w : r.analysis.accuracy.b)
  }

  return {
    total: mine.length,
    wins,
    losses,
    draws,
    winPct: mine.length ? Math.round((wins / mine.length) * 100) : 0,
    asWhite: bucket(mine, 'w'),
    asBlack: bucket(mine, 'b'),
    topOpenings: [...byOpening.values()].sort((a, b) => b.games - a.games).slice(0, 5),
    avgAccuracy: accs.length ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length) : null,
    reviewed: accs.length,
  }
}

/* ------------------------------------------------------------------ */

export interface AchievementCtx {
  insights: Insights
  puzzlesSolved: number
  puzzleBestStreak: number
  rushBest: number
  dailyDoneCount: number
  lessonsDone: number
  lessonsTotal: number
  drillsDone: number
  drillsTotal: number
  coordBest: number
  stormBest: number
  streakBest: number
}

export interface Achievement {
  id: string
  name: string
  desc: string
  glyph: string
  unlocked: (c: AchievementCtx) => boolean
  progress: (c: AchievementCtx) => string
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-game', name: 'First steps', desc: 'Finish a game', glyph: '♟', unlocked: (c) => c.insights.total >= 1, progress: (c) => `${c.insights.total}/1 games` },
  { id: 'first-win', name: 'First blood', desc: 'Win a game', glyph: '♞', unlocked: (c) => c.insights.wins >= 1, progress: (c) => `${c.insights.wins}/1 wins` },
  { id: 'ten-wins', name: 'On a roll', desc: 'Win 10 games', glyph: '♜', unlocked: (c) => c.insights.wins >= 10, progress: (c) => `${c.insights.wins}/10 wins` },
  { id: 'fifty-games', name: 'Regular', desc: 'Play 50 games', glyph: '♝', unlocked: (c) => c.insights.total >= 50, progress: (c) => `${c.insights.total}/50 games` },
  { id: 'black-win', name: 'Win with Black', desc: 'Win a game playing the black pieces', glyph: '♚', unlocked: (c) => c.insights.asBlack.wins >= 1, progress: (c) => `${c.insights.asBlack.wins}/1 wins as Black` },
  { id: 'sharp', name: 'Sharp shooter', desc: 'Average 85% accuracy over reviewed games', glyph: '◎', unlocked: (c) => (c.insights.avgAccuracy ?? 0) >= 85 && c.insights.reviewed >= 1, progress: (c) => (c.insights.avgAccuracy === null ? 'review a game first' : `${c.insights.avgAccuracy}% average`) },
  { id: 'puzzle-25', name: 'Tactician', desc: 'Solve 25 puzzles', glyph: '♛', unlocked: (c) => c.puzzlesSolved >= 25, progress: (c) => `${c.puzzlesSolved}/25 solved` },
  { id: 'puzzle-100', name: 'Tactics machine', desc: 'Solve 100 puzzles', glyph: '♕', unlocked: (c) => c.puzzlesSolved >= 100, progress: (c) => `${c.puzzlesSolved}/100 solved` },
  { id: 'streak-10', name: 'Hot hand', desc: 'Reach a puzzle streak of 10', glyph: '≋', unlocked: (c) => c.puzzleBestStreak >= 10 || c.streakBest >= 10, progress: (c) => `best ${Math.max(c.puzzleBestStreak, c.streakBest)}/10` },
  { id: 'rush-10', name: 'Speed merchant', desc: 'Score 10 or more in Puzzle Rush or Storm', glyph: '»', unlocked: (c) => c.rushBest >= 10 || c.stormBest >= 10, progress: (c) => `best ${Math.max(c.rushBest, c.stormBest)}/10` },
  { id: 'daily-7', name: 'Daily habit', desc: 'Complete 7 daily puzzles', glyph: '▦', unlocked: (c) => c.dailyDoneCount >= 7, progress: (c) => `${c.dailyDoneCount}/7 days` },
  { id: 'student', name: 'Student', desc: 'Finish every lesson', glyph: '✎', unlocked: (c) => c.lessonsTotal > 0 && c.lessonsDone >= c.lessonsTotal, progress: (c) => `${c.lessonsDone}/${c.lessonsTotal} lessons` },
  { id: 'driller', name: 'Drill sergeant', desc: 'Complete every practice drill', glyph: '⚒', unlocked: (c) => c.drillsTotal > 0 && c.drillsDone >= c.drillsTotal, progress: (c) => `${c.drillsDone}/${c.drillsTotal} drills` },
  { id: 'navigator', name: 'Navigator', desc: 'Find 15 squares in the coordinates trainer', glyph: '⌖', unlocked: (c) => c.coordBest >= 15, progress: (c) => `best ${c.coordBest}/15` },
]
