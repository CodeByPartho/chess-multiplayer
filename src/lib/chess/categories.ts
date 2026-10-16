/**
 * Rated-game category from a time control.
 *
 * estimated duration = base + 40 * increment seconds
 *   bullet    < 180s
 *   blitz     < 480s
 *   rapid     < 1500s
 *   classical >= 1500s
 *
 * The formula (not the tc.type label) decides, so custom time controls are
 * rated in the category they actually belong to. Standard presets map onto
 * their existing labels by construction.
 */
import type { TimeControl } from './types'

export type Category = 'bullet' | 'blitz' | 'rapid' | 'classical'

export const CATEGORIES: Category[] = ['bullet', 'blitz', 'rapid', 'classical']

/** estimated game duration in seconds for a time control */
export function estimateSeconds(tc: Pick<TimeControl, 'base' | 'inc'>): number {
  return Math.round(tc.base / 1000) + 40 * Math.round(tc.inc / 1000)
}

export function categoryFromSeconds(seconds: number): Category {
  if (seconds < 180) return 'bullet'
  if (seconds < 480) return 'blitz'
  if (seconds < 1500) return 'rapid'
  return 'classical'
}

export function categoryOf(tc: Pick<TimeControl, 'base' | 'inc'>): Category {
  return categoryFromSeconds(estimateSeconds(tc))
}

/** legacy pool name for a tc.type label (used where only the label is known) */
export function categoryFromType(type: string): Category {
  return type === 'bullet' || type === 'blitz' || type === 'rapid' ? type : 'classical'
}
