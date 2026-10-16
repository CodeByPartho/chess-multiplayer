export interface ComputerLevel {
  level: number
  name: string
  elo: number
  blurb: string
}

/** 20 personalities, weakest (~200) → full-strength Stockfish. Level drives the strength policy. */
export const COMPUTER_LEVELS: ComputerLevel[] = [
  { level: 1, name: 'Curious Rookie', elo: 200, blurb: 'Just learned how the horse moves.' },
  { level: 2, name: 'Greedy Gobbler', elo: 350, blurb: 'Will take any piece that looks tasty.' },
  { level: 3, name: 'Corner Cat', elo: 500, blurb: 'Hides in the corner… mostly.' },
  { level: 4, name: 'Happy Hammer', elo: 630, blurb: 'Hammers pieces forward with joy.' },
  { level: 5, name: 'Shield Shepherd', elo: 760, blurb: 'Guards pawns like a flock of sheep.' },
  { level: 6, name: 'Steady Eddie', elo: 890, blurb: 'No blunders, no brilliancies.' },
  { level: 7, name: 'Pawn Stormer', elo: 1010, blurb: 'Loves pushing pawns at your king.' },
  { level: 8, name: 'Knight Navigator', elo: 1140, blurb: 'Sees forks before you do.' },
  { level: 9, name: 'Bishop Brothers', elo: 1260, blurb: 'Keeps the bishop pair and the pressure.' },
  { level: 10, name: 'Fortress Keeper', elo: 1390, blurb: 'Hard to crack, patient as stone.' },
  { level: 11, name: 'Center Controller', elo: 1520, blurb: 'Occupies the middle and never leaves.' },
  { level: 12, name: 'Tactician Tess', elo: 1650, blurb: 'Every loose piece is a target.' },
  { level: 13, name: 'Endgame Elsa', elo: 1780, blurb: 'Trades down and grinds you out.' },
  { level: 14, name: 'Sacrifice Sam', elo: 1910, blurb: 'Attacks with fire, calculates with ice.' },
  { level: 15, name: 'Iron Wall', elo: 2040, blurb: 'Defends like it is personal.' },
  { level: 16, name: 'Lightning Luc', elo: 2170, blurb: 'Finds the tactic instantly.' },
  { level: 17, name: 'Positional Paula', elo: 2320, blurb: 'Squeezes water from stone.' },
  { level: 18, name: 'The Professor', elo: 2470, blurb: 'Explains the loss… after delivering it.' },
  { level: 19, name: 'Immortal Engine', elo: 2650, blurb: 'Plays like the classics, minus the mercy.' },
  { level: 20, name: 'Stockfish Prime', elo: 2900, blurb: 'Full strength. Good luck.' },
]

/** Stockfish refuses Elo targets below ~1320 — the weak band uses policy instead */
export const WEAK_ELO_CEILING = 1320

export interface BotPolicy {
  /** Skill 0 + shallow depth + occasional injected blunders */
  weak: boolean
  /** hard search depth for weak bots (undefined = movetime governs) */
  depth?: number
  /** percent chance a returned line is deliberately suboptimal */
  blunderPct: number
}

/**
 * How a level is played by the engine:
 *  - sub-1320 levels run Stockfish at Skill 0 (its weakest reliable mode)
 *    with a shallow depth cap and a controlled rate of "played the second
 *    best idea / the worst idea" blunders, so the ladder from ~200 up is
 *    gradual instead of cliff-like;
 *  - 1320+ levels use UCI_Elo limiting for calibrated strength.
 */
export function botPolicyFor(level: number): BotPolicy {
  const l = Math.max(1, Math.min(20, Math.round(level)))
  const elo = COMPUTER_LEVELS[l - 1]?.elo ?? 1500
  if (elo >= WEAK_ELO_CEILING) return { weak: false, blunderPct: 0 }
  return {
    weak: true,
    depth: 2 + Math.floor((l - 1) / 3), // levels 1-3: 2 · 4-6: 3 · 7-9: 4
    blunderPct: Math.max(8, 50 - l * 5),
  }
}

/** think time in ms for a level (weak levels stop at their depth cap first) */
export function thinkTimeFor(level: number): number {
  return 150 + level * 65
}
