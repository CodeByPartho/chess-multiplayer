export interface ComputerLevel {
  level: number
  name: string
  elo: number
  blurb: string
}

/**20 personalities, weakest → strongest. Level drives Stockfish skill + think time. */
export const COMPUTER_LEVELS: ComputerLevel[] = [
  { level: 1, name: 'Curious Rookie', elo: 350, blurb: 'Just learned how the horse moves.' },
  { level: 2, name: 'Greedy Gobbler', elo: 500, blurb: 'Will take any piece that looks tasty.' },
  { level: 3, name: 'Corner Cat', elo: 620, blurb: 'Hides in the corner… mostly.' },
  { level: 4, name: 'Happy Hammer', elo: 750, blurb: 'Hammers pieces forward with joy.' },
  { level: 5, name: 'Shield Shepherd', elo: 880, blurb: 'Guards pawns like a flock of sheep.' },
  { level: 6, name: 'Steady Eddie', elo: 1000, blurb: 'No blunders, no brilliancies.' },
  { level: 7, name: 'Pawn Stormer', elo: 1130, blurb: 'Loves pushing pawns at your king.' },
  { level: 8, name: 'Knight Navigator', elo: 1260, blurb: 'Sees forks before you do.' },
  { level: 9, name: 'Bishop Brothers', elo: 1390, blurb: 'Keeps the bishop pair and the pressure.' },
  { level: 10, name: 'Fortress Keeper', elo: 1520, blurb: 'Hard to crack, patient as stone.' },
  { level: 11, name: 'Center Controller', elo: 1650, blurb: 'Occupies the middle and never leaves.' },
  { level: 12, name: 'Tactician Tess', elo: 1780, blurb: 'Every loose piece is a target.' },
  { level: 13, name: 'Endgame Elsa', elo: 1910, blurb: 'Trades down and grinds you out.' },
  { level: 14, name: 'Sacrifice Sam', elo: 2040, blurb: 'Attacks with fire, calculates with ice.' },
  { level: 15, name: 'Iron Wall', elo: 2170, blurb: 'Defends like it is personal.' },
  { level: 16, name: 'Lightning Luc', elo: 2300, blurb: 'Finds the tactic instantly.' },
  { level: 17, name: 'Positional Paula', elo: 2440, blurb: 'Squeezes water from stone.' },
  { level: 18, name: 'The Professor', elo: 2580, blurb: 'Explains the loss… after delivering it.' },
  { level: 19, name: 'Immortal Engine', elo: 2720, blurb: 'Plays like the classics, minus the mercy.' },
  { level: 20, name: 'Stockfish Prime', elo: 2900, blurb: 'Full strength. Good luck.' },
]

/** think time in ms for a level (skill level does the rest) */
export function thinkTimeFor(level: number): number {
  return 150 + level * 65
}
