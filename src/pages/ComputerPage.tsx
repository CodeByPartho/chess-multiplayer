import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from '@/board/Board'
import { useGameSession, capturedPieces } from '@/game/useGameSession'
import { useNavKeys, type NavAction } from '@/game/useNavKeys'
import { PlayerStrip } from '@/components/PlayerStrip'
import { GameClock } from '@/components/Clock'
import { MoveList } from '@/components/MoveList'
import { EvalBar, formatEval } from '@/components/EvalBar'
import { Confirm } from '@/components/Modal'
import { Engine, type Score, type Analysis } from '@/engine/engine'
import { COMPUTER_LEVELS, thinkTimeFor, botPolicyFor } from '@/game/computerLevels'
import { useSettings } from '@/lib/settings'
import { loadIdentity } from '@/lib/identity'
import { saveGame } from '@/lib/history'
import { resultTitle } from '@/game/resultText'
import { Link } from '@/router'
import type { Color, TimeControl, Ply } from '@/lib/chess/types'

const TC_PRESETS: { label: string; tc: TimeControl | null }[] = [
  { label: 'Untimed', tc: null },
  { label: '1 + 0', tc: { base: 60_000, inc: 0, type: 'bullet', label: '1+0' } },
  { label: '3 + 2', tc: { base: 180_000, inc: 2_000, type: 'blitz', label: '3+2' } },
  { label: '5 + 3', tc: { base: 300_000, inc: 3_000, type: 'blitz', label: '5+3' } },
  { label: '10 + 0', tc: { base: 600_000, inc: 0, type: 'rapid', label: '10+0' } },
]

/** comparable value for a search line (side-to-move perspective, higher = better) */
function lineValue(l: { score: Score }): number {
  const s = l.score
  if (s.mate !== undefined) return s.mate > 0 ? 5000 - s.mate : -5000 - s.mate
  return s.cp ?? 0
}

/**
 * Controlled blunder injection for the weak ladder band: mostly the best
 * line, sometimes another reasonable one, and at the level's rate the worst
 * line the shallow search returned — a real, playable mistake rather than
 * random nonsense. Strong levels always play the engine's first choice.
 */
function pickEngineMove(res: Analysis, blunderPct: number): string {
  const candidates = res.lines.filter((l) => l.pv.length > 0)
  if (blunderPct <= 0 || candidates.length < 2) return res.bestmove ?? ''
  const roll = Math.random() * 100
  if (roll < blunderPct) {
    const worst = candidates.reduce((a, b) => (lineValue(a) <= lineValue(b) ? a : b))
    return worst.pv[0]
  }
  if (roll < blunderPct + 18) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    return pick.pv[0]
  }
  return res.bestmove ?? ''
}

export default function ComputerPage() {
  const [setup, setSetup] = useState<{
    level: number
    userColor: Color
    tc: TimeControl | null
  } | null>(null)
  const [round, setRound] = useState(0)

  if (!setup) return <ComputerSetup onStart={(s) => setSetup(s)} />

  return (
    <ComputerGame
      key={`${round}-${setup.level}-${setup.userColor}-${setup.tc?.label ?? 'u'}`}
      setup={setup}
      onBack={() => setSetup(null)}
      onRematch={() => setRound((r) => r + 1)}
    />
  )
}

function ComputerSetup({ onStart }: { onStart: (s: { level: number; userColor: Color; tc: TimeControl | null }) => void }) {
  const [level, setLevel] = useState(8)
  const [userColor, setUserColor] = useState<Color | 'random'>('random')
  const [tc, setTc] = useState<TimeControl | null>({ base: 300_000, inc: 3_000, type: 'blitz', label: '5+3' })
  const lvl = COMPUTER_LEVELS[level - 1]

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <h2>Play vs computer</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 14.5, marginTop: -4 }}>
          Twenty personalities on a ladder from ~200 up to full-strength Stockfish. Hints and
          takebacks allowed — these games don&apos;t affect your rating.
        </p>

        <div className="field">
          <label>Opponent — level {level}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <b style={{ fontSize: 17 }}>{lvl.name}</b>
            <span className="chip">~{lvl.elo} Elo</span>
          </div>
          <p className="hint" style={{ margin: '0 0 8px' }}>{lvl.blurb}</p>
          <input
            type="range"
            min={1}
            max={20}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            style={{ width: '100%' }}
            aria-label="Computer level"
          />
          <div className="hint" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>1 · weakest</span>
            <span>20 · strongest</span>
          </div>
        </div>

        <div className="field">
          <label>Your color</label>
          <div className="seg">
            <button className={userColor === 'w' ? 'active' : ''} onClick={() => setUserColor('w')}>
              ⬜ White
            </button>
            <button className={userColor === 'random' ? 'active' : ''} onClick={() => setUserColor('random')}>
              🎲 Random
            </button>
            <button className={userColor === 'b' ? 'active' : ''} onClick={() => setUserColor('b')}>
              ⬛ Black
            </button>
          </div>
        </div>

        <div className="field">
          <label>Time control</label>
          <div className="tc-row">
            {TC_PRESETS.map((o) => (
              <button
                key={o.label}
                className={`tc-btn ${(o.tc?.label ?? '') === (tc?.label ?? '') ? 'selected' : ''}`}
                style={{ minWidth: 74, padding: '8px 12px' }}
                onClick={() => setTc(o.tc)}
              >
                <span className="tc-time" style={{ fontSize: 15 }}>{o.label}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          className="btn btn-primary btn-lg btn-block"
          onClick={() => onStart({ level, userColor: userColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : userColor, tc })}
        >
          Start game vs {lvl.name}
        </button>
      </div>
    </div>
  )
}

function ComputerGame({
  setup,
  onBack,
  onRematch,
}: {
  setup: { level: number; userColor: Color; tc: TimeControl | null }
  onBack: () => void
  onRematch: () => void
}) {
  const settings = useSettings()
  const identity = useMemo(() => loadIdentity(), [])
  const lvl = COMPUTER_LEVELS[setup.level - 1]
  const policy = useMemo(() => botPolicyFor(setup.level), [setup.level])
  const engineColor: Color = setup.userColor === 'w' ? 'b' : 'w'

  const s = useGameSession({
    mode: 'computer',
    tc: setup.tc,
    myColors: [setup.userColor],
    myColorForSound: setup.userColor,
    premoves: settings.premoves,
  })

  const [engine, setEngine] = useState<Engine | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [evalScore, setEvalScore] = useState<Score | null>(null)
  const [hint, setHint] = useState<{ from: string; to: string } | null>(null)
  const [confirmResign, setConfirmResign] = useState(false)
  const savedRef = useRef(false)
  const evalJobRef = useRef(0)

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
        eng = e
        e.setSkill(setup.level, lvl.elo)
        setEngine(e)
      })
      .catch((err: Error) => setEngineError(err.message))
    return () => {
      dead = true
      eng?.dispose()
    }
  }, [setup.level])

  const over = s.over
  const turn = s.turn
  const fen = s.core.fen

  // engine move (weak levels: shallow depth + controlled blunder injection)
  useEffect(() => {
    if (!engine || over || turn !== engineColor) return
    let cancelled = false
    setThinking(true)
    engine
      .analyze(fen, {
        movetime: thinkTimeFor(setup.level),
        depth: policy.depth,
        multiPv: policy.weak ? 4 : 1,
      })
      .then((res) => {
        if (cancelled) return
        setThinking(false)
        if (!res.bestmove || s.over) return
        s.applyExternalMove(pickEngineMove(res, policy.blunderPct))
      })
      .catch(() => setThinking(false))
    return () => {
      cancelled = true
    }
  }, [engine, fen, over, turn, engineColor, setup.level, policy]) // eslint-disable-line react-hooks/exhaustive-deps

  // background eval for the bar (after each move, when idle)
  useEffect(() => {
    if (!engine || over) return
    const job = ++evalJobRef.current
    let cancelled = false
    const t = setTimeout(() => {
      engine
        .analyze(fen, { movetime: 320, multiPv: 1 })
        .then((res) => {
          if (cancelled || job !== evalJobRef.current) return
          const line = res.lines[0]
          if (!line) return
          const stmWhite = fen.split(' ')[1] === 'w'
          const sc = line.score
          setEvalScore(
            sc.mate !== undefined
              ? { mate: stmWhite ? sc.mate : -sc.mate }
              : { cp: (sc.cp ?? 0) * (stmWhite ? 1 : -1) },
          )
        })
        .catch(() => {})
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [engine, fen, over])

  // clear hint on new position
  useEffect(() => setHint(null), [fen])

  // save the finished game once
  useEffect(() => {
    if (!s.result || savedRef.current) return
    savedRef.current = true
    saveGame({
      id: `cmp-${Date.now()}`,
      mode: 'computer',
      tc: setup.tc,
      rated: false,
      startFen: s.core.startFen,
      moves: s.plies.map((p: Ply) => ({ uci: p.uci, san: p.san })),
      result: s.result,
      white: { name: setup.userColor === 'w' ? identity.username : lvl.name, rating: setup.userColor === 'w' ? identity.ratings.rapid.rating : lvl.elo, avatarSeed: setup.userColor === 'w' ? identity.avatarSeed : lvl.name, flag: setup.userColor === 'w' ? identity.flag : null },
      black: { name: setup.userColor === 'b' ? identity.username : lvl.name, rating: setup.userColor === 'b' ? identity.ratings.rapid.rating : lvl.elo, avatarSeed: setup.userColor === 'b' ? identity.avatarSeed : lvl.name, flag: setup.userColor === 'b' ? identity.flag : null },
      myColor: setup.userColor,
      date: Date.now(),
    })
  }, [s.result]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSeek = useCallback(
    (action: NavAction) => {
      s.seek(action === 'first' ? 0 : action === 'last' ? s.plies.length : action === 'prev' ? s.displayPly - 1 : s.displayPly + 1)
    },
    [s],
  )
  useNavKeys(onSeek)

  const requestHint = () => {
    if (!engine || over || turn !== setup.userColor) return
    engine
      .analyze(fen, { movetime: 450 })
      .then((res) => {
        if (res.bestmove) setHint({ from: res.bestmove.slice(0, 2), to: res.bestmove.slice(2, 4) })
      })
      .catch(() => {})
  }

  const doTakeback = () => {
    if (s.plies.length === 0) return
    if (thinking) {
      engine?.stop()
    }
    if (turn === setup.userColor) s.takeback(2)
    else s.takeback(1)
  }

  const caps = useMemo(() => capturedPieces(s.core.startFen, s.displayFen), [s.core.startFen, s.displayFen])
  const bottomColor = setup.userColor
  const topColor = engineColor

  const stripFor = (color: 'w' | 'b', top: boolean) => {
    const isEngine = color === engineColor
    return (
      <PlayerStrip
        top={top}
        name={isEngine ? lvl.name : identity.username}
        rating={isEngine ? lvl.elo : identity.ratings.rapid.rating}
        avatarSeed={isEngine ? lvl.name : identity.avatarSeed}
        flag={isEngine ? null : identity.flag}
        pieceSet={settings.pieceSet}
        captured={color === 'w' ? caps.byWhite : caps.byBlack}
        active={!over && turn === color}
        thinking={isEngine && thinking}
        subtitle={isEngine ? `Level ${lvl.level} · ~${lvl.elo}` : undefined}
        clock={
          setup.tc ? (
            <GameClock getMs={() => s.core.remaining(color, Date.now()) ?? 0} running={!over && turn === color} lowMs={Math.min(15_000, Math.floor((setup.tc.base ?? 60000) / 6))} />
          ) : (
            <GameClock untimed getMs={() => 0} running={false} />
          )
        }
      />
    )
  }

  const arrows = hint ? [{ from: hint.from, to: hint.to, color: 'rgba(92, 156, 214, 0.85)' }] : []

  return (
    <div className="game-layout">
      <div className="game-main">
        {stripFor(topColor, true)}
        <div className="board-slot">
          {settings.showEval && <EvalBar score={evalScore} orientation={bottomColor} />}
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
            premove={s.premove}
            arrows={arrows}
            ariaLabel={`Chess board vs ${lvl.name}`}
            overlay={thinking && s.isLive ? <div className="spinner" /> : undefined}
          />
        </div>
        {stripFor(bottomColor, false)}
      </div>

      <div className="game-side" data-tab="moves">
        {s.result && (
          <div className="result-banner">
            <div className="rb-title">{resultTitle(s.result, identity.username, lvl.name)}</div>
            <div className="rb-sub">
              {s.result.winner === null ? '½ – ½' : s.result.winner === setup.userColor ? 'You won! 🎉' : 'Better luck next time.'}
            </div>
            {evalScore && (
              <div className="rb-sub mono">Final eval: {formatEval(evalScore)}</div>
            )}
          </div>
        )}

        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>vs {lvl.name}</b>
            <span>
              level {lvl.level} · {setup.tc?.label ?? 'untimed'}
            </span>
          </div>

          <MoveList sans={s.sans} currentPly={s.displayPly} onSeek={(p) => s.seek(p)} />

          <div className="game-controls">
            {!over ? (
              <>
                <button className="btn btn-sm" onClick={requestHint} disabled={!engine || turn !== setup.userColor}>
                  💡 Hint
                </button>
                <button className="btn btn-sm" onClick={doTakeback} disabled={s.plies.length === 0}>
                  ↩ Takeback
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => setConfirmResign(true)}>
                  Resign
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-sm btn-primary" onClick={onRematch}>
                  Rematch
                </button>
                <Link to="/analysis" className="btn btn-sm">
                  Analysis
                </Link>
              </>
            )}
            <button className="btn btn-sm btn-ghost" onClick={onBack}>
              New opponent
            </button>
          </div>

          {engineError && (
            <p className="error-text" style={{ textAlign: 'center', margin: 0 }}>
              Engine failed to load: {engineError}. You can still play — hints and the opponent need it.
            </p>
          )}

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 13.5, color: 'var(--text-dim)' }}>
              vs <b>{lvl.name}</b> ({lvl.blurb}) — premoves are {settings.premoves ? 'on' : 'off'}. Right-drag to draw arrows,
              right-click a square to mark it.
            </div>
          </div>
        </div>
      </div>

      {confirmResign && (
        <Confirm
          title="Resign"
          message={`Resign against ${lvl.name}? You'll lose this game.`}
          confirmLabel="Resign"
          danger
          onCancel={() => setConfirmResign(false)}
          onConfirm={() => {
            setConfirmResign(false)
            s.resign(setup.userColor)
          }}
        />
      )}
      {!over && !thinking && turn === setup.userColor && s.plies.length === 0 && (
        <span className="sr-only" role="status">
          Game started. Your move.
        </span>
      )}
    </div>
  )
}
