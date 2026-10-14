export type Color = 'w' | 'b'
export type PieceSymbol = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'

export type TCType = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'custom'

export interface TimeControl {
  /** initial milliseconds */
  base: number
  /** increment milliseconds per move */
  inc: number
  type: TCType
  label: string
}

export type GameMode = 'online' | 'invite' | 'computer' | 'passplay' | 'puzzle' | 'analysis'

export type EndReason =
  | 'checkmate'
  | 'resign'
  | 'timeout'
  | 'stalemate'
  | 'threefold'
  | 'fivemove'
  | 'fifty'
  | 'insufficient'
  | 'agreement'
  | 'aborted'
  | 'disconnect'

export interface GameResult {
  /** color of the winner, null = draw */
  winner: Color | null
  reason: EndReason
}

export interface Ply {
  uci: string
  san: string
  /** FEN after this move */
  fen: string
  /** mover's color */
  color: Color
  /** clock snapshots AFTER the move (ms remaining) */
  wms: number
  bms: number
  /** wall-clock timestamp (ms) when the move was made */
  at: number
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const QUICK_TIME_CONTROLS: TimeControl[] = [
  { base: 60_000, inc: 0, type: 'bullet', label: '1+0' },
  { base: 120_000, inc: 1_000, type: 'bullet', label: '2+1' },
  { base: 180_000, inc: 0, type: 'blitz', label: '3+0' },
  { base: 180_000, inc: 2_000, type: 'blitz', label: '3+2' },
  { base: 300_000, inc: 0, type: 'blitz', label: '5+0' },
  { base: 600_000, inc: 0, type: 'rapid', label: '10+0' },
  { base: 900_000, inc: 10_000, type: 'rapid', label: '15+10' },
  { base: 1_800_000, inc: 0, type: 'classical', label: '30+0' },
]
