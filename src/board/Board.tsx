import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { pieceUrl, type PieceColor, type PieceType } from './pieces'

export interface Arrow {
  from: string
  to: string
  color?: string
}

export interface BoardMove {
  from: string
  to: string
}

interface PieceInst {
  id: number
  color: PieceColor
  type: PieceType
  sq: string
}

const FILES = 'abcdefgh'

export interface BoardProps {
  fen: string
  orientation: PieceColor
  /** colors the user may pick up; empty = view only */
  movable?: PieceColor[]
  /** called with a completed uci (promotion suffix included); parent validates */
  onMove?: (uci: string) => void
  /** legal destination squares for a source square (parent rules engine) */
  legalTargets?: (square: string) => string[]
  lastMove?: BoardMove | null
  /** square of the king in check */
  checkSquare?: string | null
  pieceSet: string
  coords?: boolean
  autoQueen?: boolean
  /** highlight queued premove */
  premove?: BoardMove | null
  /** static arrows (best move / hints) */
  arrows?: Arrow[]
  /** enable right-click arrows & marks */
  interactiveMarks?: boolean
  /** board editor: clicks place/erase the given piece */
  editorPiece?: { color: PieceColor; type: PieceType } | null
  onEditorPlace?: (square: string) => void
  /** right-click target in editor mode (erase); falls back to onEditorPlace */
  onEditorErase?: (square: string) => void
  /** keyboard cursor initially visible */
  keyboard?: boolean
  className?: string
  ariaLabel?: string
  /** dim overlay (e.g. while computer thinks) */
  overlay?: React.ReactNode
}

function parseBoard(fen: string): PieceInst[] {
  const out: PieceInst[] = []
  let id = 0
  try {
    const rows = fen.split(' ')[0].split('/')
    if (rows.length !== 8) return out
    rows.forEach((row, i) => {
      const rank = 8 - i
      let file = 0
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') {
          file += Number(ch)
        } else {
          if (file > 7) return
          const color: PieceColor = ch === ch.toUpperCase() ? 'w' : 'b'
          out.push({ id: id++, color, type: ch.toLowerCase() as PieceType, sq: FILES[file] + rank })
          file++
        }
      }
    })
  } catch {
    /* malformed fen — empty board */
  }
  return out
}

function occupancyKey(list: PieceInst[]): string {
  return list
    .map((p) => `${p.sq}${p.color}${p.type}`)
    .sort()
    .join(',')
}

/** apply a move to the internal piece list; returns null if it can't be done safely */
function applyMoveToPieces(list: PieceInst[], mv: BoardMove): PieceInst[] | null {
  const mover = list.find((p) => p.sq === mv.from)
  if (!mover) return null
  const next = list.filter((p) => p.sq !== mv.to && p.sq !== mv.from)
  const fromF = FILES.indexOf(mv.from[0])
  const toF = FILES.indexOf(mv.to[0])
  const fromR = Number(mv.from[1])

  // en passant: pawn moves diagonally onto an empty square
  if (mover.type === 'p' && fromF !== toF && !list.some((p) => p.sq === mv.to)) {
    const capSq = FILES[toF] + fromR
    const idx = next.findIndex((p) => p.sq === capSq && p.color !== mover.color && p.type === 'p')
    if (idx >= 0) next.splice(idx, 1)
  }

  // castling: king moves two files → carry the rook
  if (mover.type === 'k' && Math.abs(toF - fromF) === 2) {
    const rank = mover.color === 'w' ? '1' : '8'
    const rookFrom = (toF > fromF ? 'h' : 'a') + rank
    const rookTo = (toF > fromF ? 'f' : 'd') + rank
    const rook = next.find((p) => p.sq === rookFrom && p.type === 'r' && p.color === mover.color)
    if (rook) next.push({ ...rook, sq: rookTo })
  }

  // promotion: pawn reaching last rank becomes whatever the fen says (checked below)
  next.push({ ...mover, sq: mv.to })
  return next
}

function squareToXY(square: string, orientation: PieceColor): [number, number] {
  const f = FILES.indexOf(square[0])
  const r = Number(square[1])
  const x = orientation === 'w' ? f : 7 - f
  const y = orientation === 'w' ? 8 - r : r - 1
  return [x, y]
}

function pointToSquare(x: number, y: number, orientation: PieceColor): string | null {
  if (x < 0 || x > 7 || y < 0 || y > 7) return null
  const f = orientation === 'w' ? x : 7 - x
  const rank = orientation === 'w' ? 8 - y : y + 1
  return FILES[f] + rank
}

const DRAG_THRESHOLD = 5

export function Board({
  fen,
  orientation,
  movable = [],
  onMove,
  legalTargets,
  lastMove,
  checkSquare,
  pieceSet,
  coords = true,
  autoQueen = false,
  premove = null,
  arrows = [],
  interactiveMarks = true,
  editorPiece,
  onEditorPlace,
  onEditorErase,
  keyboard = false,
  className = '',
  ariaLabel = 'Chess board',
  overlay,
}: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null)

  const [pieces, setPieces] = useState<PieceInst[]>(() => parseBoard(fen))
  const appliedFen = useRef(fen)
  const [selected, setSelected] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; startX: number; startY: number; active: boolean } | null>(null)
  const [promo, setPromo] = useState<{ from: string; to: string; color: PieceColor } | null>(null)
  const [marks, setMarks] = useState<{ arrows: Arrow[]; squares: string[] }>({ arrows: [], squares: [] })
  const [drawFrom, setDrawFrom] = useState<string | null>(null)
  const [kbd, setKbd] = useState<string | null>(keyboard ? 'e2' : null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editing = editorPiece !== undefined

  /* ---- keep piece instances in sync with fen ---- */
  useEffect(() => {
    if (appliedFen.current === fen) return
    appliedFen.current = fen
    setPieces((prev) => {
      if (lastMove && prev.length > 0) {
        const moved = applyMoveToPieces(prev, lastMove)
        if (moved && occupancyKey(moved) === occupancyKey(parseBoard(fen))) return moved
      }
      return parseBoard(fen)
    })
    setSelected(null)
    setPromo(null)
  }, [fen, lastMove])

  /* ---- clear marks when the position jumps (not a single move) ---- */
  useEffect(() => {
    setMarks({ arrows: [], squares: [] })
  }, [fen])

  const isOwn = useCallback(
    (sq: string) => {
      const p = pieces.find((x) => x.sq === sq)
      return !!p && movable.includes(p.color)
    },
    [pieces, movable],
  )

  const targets = useMemo(() => {
    if (!selected || !legalTargets) return []
    return legalTargets(selected)
  }, [selected, legalTargets])

  /* ---------- pointer handling ---------- */
  const squareFromEvent = useCallback((e: { clientX: number; clientY: number }): string | null => {
    const el = boardRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * 8)
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * 8)
    return pointToSquare(x, y, orientation)
  }, [orientation])

  const queueMove = useCallback(
    (from: string, to: string) => {
      if (!onMove) return
      const piece = pieces.find((p) => p.sq === from)
      const isPromo = piece?.type === 'p' && (to[1] === '1' || to[1] === '8')
      if (isPromo && !autoQueen) {
        setPromo({ from, to, color: piece.color })
        return
      }
      onMove(from + to + (isPromo ? 'q' : ''))
      setSelected(null)
    },
    [onMove, pieces, autoQueen],
  )

  const onPointerDown = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      const sq = squareFromEvent(e)
      if (!sq) return

      // right button: draw arrows / marks
      if (e.button === 2) {
        if (editing) {
          ;(onEditorErase ?? onEditorPlace)?.(sq)
          return
        }
        if (!interactiveMarks) return
        e.preventDefault()
        setDrawFrom(sq)
        return
      }
      if (e.button !== 0) return

      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      } catch {
        /* synthetic events / capture unsupported */
      }

      if (editing) {
        onEditorPlace?.(sq)
        return
      }

      // keyboard/other: promote
      if (promo) return

      const canMove = isOwn(sq)

      // clicking a legal target while selected → move (click-move)
      if (selected && sq !== selected && targets.includes(sq)) {
        queueMove(selected, sq)
        return
      }

      if (canMove) {
        setSelected(sq)
        setDrag({ from: sq, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, active: false })
      } else if (selected) {
        setSelected(null)
      }
    },
    [squareFromEvent, editing, onEditorPlace, onEditorErase, interactiveMarks, isOwn, selected, targets, queueMove, promo],
  )

  const onPointerMove = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      if (drawFrom) {
        const sq = squareFromEvent(e)
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        hoverTimer.current = setTimeout(() => setDrawFrom(null), 400)
        if (sq && sq !== drawFrom) {
          // preview arrow
          setMarks((m) => ({
            ...m,
            arrows: [...m.arrows.filter((a) => !(a.from === drawFrom && a.to === sq)), { from: drawFrom, to: sq }],
          }))
          setDrawFrom(sq)
        }
        return
      }
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      setDrag({ ...drag, x: e.clientX, y: e.clientY, active: true })
    },
    [drawFrom, drag, squareFromEvent],
  )

  const onPointerUp = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (drawFrom) {
        const sq = squareFromEvent(e)
        if (sq === drawFrom) {
          setMarks((m) => ({
            ...m,
            squares: m.squares.includes(sq) ? m.squares.filter((s) => s !== sq) : [...m.squares, sq],
          }))
        } else if (sq) {
          setMarks((m) => {
            const exists = m.arrows.some((a) => a.from === drawFrom && a.to === sq)
            return {
              ...m,
              arrows: exists
                ? m.arrows.filter((a) => !(a.from === drawFrom && a.to === sq))
                : [...m.arrows.filter((a) => !(a.from === drawFrom && a.to === sq)), { from: drawFrom, to: sq }],
            }
          })
        }
        setDrawFrom(null)
        return
      }

      if (!drag) return
      const sq = squareFromEvent(e)
      const wasDrag = drag.active
      setDrag(null)
      if (!wasDrag) {
        // simple click: keep selection (click-then-click flow handled on next down)
        return
      }
      if (sq && sq !== drag.from) {
        const allowed = legalTargets ? legalTargets(drag.from).includes(sq) : targets.includes(sq)
        if (allowed) {
          queueMove(drag.from, sq)
          return
        }
        // dropped on illegal square → deselect
        setSelected(null)
      } else if (sq === drag.from) {
        // dropped back: remain selected
        setSelected(drag.from)
      }
    },
    [drawFrom, drag, squareFromEvent, targets, selected, legalTargets, queueMove],
  )

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  /* ---------- keyboard ---------- */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!kbd) return
      const [f, r] = [FILES.indexOf(kbd[0]), Number(kbd[1])]
      let nf = f
      let nr = r
      if (e.key === 'ArrowLeft') nf = Math.max(0, f - 1)
      else if (e.key === 'ArrowRight') nf = Math.min(7, f + 1)
      else if (e.key === 'ArrowUp') nr = Math.min(8, r + 1)
      else if (e.key === 'ArrowDown') nr = Math.max(1, r - 1)
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        if (editing) {
          onEditorPlace?.(kbd)
          return
        }
        if (selected && targets.includes(kbd)) queueMove(selected, kbd)
        else if (isOwn(kbd)) setSelected(kbd)
        else setSelected(null)
        return
      } else if (e.key === 'Escape') {
        setSelected(null)
        return
      } else return
      e.preventDefault()
      setKbd(FILES[nf] + nr)
    },
    [kbd, editing, onEditorPlace, selected, targets, queueMove, isOwn],
  )

  useEffect(() => {
    setKbd((prev) => (keyboard ? prev ?? 'e2' : null))
  }, [keyboard])

  /* ---------- render helpers ---------- */
  const squares = useMemo(() => {
    const out: { sq: string; x: number; y: number; light: boolean }[] = []
    for (let f = 0; f < 8; f++) {
      for (let r = 1; r <= 8; r++) {
        const sq = FILES[f] + r
        const [x, y] = squareToXY(sq, orientation)
        const light = (f + r) % 2 === 1
        out.push({ sq, x, y, light })
      }
    }
    return out
  }, [orientation])

  const coordLabels = useMemo(() => {
    if (!coords) return { files: [] as { text: string; x: number; light: boolean }[], ranks: [] as { text: string; y: number; light: boolean }[] }
    const files: { text: string; x: number; light: boolean }[] = []
    const ranks: { text: string; y: number; light: boolean }[] = []
    for (let x = 0; x < 8; x++) {
      const sq = pointToSquare(x, 7, orientation)!
      files.push({ text: sq[0], x, light: squares.find((s) => s.sq === sq)?.light ?? true })
    }
    for (let y = 0; y < 8; y++) {
      const sq = pointToSquare(0, y, orientation)!
      ranks.push({ text: sq[1], y, light: squares.find((s) => s.sq === sq)?.light ?? true })
    }
    return { files, ranks }
  }, [coords, orientation, squares])

  const staticArrows = useMemo(() => {
    const seen = new Set<string>()
    const merged: Arrow[] = []
    for (const a of [...arrows, ...marks.arrows]) {
      const k = `${a.from}${a.to}`
      if (seen.has(k)) continue
      seen.add(k)
      merged.push(a)
    }
    return merged
  }, [arrows, marks.arrows])

  const highlightStyle = (sq: string): CSSProperties => {
    const [x, y] = squareToXY(sq, orientation)
    return { left: `${x * 12.5}%`, top: `${y * 12.5}%` }
  }

  const pieceStyle = (p: PieceInst): CSSProperties => {
    if (drag && drag.from === p.sq && drag.active) {
      const el = boardRef.current
      const rect = el?.getBoundingClientRect()
      const size = (rect?.width ?? 480) / 8
      const left = drag.x - (rect?.left ?? 0) - size / 2
      const top = drag.y - (rect?.top ?? 0) - size / 2
      return { ['--dx' as string]: `${left}px`, ['--dy' as string]: `${top}px` } as CSSProperties
    }
    const [x, y] = squareToXY(p.sq, orientation)
    return { ['--px' as string]: x, ['--py' as string]: y } as CSSProperties
  }

  /* promotion dialog placement */
  const promoPos = useMemo(() => {
    if (!promo) return null
    const [x, y] = squareToXY(promo.to, orientation)
    const nearTop = y < 4
    return {
      left: `calc(${x * 12.5}% + 6px)`,
      ...(nearTop ? { top: '2px' } : { bottom: '2px' }),
    }
  }, [promo, orientation])

  const colorOf = (sq: string) => pieces.find((p) => p.sq === sq)?.color

  const renderArrow = (a: Arrow, i: number, isHint: boolean) => {
    const [fx, fy] = squareToXY(a.from, orientation)
    const [tx, ty] = squareToXY(a.to, orientation)
    const ax = fx + 0.5
    const ay = fy + 0.5
    const bx = tx + 0.5
    const by = ty + 0.5
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)
    if (len < 0.01) return null
    const ux = dx / len
    const uy = dy / len
    const headLen = 0.32
    const headW = 0.2
    const sx = ax + ux * 0.28
    const sy = ay + uy * 0.28
    const ex = bx - ux * (0.3 + headLen)
    const ey = by - uy * (0.3 + headLen)
    const px = -uy
    const py = ux
    const tipX = bx - ux * 0.3
    const tipY = by - uy * 0.3
    const color = a.color ?? 'var(--arrow)'
    return (
      <g key={`${a.from}${a.to}${i}`} className={isHint ? 'hint' : undefined} opacity={0.85}>
        <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={color} strokeWidth={0.16} className="arrow-line" style={{ stroke: color }} />
        <polygon
          points={`${tipX},${tipY} ${ex + px * headW},${ey + py * headW} ${ex - px * headW},${ey - py * headW}`}
          fill={color}
          style={{ fill: color }}
        />
      </g>
    )
  }

  return (
    <div
      ref={boardRef}
      className={`board ${drag?.active ? '' : 'anim'} ${editing ? 'editing' : ''} ${className}`}
      role="application"
      aria-label={ariaLabel}
      tabIndex={keyboard ? 0 : -1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onBlur={() => setSelected(null)}
      data-orientation={orientation}
    >
      {/* squares */}
      <div className="layer">
        {squares.map((s) => (
          <div key={s.sq} className={`sq ${s.light ? 'light' : 'dark'}`} style={{ left: `${s.x * 12.5}%`, top: `${s.y * 12.5}%` }} />
        ))}
      </div>

      {/* highlights */}
      <div className="layer" style={{ zIndex: 2 }}>
        {lastMove && (
          <>
            <div className="hl last" style={highlightStyle(lastMove.from)} />
            <div className="hl last" style={highlightStyle(lastMove.to)} />
          </>
        )}
        {premove && (
          <>
            <div className="hl premove" style={highlightStyle(premove.from)} />
            <div className="hl premove" style={highlightStyle(premove.to)} />
          </>
        )}
        {selected && <div className="hl selected" style={highlightStyle(selected)} />}
        {checkSquare && <div className="hl check" style={highlightStyle(checkSquare)} />}
        {marks.squares.map((sq) => (
          <div key={`m${sq}`} className="hl mark" style={highlightStyle(sq)} />
        ))}
        {kbd && <div className="kbd-cursor" style={highlightStyle(kbd)} />}
      </div>

      {/* legal move dots */}
      <div className="layer" style={{ zIndex: 2 }}>
        {selected &&
          targets.map((sq) => <div key={`t${sq}`} className={`dot ${colorOf(sq) && colorOf(sq) !== colorOf(selected) ? 'capture' : ''}`} style={highlightStyle(sq)} />)}
        {drag?.active &&
          legalTargets?.(drag.from).map((sq) => (
            <div key={`d${sq}`} className={`dot ${colorOf(sq) && colorOf(sq) !== colorOf(drag.from) ? 'capture' : ''}`} style={highlightStyle(sq)} />
          ))}
      </div>

      {/* pieces */}
      <div className="layer" style={{ zIndex: 3 }}>
        {pieces.map((p) => (
          <div
            key={p.id}
            className={`piece ${drag?.from === p.sq && drag.active ? 'dragging' : ''}`}
            style={pieceStyle(p)}
            data-square={p.sq}
          >
            <img src={pieceUrl(pieceSet, p.color, p.type)} alt="" draggable={false} />
          </div>
        ))}
      </div>

      {/* arrows */}
      <svg className="arrows" viewBox="0 0 8 8" preserveAspectRatio="none">
        {staticArrows.map((a, i) => renderArrow(a, i, arrows.some((h) => h.from === a.from && h.to === a.to && h.color === a.color)))}
      </svg>

      {/* coordinates */}
      {coordLabels.files.map((c) => (
        <div
          key={`f${c.x}`}
          className={`coord file ${c.light ? 'on-light' : 'on-dark'}`}
          style={{ left: `${c.x * 12.5}%`, bottom: '0px', width: '12.5%' }}
        >
          {c.text}
        </div>
      ))}
      {coordLabels.ranks.map((c) => (
        <div
          key={`r${c.y}`}
          className={`coord rank ${c.light ? 'on-light' : 'on-dark'}`}
          style={{ top: `${c.y * 12.5}%`, left: '0px', width: '12.5%' }}
        >
          {c.text}
        </div>
      ))}

      {/* promotion picker */}
      {promo && promoPos && (
        <div className="promo" style={promoPos} onPointerDown={(e) => e.stopPropagation()}>
          {(['q', 'r', 'b', 'n'] as PieceType[]).map((t) => (
            <button
              key={t}
              aria-label={`Promote to ${t}`}
              onClick={() => {
                onMove?.(`${promo.from}${promo.to}${t}`)
                setPromo(null)
                setSelected(null)
              }}
            >
              <img src={pieceUrl(pieceSet, promo.color, t)} alt="" />
            </button>
          ))}
        </div>
      )}

      {overlay && <div className="board-overlay">{overlay}</div>}
    </div>
  )
}

/** util for parents: does the side to move have a king in check? (square lookup) */
export function kingSquare(fen: string, color: PieceColor): string | null {
  const rows = fen.split(' ')[0].split('/')
  const target = color === 'w' ? 'K' : 'k'
  for (let i = 0; i < 8; i++) {
    let file = 0
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '8') file += Number(ch)
      else {
        if (ch === target) return FILES[file] + (8 - i)
        file++
      }
    }
  }
  return null
}
