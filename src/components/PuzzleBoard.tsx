import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { Board } from '@/board/Board'
import { findCheckSquare } from '@/game/useGameSession'
import { useSettings } from '@/lib/settings'
import { sounds } from '@/lib/sounds'
import type { Puzzle } from '@/assets/puzzles'
import { sideToMove } from '@/assets/puzzles'

export interface PuzzleBoardProps {
  puzzle: Puzzle
  /** called once when the full solution is completed */
  onSolved: (seconds: number) => void
  /** called on each wrong attempt */
  onWrong?: () => void
  /** draw an arrow revealing the answer (give-up / rush failure) */
  showSolution?: boolean
  /** which square pair to flash red (last wrong guess) */
  className?: string
}

/**
 * Interactive puzzle board: user plays the solution for the side to move;
 * opponent replies are auto-played. Wrong moves never change the position.
 */
export function PuzzleBoard({ puzzle, onSolved, onWrong, showSolution = false, className = '' }: PuzzleBoardProps) {
  const settings = useSettings()
  const chessRef = useRef<Chess | null>(null)
  if (!chessRef.current || chessRef.current.fen().split(' ')[0] !== puzzle.fen.split(' ')[0]) {
    // fresh position (new puzzle or remount)
    try {
      chessRef.current = new Chess(puzzle.fen)
    } catch {
      chessRef.current = new Chess()
    }
  }
  const chess = chessRef.current

  const [fenNow, setFenNow] = useState(() => chess.fen())
  const [ply, setPly] = useState(0)
  const [status, setStatus] = useState<'playing' | 'wrong' | 'solved'>('playing')
  const [wrongFlash, setWrongFlash] = useState(false)
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const startRef = useRef(Date.now())
  const solvedFired = useRef(false)
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mySide = useMemo(() => sideToMove(puzzle.fen), [puzzle.fen])
  const checkSquare = useMemo(() => findCheckSquare(fenNow), [fenNow])

  useEffect(
    () => () => {
      if (replyTimer.current) clearTimeout(replyTimer.current)
    },
    [],
  )

  const applyUci = useCallback(
    (uci: string) => {
      try {
        const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined })
        setFenNow(chess.fen())
        setLastMove({ from: m.from, to: m.to })
        sounds.playMove(m.san)
        return m.san
      } catch {
        return null
      }
    },
    [chess],
  )

  const onMove = useCallback(
    (uci: string) => {
      if (status === 'solved') return
      const expected = puzzle.solution[ply]
      if (!expected) return
      if (uci === expected) {
        setStatus('playing')
        applyUci(uci)
        const nextPly = ply + 1
        setPly(nextPly)
        if (nextPly >= puzzle.solution.length) {
          setStatus('solved')
          if (!solvedFired.current) {
            solvedFired.current = true
            sounds.play('end-win')
            onSolved((Date.now() - startRef.current) / 1000)
          }
        } else {
          // opponent reply from the solution line
          replyTimer.current = setTimeout(() => {
            const reply = puzzle.solution[nextPly]
            if (reply) {
              applyUci(reply)
              setPly(nextPly + 1)
            }
          }, 420)
        }
      } else {
        setStatus('wrong')
        setWrongFlash(true)
        setTimeout(() => setWrongFlash(false), 450)
        sounds.play('lowtime')
        onWrong?.()
      }
    },
    [status, ply, puzzle, applyUci, onSolved, onWrong],
  )

  const userTurn = ply % 2 === 0 && status !== 'solved'
  const movable = userTurn && !showSolution ? [mySide] : []
  const solvedArrow = showSolution
    ? [{ from: puzzle.solution[0].slice(0, 2), to: puzzle.solution[0].slice(2, 4), color: 'rgba(255, 90, 90, 0.8)' }]
    : []

  return (
    <div className={`puzzle-board-wrap ${wrongFlash ? 'shake' : ''} ${className}`}>
      <Board
        fen={fenNow}
        orientation={mySide}
        movable={movable}
        onMove={onMove}
        legalTargets={(sq) => {
          try {
            return chess.moves({ square: sq as Square, verbose: true }).map((m) => m.to)
          } catch {
            return []
          }
        }}
        lastMove={lastMove}
        checkSquare={checkSquare}
        pieceSet={settings.pieceSet}
        coords={settings.coords}
        autoQueen={false}
        arrows={solvedArrow}
        ariaLabel={`Puzzle: ${puzzle.title}. ${mySide === 'w' ? 'White' : 'Black'} to move.`}
      />
    </div>
  )
}
