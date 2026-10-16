import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { Board } from '@/board/Board'
import { pieceUrl, type PieceColor, type PieceType } from '@/board/pieces'
import { useGameSession, capturedPieces } from '@/game/useGameSession'
import { useNavKeys, type NavAction } from '@/game/useNavKeys'
import { PlayerStrip } from '@/components/PlayerStrip'
import { MoveList } from '@/components/MoveList'
import { EvalBar, formatEval } from '@/components/EvalBar'
import { EvalGraph } from '@/components/EvalGraph'
import { Modal } from '@/components/Modal'
import { useToast } from '@/components/Toast'
import { Engine, type PvLine } from '@/engine/engine'
import { useSettings } from '@/lib/settings'
import { START_FEN, type Color, type GameResult } from '@/lib/chess/types'
import { validateFen, parsePgn, buildPgn } from '@/lib/chess/pgn'
import { detectOpening, openings } from '@/assets/openings'
import { getGame, saveGame } from '@/lib/history'
import { reviewGame, type GameReviewResult, type ReviewProgress } from '@/game/review'
import type { ClassLabel } from '@/lib/chess/classify'
import { copyText } from '@/lib/clipboard'
import { pgnResult } from '@/game/resultText'
import { Link, useRoute } from '@/router'

const MISTAKES: ClassLabel[] = ['blunder', 'mistake', 'miss', 'inaccuracy']

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function AnalysisPage({ reviewId }: { reviewId?: string }) {
  const record = useMemo(() => (reviewId ? getGame(reviewId) : null), [reviewId])
  const [startFen, setStartFen] = useState(() => record?.startFen ?? START_FEN)
  const [initialUcis, setInitialUcis] = useState<string[]>(() => record?.moves.map((m) => m.uci) ?? [])
  const [initialAnalysis, setInitialAnalysis] = useState(() => record?.analysis ?? null)
  const [runKey, setRunKey] = useState(0)
  const [editing, setEditing] = useState(!record)

  const goAnalyze = (fen: string, ucis: string[] = []) => {
    setStartFen(fen)
    setInitialUcis(ucis)
    setInitialAnalysis(null)
    setRunKey((k) => k + 1)
    setEditing(false)
  }

  if (editing) {
    return <Editor initialFen={startFen} onAnalyze={(fen, ucis) => goAnalyze(fen, ucis)} loadedGame={!!record} />
  }

  return (
    <AnalyzeView
      key={runKey}
      startFen={startFen}
      initialUcis={initialUcis}
      initialAnalysis={initialAnalysis}
      autoReview={!!record}
      recordId={record?.id ?? null}
      recordLabel={record ? `${record.white.name} vs ${record.black.name}` : null}
      recordResult={record?.result ?? null}
      onOpenEditor={(fen) => {
        setStartFen(fen)
        setInitialUcis([])
        setEditing(true)
      }}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Board editor                                                        */
/* ------------------------------------------------------------------ */

type Tool = { kind: 'place'; color: PieceColor; type: PieceType } | { kind: 'erase' } | { kind: 'none' }

function fenToMap(fen: string): Map<string, { color: PieceColor; type: PieceType }> {
  const map = new Map<string, { color: PieceColor; type: PieceType }>()
  try {
    const rows = new Chess(fen).board()
    for (const row of rows) {
      for (const sq of row) {
        if (sq) map.set(sq.square, { color: sq.color, type: sq.type })
      }
    }
  } catch {
    /* keep empty */
  }
  return map
}

function mapToFen(map: Map<string, { color: PieceColor; type: PieceType }>, turn: Color, castling: string): string {
  const rows: string[] = []
  for (let rank = 8; rank >= 1; rank--) {
    let row = ''
    let empty = 0
    for (let f = 0; f < 8; f++) {
      const sq = 'abcdefgh'[f] + rank
      const p = map.get(sq)
      if (!p) {
        empty++
      } else {
        if (empty) {
          row += empty
          empty = 0
        }
        row += p.color === 'w' ? p.type.toUpperCase() : p.type
      }
    }
    if (empty) row += empty
    rows.push(row)
  }
  return `${rows.join('/')} ${turn} ${castling || '-'} - 0 1`
}

function Editor({ initialFen, onAnalyze, loadedGame }: { initialFen: string; onAnalyze: (fen: string, ucis?: string[]) => void; loadedGame: boolean }) {
  const settings = useSettings()
  const toast = useToast()
  const [pieces, setPieces] = useState(() => fenToMap(initialFen))
  const [turn, setTurn] = useState<Color>(() => (initialFen.split(' ')[1] === 'b' ? 'b' : 'w'))
  const [castling, setCastling] = useState(() => {
    const c = initialFen.split(' ')[2] ?? 'KQkq'
    return { K: c.includes('K'), Q: c.includes('Q'), k: c.includes('k'), q: c.includes('q') }
  })
  const [tool, setTool] = useState<Tool>({ kind: 'place', color: 'w', type: 'q' })
  const [flipped, setFlipped] = useState(false)
  const [fenText, setFenText] = useState(initialFen)
  const [fenError, setFenError] = useState<string | null>(null)
  const [pgnText, setPgnText] = useState('')

  const currentFen = useMemo(() => {
    const c = (castling.K ? 'K' : '') + (castling.Q ? 'Q' : '') + (castling.k ? 'k' : '') + (castling.q ? 'q' : '')
    return mapToFen(pieces, turn, c)
  }, [pieces, turn, castling])

  useEffect(() => setFenText(currentFen), [currentFen])

  const loadFenText = () => {
    const err = validateFen(fenText.trim())
    if (err) {
      setFenError(err)
      return
    }
    const chess = new Chess(fenText.trim())
    setPieces(fenToMap(chess.fen()))
    setTurn(chess.turn())
    const c = chess.fen().split(' ')[2]
    setCastling({ K: c.includes('K'), Q: c.includes('Q'), k: c.includes('k'), q: c.includes('q') })
    setFenError(null)
    toast.show('Position loaded')
  }

  const validateForPlay = (fen: string): string | null => {
    try {
      const c = new Chess(fen)
      const board = c.board().flat().filter(Boolean)
      const wk = board.filter((p) => p!.color === 'w' && p!.type === 'k').length
      const bk = board.filter((p) => p!.color === 'b' && p!.type === 'k').length
      if (wk !== 1 || bk !== 1) return 'Position needs exactly one white king and one black king.'
      const backPawn = board.find((p) => p!.type === 'p' && (p!.square[1] === '1' || p!.square[1] === '8'))
      if (backPawn) return `Pawn on ${backPawn!.square} — pawns cannot stand on the first or eighth rank.`
      // side NOT to move may not be in check
      const them = c.turn() === 'w' ? 'b' : 'w'
      const test = new Chess(fen)
      if (isKingAttacked(test, them)) return 'The side that is not to move cannot be in check.'
      return null
    } catch (e) {
      return (e as Error).message.replace(/^Invalid FEN:\s*/, 'Invalid FEN: ')
    }
  }

  const analyze = () => {
    const err = validateForPlay(currentFen)
    if (err) {
      setFenError(err)
      toast.error(err)
      return
    }
    onAnalyze(currentFen)
  }

  const loadPgn = () => {
    try {
      const game = parsePgn(pgnText.trim())
      if (game.ucis.length === 0 && game.startFen === START_FEN) {
        toast.error('No moves found in that PGN.')
        return
      }
      onAnalyze(game.startFen, game.ucis)
    } catch (e) {
      toast.error(`Could not read PGN: ${(e as Error).message}`)
    }
  }

  const place = (sq: string) => {
    if (tool.kind === 'erase') {
      setPieces((prev) => {
        const next = new Map(prev)
        next.delete(sq)
        return next
      })
      return
    }
    if (tool.kind === 'place') {
      setPieces((prev) => {
        const next = new Map(prev)
        // exactly one king per color
        if (tool.type === 'k') {
          for (const [k, v] of next) if (v.color === tool.color && v.type === 'k') next.delete(k)
        }
        next.set(sq, { color: tool.color, type: tool.type })
        return next
      })
    }
  }

  return (
    <div className="editor-view" style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>Board editor</h2>
        <span className="hint">{loadedGame ? 'Adjust the start position of your game' : 'Set up any position, then analyze it'}</span>
        <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setFlipped((f) => !f)}>
          ⇅ Flip
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            setPieces(fenToMap(START_FEN))
            setTurn('w')
            setCastling({ K: true, Q: true, k: true, q: true })
          }}
        >
          Start position
        </button>
        <button className="btn btn-sm" onClick={() => setPieces(new Map())}>
          Clear board
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)', gap: 12, alignItems: 'start' }}>
        <div>
          <Board
            fen={mapToFen(pieces, turn, '')}
            orientation={flipped ? 'b' : 'w'}
            pieceSet={settings.pieceSet}
            coords={settings.coords}
            editorPiece={tool.kind === 'place' ? { color: tool.color, type: tool.type } : null}
            onEditorPlace={place}
            onEditorErase={(sq) => {
              setPieces((prev) => {
                const next = new Map(prev)
                next.delete(sq)
                return next
              })
            }}
            ariaLabel="Position editor"
          />

          <div className="card" style={{ marginTop: 10, padding: 12 }}>
            <div className="editor-palette">
              {(['w', 'b'] as PieceColor[]).map((color) =>
                (['q', 'r', 'b', 'n', 'p'] as PieceType[]).map((type) => (
                  <button
                    key={`${color}${type}`}
                    className={`ep-piece ${tool.kind === 'place' && tool.color === color && tool.type === type ? 'selected' : ''}`}
                    onClick={() => setTool({ kind: 'place', color, type })}
                    aria-label={`${color === 'w' ? 'White' : 'Black'} ${type}`}
                  >
                    <img src={pieceUrl(settings.pieceSet, color, type)} alt="" />
                  </button>
                )),
              )}
              <button
                className={`ep-piece ${tool.kind === 'erase' ? 'selected' : ''}`}
                onClick={() => setTool({ kind: 'erase' })}
                aria-label="Eraser"
                title="Erase pieces (also right-click)"
                style={{ fontSize: 18 }}
              >
                🧽
              </button>
            </div>

            <div className="divider" />
            <div className="field">
              <label>Side to move</label>
              <div className="seg">
                <button className={turn === 'w' ? 'active' : ''} onClick={() => setTurn('w')}>
                  White
                </button>
                <button className={turn === 'b' ? 'active' : ''} onClick={() => setTurn('b')}>
                  Black
                </button>
              </div>
            </div>
            <div className="field">
              <label>Castling rights</label>
              <div style={{ display: 'flex', gap: 12, fontSize: 14.5 }}>
                {(['K', 'Q', 'k', 'q'] as const).map((c) => (
                  <label key={c} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={castling[c]}
                      onChange={(e) => setCastling((prev) => ({ ...prev, [c]: e.target.checked }))}
                    />
                    <span className="mono">
                      {c === 'K' ? 'White O-O' : c === 'Q' ? 'White O-O-O' : c === 'k' ? 'Black O-O' : 'Black O-O-O'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 8 }}>FEN</h3>
            <textarea
              className="input mono"
              rows={2}
              value={fenText}
              onChange={(e) => {
                setFenText(e.target.value)
                setFenError(null)
              }}
              spellCheck={false}
            />
            {fenError && <p className="error-text">{fenError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-sm" onClick={loadFenText}>
                Load FEN
              </button>
              <button className="btn btn-sm" onClick={() => void copyText(fenText).then((ok) => ok && toast.show('FEN copied'))}>
                Copy
              </button>
              <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={analyze}>
                Analyze position →
              </button>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 8 }}>Import PGN</h3>
            <textarea
              className="input mono"
              rows={5}
              placeholder={'[Event "Casual game"]\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *'}
              value={pgnText}
              onChange={(e) => setPgnText(e.target.value)}
              spellCheck={false}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-sm btn-primary" onClick={loadPgn} disabled={!pgnText.trim()}>
                Load game
              </button>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 6 }}>Tips</h3>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-dim)', fontSize: 13.5, lineHeight: 1.7 }}>
              <li>Pick a piece below the board, then click squares to place it.</li>
              <li>Right-click (or the sponge tool) erases.</li>
              <li>Analysis runs entirely in your browser — nothing is uploaded.</li>
              <li>From the analysis board you can run a full game review with move classifications.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function isKingAttacked(chess: Chess, color: Color): boolean {
  const board = chess.board()
  for (const row of board) {
    for (const sq of row) {
      if (sq && sq.type === 'k' && sq.color === color) {
        return chess.isAttacked(sq.square, color === 'w' ? 'b' : 'w')
      }
    }
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Analysis stage                                                      */
/* ------------------------------------------------------------------ */

function AnalyzeView({
  startFen,
  initialUcis,
  initialAnalysis,
  autoReview,
  recordId,
  recordLabel,
  recordResult,
  onOpenEditor,
}: {
  startFen: string
  initialUcis: string[]
  initialAnalysis: { classes: Record<number, string>; accuracy: { w: number; b: number }; evals: { cp?: number; mate?: number }[] } | null
  autoReview: boolean
  recordId: string | null
  recordLabel: string | null
  recordResult: GameResult | null
  onOpenEditor: (fen: string) => void
}) {
  const settings = useSettings()
  const toast = useToast()
  const { navigate } = useRoute()

  const s = useGameSession({
    mode: 'analysis',
    fen: startFen,
    tc: null,
    initialUcis,
    myColors: ['w', 'b'],
    myColorForSound: null,
    premoves: false,
  })

  const [engine, setEngine] = useState<Engine | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [live, setLive] = useState<{ lines: PvLine[]; best: string | null } | null>(null)
  const [review, setReview] = useState<{ running: boolean; done: number; total: number; phase: 'eval' | 'classify' }>({
    running: false,
    done: 0,
    total: 0,
    phase: 'eval',
  })
  const [result, setResult] = useState<GameReviewResult | null>(() =>
    initialAnalysis
      ? {
          evals: initialAnalysis.evals,
          bestUcis: [],
          classes: s.plies.map((_, i) => (initialAnalysis.classes[i] as ClassLabel | undefined) ?? null),
          accuracy: initialAnalysis.accuracy,
          analyzed: initialAnalysis.evals.length,
        }
      : null,
  )
  const [showPgn, setShowPgn] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [sideTab, setSideTab] = useState<'moves' | 'analysis'>('moves')

  const cancelRef = useRef<{ value: boolean }>({ value: false })
  const liveJob = useRef(0)

  // engine lifecycle
  useEffect(() => {
    let eng: Engine | null = null
    let dead = false
    Engine.create()
      .then((e) => {
        if (dead) {
          e.dispose()
          return
        }
        e.setSkill(20)
        eng = e
        setEngine(e)
      })
      .catch((err: Error) => setEngineError(err.message))
    return () => {
      dead = true
      cancelRef.current.value = true
      eng?.dispose()
    }
  }, [])

  // live multi-PV analysis (debounced), skipped while a review is running
  useEffect(() => {
    if (!engine || review.running) return
    const job = ++liveJob.current
    let cancelled = false
    const t = setTimeout(() => {
      engine
        .analyze(s.displayFen, { movetime: 380, multiPv: 3 })
        .then((res) => {
          if (cancelled || job !== liveJob.current) return
          const stmWhite = s.displayFen.split(' ')[1] === 'w'
          const sign = stmWhite ? 1 : -1
          setLive({
            lines: res.lines.map((l) => ({
              ...l,
              score: l.score.mate !== undefined ? { mate: l.score.mate * sign } : { cp: (l.score.cp ?? 0) * sign },
            })),
            best: res.bestmove,
          })
        })
        .catch(() => {})
    }, 320)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [engine, s.displayFen, review.running])

  const startReview = useCallback(
    async (ucis: string[]) => {
      if (!engine || review.running) return
      cancelRef.current = { value: false }
      setLive(null)
      setReview({ running: true, done: 0, total: ucis.length + 1, phase: 'eval' })
      const res = await reviewGame(engine, startFen, ucis, (p: ReviewProgress) => setReview({ running: true, ...p }), {
        cancelled: cancelRef.current,
      })
      setResult(res)
      setReview({ running: false, done: 0, total: 0, phase: 'eval' })
      // persist analysis on the record so revisits skip the wait
      if (recordId) {
        const rec = getGame(recordId)
        if (rec) {
          const classes: Record<number, string> = {}
          res.classes.forEach((c, i) => {
            if (c) classes[i] = c
          })
          saveGame({ ...rec, analysis: { classes, accuracy: res.accuracy, evals: res.evals } })
        }
      }
      toast.show('Review complete')
    },
    [engine, review.running, startFen, recordId, toast],
  )

  // auto-run review for loaded games
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoReview || !engine || autoStarted.current) return
    autoStarted.current = true
    void startReview(initialUcis)
  }, [autoReview, engine, startReview, initialUcis])

  const onSeek = useCallback(
    (action: NavAction) => {
      s.seek(action === 'first' ? 0 : action === 'last' ? s.plies.length : action === 'prev' ? s.displayPly - 1 : s.displayPly + 1)
    },
    [s],
  )
  useNavKeys(onSeek)

  const sans = useMemo(() => s.sans, [s.sans])
  const opening = useMemo(() => detectOpening(sans), [sans])

  const jumpMistake = (dir: 1 | -1) => {
    if (!result) return
    const cur = s.displayPly - 1
    for (let i = cur + dir; i >= 0 && i < result.classes.length; i += dir) {
      const c = result.classes[i]
      if (c && MISTAKES.includes(c)) {
        s.seek(i + 1)
        return
      }
    }
    toast.show(dir === 1 ? 'No more mistakes ahead' : 'No more mistakes behind', 'info')
  }

  // book continuation + alternatives (opening explorer)
  const book = useMemo(() => {
    if (!opening) return null
    return {
      name: opening.name,
      eco: opening.eco,
      rest: opening.sans.slice(sans.length),
    }
  }, [opening, sans.length])

  const alternatives = useMemo(() => {
    const len = sans.length
    const same = openings.filter((o) => o.sans.length > len && o.sans.slice(0, len).every((x, i) => x === sans[i]))
    if (len === 0) {
      // group by first move
      const counts = new Map<string, number>()
      for (const o of same) counts.set(o.sans[0], (counts.get(o.sans[0]) ?? 0) + 1)
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([san, n]) => ({ san, label: san, count: n }))
    }
    return same
      .filter((o) => o.sans[len] !== sans[len])
      .slice(0, 8)
      .map((o) => ({ san: o.sans[len], label: `${o.name}`, eco: o.eco }))
  }, [sans])

  const playSan = (san: string) => {
    try {
      const m = new Chess(s.displayFen).move(san)
      s.tryUserMove(m.from + m.to + (m.promotion ?? ''))
    } catch {
      toast.error(`Illegal move here: ${san}`)
    }
  }

  const classMap = useMemo(() => {
    if (!result) return undefined
    const out: Record<number, ClassLabel> = {}
    result.classes.forEach((c, i) => {
      if (c) out[i] = c
    })
    return out
  }, [result])

  const pgn = useMemo(
    () =>
      buildPgn(startFen, s.plies, {
        white: recordLabel?.split(' vs ')[0] ?? 'White',
        black: recordLabel?.split(' vs ')[1] ?? 'Black',
        result: recordResult ? pgnResult(recordResult) : '*',
        event: 'Analysis',
      }),
    [startFen, s.plies, recordLabel, recordResult],
  )

  const caps = useMemo(() => capturedPieces(s.core.startFen, s.displayFen), [s.core.startFen, s.displayFen])
  const bottomColor: PieceColor = flipped ? 'b' : 'w'

  // eval bar score: review evals when available, else live engine line
  const barScore = result
    ? result.evals[s.displayPly] ?? null
    : live?.lines[0]?.score ?? null

  const bestArrow = live?.best && !review.running ? [{ from: live.best.slice(0, 2), to: live.best.slice(2, 4), color: 'rgba(92, 156, 214, 0.75)' }] : []

  const mistakeCount = result
    ? result.classes.filter((c) => c === 'blunder' || c === 'mistake' || c === 'miss').length
    : 0

  return (
    <div className="game-layout">
      <div className="game-main">
        <PlayerStrip
          top
          name={recordLabel ? recordLabel.split(' vs ')[1] ?? 'Black' : 'Black'}
          pieceSet={settings.pieceSet}
          captured={caps.byBlack}
          active={false}
        />
        <div className="board-slot">
          <EvalBar score={barScore} orientation={bottomColor} />
          <Board
            fen={s.displayFen}
            orientation={bottomColor}
            movable={s.movable}
            onMove={(uci) => s.tryUserMove(uci)}
            legalTargets={s.legalTargets}
            lastMove={s.displayLastMove}
            checkSquare={s.checkSquare}
            pieceSet={settings.pieceSet}
            coords={settings.coords}
            autoQueen={settings.autoQueen}
            arrows={bestArrow}
            interactiveMarks
            ariaLabel="Analysis board"
          />
        </div>
        <PlayerStrip
          name={recordLabel ? recordLabel.split(' vs ')[0] ?? 'White' : 'White'}
          pieceSet={settings.pieceSet}
          captured={caps.byWhite}
          active={false}
        />
      </div>

      <div className="game-side" data-tab={sideTab}>
        {result && (
          <div className="result-banner">
            <div className="rb-title">Game review{recordLabel ? ` — ${recordLabel}` : ''}</div>
            <div className="accuracy-row">
              <span>
                ⬜ White accuracy <b>{result.accuracy.w}%</b>
              </span>
              <span>
                ⬛ Black accuracy <b>{result.accuracy.b}%</b>
              </span>
              {mistakeCount > 0 && (
                <span style={{ color: 'var(--danger-2)' }}>
                  {mistakeCount} mistake{mistakeCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => jumpMistake(-1)}>
                ◀ Mistake
              </button>
              <button className="btn btn-sm" onClick={() => jumpMistake(1)}>
                Mistake ▶
              </button>
            </div>
          </div>
        )}

        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>Analysis</b>
            <span>{recordLabel ?? 'free exploration'}</span>
          </div>

          <MoveList
            sans={sans}
            classes={classMap}
            currentPly={s.displayPly}
            onSeek={(p) => s.seek(p)}
          />

          <div className="game-controls">
            <button className="btn btn-sm" onClick={() => setFlipped((f) => !f)} title="Flip board">
              ⇅ Flip
            </button>
            <button className="btn btn-sm" onClick={() => s.takeback(2)} disabled={s.plies.length === 0 || review.running}>
              ↩ Takeback
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => void startReview(s.plies.map((p) => p.uci))}
              disabled={!engine || review.running}
            >
              {result ? 'Re-review' : '⚡ Full review'}
            </button>
            <button className="btn btn-sm" onClick={() => setShowPgn(true)}>
              PGN
            </button>
            <button className="btn btn-sm" onClick={() => onOpenEditor(s.displayFen)}>
              🧽 Editor
            </button>
          </div>

          {engineError && (
            <p className="error-text" style={{ textAlign: 'center', margin: 0 }}>
              Engine failed to load: {engineError}. Moves and browsing still work.
            </p>
          )}

          {recordId && (
            <Link to="/" className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }}>
              ← Back home
            </Link>
          )}
          {!recordId && (
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => navigate('/')}>
              ← Back home
            </button>
          )}
        </div>

        <div className="pane" data-pane="analysis">
          {review.running && (
            <div className="card" style={{ padding: 12 }}>
              <div className="progress">
                <div style={{ width: `${Math.round((review.done / Math.max(1, review.total)) * 100)}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span className="hint">
                  {review.phase === 'eval' ? 'Engine evaluation' : 'Classifying moves'} — {review.done}/{review.total}
                </span>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    cancelRef.current.value = true
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {result && <EvalGraph evals={result.evals} currentPly={s.displayPly} onSeek={(p) => s.seek(p)} />}

          {opening && (
            <div className="card" style={{ padding: 12 }}>
              <div className="opening-chip" style={{ marginBottom: 6 }}>
                <span className="eco">{opening.eco}</span>
                <b style={{ color: 'var(--text)' }}>{opening.name}</b>
              </div>
              {book && book.rest.length > 0 && (
                <div>
                  <div className="hint" style={{ marginBottom: 4 }}>
                    Book line:
                  </div>
                  <div className="book-line">
                    {book.rest.slice(0, 12).map((san, i) => (
                      <button key={i} className="book-move" onClick={() => playSan(san)}>
                        {san}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {alternatives.length > 0 && (
            <div className="card" style={{ padding: 12 }}>
              <div className="hint" style={{ marginBottom: 6 }}>
                Opening explorer — other continuations from here:
              </div>
              <div className="book-line">
                {alternatives.map((a, i) => (
                  <button key={i} className="book-move" onClick={() => playSan(a.san)} title={'count' in a ? `${a.count} ECO lines` : undefined}>
                    {a.san}
                    {'count' in a ? ` (${a.count})` : ''}
                    {'eco' in a && a.eco ? ` · ${a.eco}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {live && live.lines.length > 0 && (
            <div className="card" style={{ padding: 10 }}>
              <div className="hint" style={{ marginBottom: 6 }}>
                Engine lines {review.running ? '(paused)' : ''}
              </div>
              <div className="pv-lines">
                {live.lines.map((l) => (
                  <button
                    key={l.multipv}
                    className="pv-line"
                    onClick={() => l.pv[0] && s.tryUserMove(l.pv[0])}
                    title="Play this move"
                  >
                    <span className="pv-score">{formatEval(l.score)}</span>
                    <span className="pv-depth">d{l.depth}</span>
                    <span className="pv-moves">{pvToSan(s.displayFen, l.pv, 6)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 12 }}>
            <div className="hint">
              Arrow keys browse moves. Click an engine line to play it. Right-drag draws arrows, right-click marks squares. Make
              moves freely to explore variations.
            </div>
          </div>
        </div>

        <nav className="side-tabs" aria-label="Analysis panel">
          <button className={sideTab === 'moves' ? 'active' : ''} onClick={() => setSideTab('moves')}>
            Moves
          </button>
          <button className={sideTab === 'analysis' ? 'active' : ''} onClick={() => setSideTab('analysis')}>
            Analysis
          </button>
        </nav>
      </div>

      {showPgn && (
        <Modal
          title="PGN of current line"
          onClose={() => setShowPgn(false)}
          actions={
            <>
              <button className="btn" onClick={() => setShowPgn(false)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void copyText(pgn).then((ok) => (ok ? toast.show('PGN copied') : toast.error('Copy failed')))}
              >
                Copy
              </button>
            </>
          }
        >
          <textarea className="input mono" rows={8} readOnly value={pgn} onFocus={(e) => e.currentTarget.select()} />
        </Modal>
      )}
    </div>
  )
}

function pvToSan(fen: string, pv: string[], max: number): string {
  const c = new Chess(fen)
  const out: string[] = []
  for (const uci of pv.slice(0, max)) {
    try {
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined })
      out.push(m.san)
    } catch {
      break
    }
  }
  return out.join(' ')
}
