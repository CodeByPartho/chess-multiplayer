import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { GameCore } from '@/lib/chess/game'
import type { Color, GameResult, TimeControl, GameMode } from '@/lib/chess/types'
import type { PieceColor, PieceType } from '@/board/pieces'
import { sounds } from '@/lib/sounds'

export interface BoardMove {
  from: string
  to: string
}

/** find the king square of the side to move when it is in check */
export function findCheckSquare(fen: string): string | null {
  let c: Chess
  try {
    c = new Chess(fen)
  } catch {
    return null
  }
  if (!c.inCheck()) return null
  const turn = c.turn()
  for (const row of c.board()) {
    for (const sq of row) {
      if (sq && sq.type === 'k' && sq.color === turn) return sq.square
    }
  }
  return null
}

export interface UseGameSessionOpts {
  mode: GameMode
  fen?: string
  tc?: TimeControl | null
  /** moves to replay immediately from the start position (game load / review) */
  initialUcis?: string[]
  /** colors the local user controls (both for pass & play) */
  myColors: Color[]
  /** which color counts as "me" for win/lose sounds; null = neutral */
  myColorForSound?: Color | null
  onResult?: (result: GameResult) => void
  /** whether queued premoves are allowed */
  premoves?: boolean
}

export function useGameSession(opts: UseGameSessionOpts) {
  const coreRef = useRef<GameCore | null>(null)
  if (!coreRef.current) {
    const g = new GameCore({ fen: opts.fen, tc: opts.tc ?? null, now: Date.now() })
    for (const uci of opts.initialUcis ?? []) {
      try {
        g.moveByUci(uci, Date.now())
      } catch {
        break // malformed line — keep what loaded
      }
    }
    coreRef.current = g
  }
  const [, force] = useReducer((n: number) => n + 1, 0)
  const core = coreRef.current!

  /** swap the underlying core wholesale (online sync rebuilds from server) */
  const replaceCore = useCallback((g: GameCore) => {
    coreRef.current = g
    force()
  }, [])
  const [viewPly, setViewPly] = useState<number | null>(null)
  const [premove, setPremove] = useState<BoardMove | null>(null)
  const resultFired = useRef(false)

  const over = core.over
  const turn = core.turn
  const plies = core.plies
  const displayPly = viewPly === null ? plies.length : Math.min(viewPly, plies.length)
  const isLive = displayPly === plies.length

  const displayFen = displayPly === 0 ? core.startFen : plies[displayPly - 1].fen
  const displayLastMove: BoardMove | null =
    displayPly === 0 ? null : { from: plies[displayPly - 1].uci.slice(0, 2), to: plies[displayPly - 1].uci.slice(2, 4) }
  const checkSquare = useMemo(() => findCheckSquare(displayFen), [displayFen])

  const playEndSound = useCallback(
    (r: GameResult) => {
      const me = opts.myColorForSound ?? null
      if (!r.winner || me === null) sounds.play('end-draw')
      else sounds.play(r.winner === me ? 'end-win' : 'end-lose')
    },
    [opts.myColorForSound],
  )

  // result notification
  useEffect(() => {
    if (over && !resultFired.current) {
      resultFired.current = true
      playEndSound(core.result!)
      opts.onResult?.(core.result!)
    }
  }, [over]) // eslint-disable-line react-hooks/exhaustive-deps

  // clock ticking + flag detection
  useEffect(() => {
    if (!core.tc || over) return
    const id = setInterval(() => {
      const now = Date.now()
      if (core.clock && core.timeout(core.clock.turn, now)) {
        force()
      } else if (core.clock) {
        force()
      }
    }, 150)
    return () => clearInterval(id)
  }, [core, over])

  const applyMoveNow = useCallback(
    (uci: string): boolean => {
      try {
        const ply = core.moveByUci(uci, Date.now())
        sounds.playMove(ply.san)
        force()
        return true
      } catch {
        return false
      }
    },
    [core],
  )

  // execute queued premove once it's our turn again
  useEffect(() => {
    if (!premove || over || !isLive) return
    if (!opts.myColors.includes(turn)) return
    setPremove(null)
    const uci = `${premove.from}${premove.to}`
    const ok = applyMoveNow(uci)
    if (!ok) {
      sounds.play('lowtime') // soft "illegal" cue
      // note: underpromotion in premoves is impossible (Board queues queen)
    }
  }, [premove, over, isLive, turn, applyMoveNow, opts.myColors])

  const tryUserMove = useCallback(
    (uci: string): boolean => {
      if (over || !isLive) return false
      if (opts.myColors.includes(turn)) {
        const ok = applyMoveNow(uci)
        if (!ok) sounds.play('lowtime')
        return ok
      }
      // not our turn → queue premove
      if (opts.premoves !== false && opts.myColors.length === 1) {
        setPremove({ from: uci.slice(0, 2), to: uci.slice(2, 4) })
        return true
      }
      return false
    },
    [over, isLive, turn, applyMoveNow, opts.myColors, opts.premoves],
  )

  const movable: Color[] = !over && isLive && opts.myColors.includes(turn) ? opts.myColors : []

  const legalTargets = useCallback((square: string) => core.legalTargets(square), [core])

  const seek = useCallback(
    (ply: number) => {
      setViewPly(ply >= core.plies.length ? null : Math.max(0, ply))
    },
    [core],
  )

  const resign = useCallback(
    (by: Color) => {
      core.resign(by)
      force()
    },
    [core],
  )
  const offerDraw = useCallback(
    (by: Color) => {
      core.offerDraw(by)
      force()
    },
    [core],
  )
  const agreeDraw = useCallback(() => {
    core.agreeDraw()
    force()
  }, [core])
  const declineDraw = useCallback(() => {
    core.declineDraw()
    force()
  }, [core])
  const takeback = useCallback(
    (count = 2) => {
      core.takeback(count)
      setViewPly(null)
      force()
    },
    [core],
  )
  const abort = useCallback(
    (by: Color) => {
      core.abort(by)
      force()
    },
    [core],
  )

  return {
    core,
    replaceCore,
    over,
    turn,
    result: core.result,
    plies,
    sans: plies.map((p) => p.san),
    displayPly,
    displayFen,
    displayLastMove,
    checkSquare,
    isLive,
    movable,
    legalTargets,
    tryUserMove,
    /** apply a move from a non-user source (engine, server echo) */
    applyExternalMove: applyMoveNow,
    seek,
    resign,
    offerDraw,
    agreeDraw,
    declineDraw,
    takeback,
    abort,
    premove,
    clearPremove: () => setPremove(null),
    forceUpdate: force,
  }
}

/** pieces captured BY each color (opponent material lost), derived by diffing boards */
export function capturedPieces(
  startFen: string,
  fen: string,
): { byWhite: { type: PieceType; color: PieceColor }[]; byBlack: { type: PieceType; color: PieceColor }[] } {
  const count = (f: string) => {
    const c = new Chess(f)
    const m = new Map<string, number>()
    for (const row of c.board()) {
      for (const sq of row) {
        if (!sq) continue
        const k = `${sq.color}${sq.type}`
        m.set(k, (m.get(k) ?? 0) + 1)
      }
    }
    return m
  }
  const a = count(startFen)
  const b = count(fen)
  const lost: { w: { type: PieceType; color: PieceColor }[]; b: { type: PieceType; color: PieceColor }[] } = { w: [], b: [] }
  for (const [k, n] of a) {
    const have = b.get(k) ?? 0
    const missing = n - have
    for (let i = 0; i < missing; i++) {
      const color = k[0] as PieceColor
      const type = k[1] as PieceType
      lost[color].push({ type, color })
    }
  }
  // pieces lost by white were captured by black, and vice versa
  return { byWhite: lost.b, byBlack: lost.w }
}
