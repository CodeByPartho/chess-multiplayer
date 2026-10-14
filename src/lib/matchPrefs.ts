import type { TimeControl } from './chess/types'

export interface MatchPrefs {
  tc: TimeControl
  rated: boolean
}

let prefs: MatchPrefs | null = null

export function setMatchPrefs(p: MatchPrefs): void {
  prefs = p
}

export function getMatchPrefs(): MatchPrefs | null {
  return prefs
}
