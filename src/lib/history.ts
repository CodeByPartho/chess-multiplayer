import { load, save, STORAGE_KEYS } from './storage'
import type { Color, GameResult, TimeControl, GameMode } from './chess/types'

export interface GameRecordPlayer {
  name: string
  rating: number | string
  avatarSeed: string
  flag: string | null
}

export interface GameRecord {
  id: string
  mode: GameMode
  tc: TimeControl | null
  rated: boolean
  startFen: string
  moves: { uci: string; san: string }[]
  result: GameResult
  white: GameRecordPlayer
  black: GameRecordPlayer
  myColor: Color | null
  date: number
  /** optional precomputed analysis (game review) */
  analysis?: {
    classes: Record<number, string>
    accuracy: { w: number; b: number }
    evals: { cp?: number; mate?: number }[]
  }
}

const MAX = 60

export function loadHistory(): GameRecord[] {
  return load<GameRecord[]>(STORAGE_KEYS.history, [])
}

export function saveGame(rec: GameRecord): void {
  const list = loadHistory()
  const idx = list.findIndex((g) => g.id === rec.id)
  if (idx >= 0) list[idx] = rec
  else list.unshift(rec)
  if (list.length > MAX) list.length = MAX
  save(STORAGE_KEYS.history, list)
}

export function getGame(id: string): GameRecord | null {
  return loadHistory().find((g) => g.id === id) ?? null
}

/** who won from `myColor`'s perspective */
export function resultForMe(rec: GameRecord): 'win' | 'loss' | 'draw' | null {
  if (!rec.myColor || !rec.result.winner) return null
  return rec.result.winner === rec.myColor ? 'win' : 'loss'
}
