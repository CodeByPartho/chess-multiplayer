import { Chess } from 'chess.js'
import type { Move } from 'chess.js'
import type { Color, GameResult, Ply, TimeControl } from './types'
import { START_FEN } from './types'
import { applyMove, flagFallen, initialClock, remaining, type ClockState } from './clocks'

export interface GameOptions {
  fen?: string
  /** null = untimed (analysis, puzzles) */
  tc?: TimeControl | null
  now: number
}

export class IllegalMoveError extends Error {
  constructor(readonly uci: string) {
    super(`Illegal move: ${uci}`)
    this.name = 'IllegalMoveError'
  }
}

/** Repetition key: first four FEN fields (castling/ep included). */
function repKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

/**
 * Pure game state machine around chess.js: plies, clocks, termination rules.
 * No UI, no network — everything here is unit-testable.
 */
export class GameCore {
  readonly chess: Chess
  readonly startFen: string
  readonly tc: TimeControl | null
  plies: Ply[] = []
  clock: ClockState | null = null
  result: GameResult | null = null
  /** draw offered by a color, awaiting the other side's answer */
  drawOfferedBy: Color | null = null
  private rep = new Map<string, number>()

  constructor(opts: GameOptions) {
    this.startFen = opts.fen ?? START_FEN
    this.chess = new Chess(this.startFen)
    this.tc = opts.tc ?? null
    if (this.tc) {
      // clock turn must follow the position's side to move (custom FENs can
      // start with black to move)
      this.clock = { ...initialClock(this.tc.base, opts.now), turn: this.chess.turn() as Color }
    }
    this.bumpRep(this.chess.fen())
  }

  get fen(): string {
    return this.chess.fen()
  }

  get turn(): Color {
    return this.chess.turn() as Color
  }

  get over(): boolean {
    return this.result !== null
  }

  get moves(): Move[] {
    return this.chess.moves({ verbose: true })
  }

  legalTargets(square: string): string[] {
    return this.chess
      .moves({ square: square as never, verbose: true })
      .map((m) => m.to)
  }

  remaining(side: Color, now: number): number | null {
    return this.clock ? remaining(this.clock, side, now) : null
  }

  canMove(side: Color, now: number): boolean {
    if (this.over) return false
    if (this.turn !== side) return false
    if (this.clock && remaining(this.clock, side, now) <= 0) return false
    return true
  }

  /**
   * Apply a move (uci like "e2e4" or "e7e8q"). Throws IllegalMoveError when the
   * move is not legal in the current position.
   */
  moveByUci(uci: string, now: number): Ply {
    if (this.over) throw new IllegalMoveError(uci)
    const from = uci.slice(0, 2)
    const to = uci.slice(2, 4)
    const promotion = uci.length > 4 ? uci[4] : undefined
    let move: Move
    try {
      move = this.chess.move({ from, to, promotion })
    } catch {
      throw new IllegalMoveError(uci)
    }
    const mover = move.color as Color
    if (this.clock) {
      this.clock = applyMove(this.clock, mover, this.tc!.inc, now)
    }
    this.drawOfferedBy = null
    const ply: Ply = {
      uci,
      san: move.san,
      fen: this.chess.fen(),
      color: mover,
      wms: this.clock?.wms ?? 0,
      bms: this.clock?.bms ?? 0,
      at: now,
    }
    this.plies.push(ply)
    this.bumpRep(ply.fen)
    this.checkTermination(mover)
    return ply
  }

  private bumpRep(fen: string): void {
    const k = repKey(fen)
    this.rep.set(k, (this.rep.get(k) ?? 0) + 1)
  }

  private repetitionCount(fen: string): number {
    return this.rep.get(repKey(fen)) ?? 0
  }

  /** Returns the result if the current position ends the game, else null. */
  private detectEnd(mover: Color | null): GameResult | null {
    if (this.chess.isCheckmate()) {
      // the side to move is mated; the mover delivered mate
      return { winner: mover, reason: 'checkmate' }
    }
    if (this.chess.isStalemate()) return { winner: null, reason: 'stalemate' }
    if (this.chess.isInsufficientMaterial()) return { winner: null, reason: 'insufficient' }
    if (this.repetitionCount(this.chess.fen()) >= 5) return { winner: null, reason: 'fivemove' }
    if (this.chess.isThreefoldRepetition()) return { winner: null, reason: 'threefold' }
    if (this.chess.isDrawByFiftyMoves()) return { winner: null, reason: 'fifty' }
    return null
  }

  private checkTermination(mover: Color | null): void {
    const r = this.detectEnd(mover)
    if (r) this.result = r
  }

  /** Resign: the resigning side loses. */
  resign(by: Color): void {
    if (this.over) return
    this.result = { winner: by === 'w' ? 'b' : 'w', reason: 'resign' }
  }

  /** Abort: only possible before both players have moved. */
  abort(by: Color): boolean {
    if (this.over) return false
    if (this.plies.length >= 2) return false
    // only the player who has not yet moved (or before opponent's first move completes) may abort
    const sideMoved = this.plies.some((p) => p.color === by)
    if (sideMoved) return false
    this.result = { winner: null, reason: 'aborted' }
    return true
  }

  /**
   * Flag fall. On timeout the side flagged loses — unless the position has
   * insufficient mating material, in which case it is a draw.
   */
  timeout(side: Color, now: number): boolean {
    if (this.over || !this.clock) return false
    if (!flagFallen(this.clock, side, now)) return false
    this.result = this.chess.isInsufficientMaterial()
      ? { winner: null, reason: 'insufficient' }
      : { winner: side === 'w' ? 'b' : 'w', reason: 'timeout' }
    return true
  }

  agreeDraw(): void {
    if (!this.over) this.result = { winner: null, reason: 'agreement' }
  }

  offerDraw(by: Color): void {
    if (!this.over) this.drawOfferedBy = by
  }

  declineDraw(): void {
    this.drawOfferedBy = null
  }

  /** Pop up to `count` plies (keeps move parity: always pops an even number back to the requester's turn). */
  takeback(count = 2): void {
    const n = Math.min(count, this.plies.length)
    if (n <= 0) return
    for (let i = 0; i < n; i++) this.plies.pop()
    this.rebuildFromPlies()
  }

  /** Rebuild chess + clocks + repetition from the current ply list. */
  private rebuildFromPlies(): void {
    this.chess.load(this.startFen)
    this.rep.clear()
    this.bumpRep(this.chess.fen())
    this.result = null
    const plies = this.plies.splice(0)
    for (const p of plies) {
      const from = p.uci.slice(0, 2)
      const to = p.uci.slice(2, 4)
      const promotion = p.uci.length > 4 ? p.uci[4] : undefined
      this.chess.move({ from, to, promotion })
      this.bumpRep(this.chess.fen())
      this.plies.push(p)
    }
    const last = this.plies[this.plies.length - 1]
    if (this.tc) {
      this.clock = last
        ? { wms: last.wms, bms: last.bms, lastMoveAt: last.at, turn: this.chess.turn() as Color }
        : { ...initialClock(this.tc.base, Date.now()), turn: this.chess.turn() as Color }
    }
    this.checkTermination(this.plies.length ? this.plies[this.plies.length - 1].color : null)
  }

  /** Rebuild a game from server plies (reconnect, spectator, review). */
  static replay(startFen: string, plies: Ply[], tc: TimeControl | null, now = Date.now()): GameCore {
    const g = new GameCore({ fen: startFen, tc, now })
    for (const p of plies) {
      g.moveByUci(p.uci, p.at)
      // overwrite with authoritative server values
      g.plies[g.plies.length - 1] = p
    }
    return g
  }
}
