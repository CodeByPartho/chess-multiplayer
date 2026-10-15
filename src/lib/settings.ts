import { useSyncExternalStore } from 'react'
import { load, save, STORAGE_KEYS } from './storage'

export interface Settings {
  appearance: 'dark' | 'light' | 'system'
  boardTheme: string
  pieceSet: string
  coords: boolean
  autoQueen: boolean
  sound: boolean
  volume: number
  premoves: boolean
  pieceAnimation: boolean
  showEval: boolean
  confirmActions: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  appearance: 'dark',
  boardTheme: 'green',
  pieceSet: 'cburnett',
  coords: true,
  autoQueen: false,
  sound: true,
  volume: 0.7,
  premoves: true,
  pieceAnimation: true,
  showEval: true,
  confirmActions: true,
}

let current: Settings = { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(STORAGE_KEYS.settings, {}) }
const listeners = new Set<() => void>()

export function getSettings(): Settings {
  return current
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch }
  save(STORAGE_KEYS.settings, current)
  listeners.forEach((l) => l())
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** React hook: re-renders on settings changes. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings)
}
