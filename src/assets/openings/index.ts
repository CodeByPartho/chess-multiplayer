import data from './openings.json'

export interface Opening {
  eco: string
  name: string
  sans: string[]
}

export const openings: Opening[] = data

/**
 * Returns the opening whose ECO main line is the longest prefix of `sans`,
 * or null if the move sequence matches no known opening.
 */
export function detectOpening(sans: string[]): Opening | null {
  let best: Opening | null = null
  for (const opening of openings) {
    const { sans: line } = opening
    if (line.length > sans.length) continue
    if (best && line.length <= best.sans.length) continue
    let matches = true
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== sans[i]) {
        matches = false
        break
      }
    }
    if (matches) best = opening
  }
  return best
}
