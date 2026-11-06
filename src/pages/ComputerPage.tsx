import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconBulb, IconDice } from '@/components/icons'
import { Board } from '@/board/Board'
import { useGameSession, capturedPieces } from '@/game/useGameSession'
import { useNavKeys, type NavAction } from '@/game/useNavKeys'
import { PlayerStrip } from '@/components/PlayerStrip'
import { GameClock } from '@/components/Clock'
import { MoveList } from '@/components/MoveList'
import { EvalBar, formatEval } from '@/components/EvalBar'
import { Confirm } from '@/components/Modal'
import { Engine, type Score, type Analysis } from '@/engine/engine'
import { COMPUTER_LEVELS, thinkTimeFor, botPolicyFor, botAcceptsDraw } from '@/game/computerLevels'
import { CHAMPIONS, bookMoveFor, pickChampionMove } from '@/game/champions'
import { useSettings } from '@/lib/settings'
import { loadIdentity } from '@/lib/identity'
import { saveGame } from '@/lib/history'
import { resultTitle } from '@/game/resultText'
import { SoloChat } from '@/components/SoloChat'
import { useToast } from '@/components/Toast'
import { loadSoloAutopilot } from '@/net/autopilot'
import { appendKeySequence, engineMoveTime } from '@/net/autopilotPolicy'
import { onlineEnabled, ensureAuth } from '@/net/supabase'
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

export interface ComputerSetupState {
  level: number
  championId: string | null
  userColor: Color
  tc: TimeControl | null
}

export default function ComputerPage() {
  const [setup, setSetup] = useState<ComputerSetupState | null>(null)
  const [round, setRound] = useState(0)

  if (!setup) return <ComputerSetup onStart={(s) => setSetup(s)} />

  return (
    <ComputerGame
      key={`${round}-${setup.level}-${setup.championId ?? 'lvl'}-${setup.userColor}-${setup.tc?.label ?? 'u'}`}
      setup={setup}
      onBack={() => setSetup(null)}
      onRematch={() => setRound((r) => r + 1)}
    />
  )
}

function ComputerSetup({ onStart }: { onStart: (s: ComputerSetupState) => void }) {
  const [level, setLevel] = useState(8)
  const [championId, setChampionId] = useState<string | null>(null)
  const [userColor, setUserColor] = useState<Color | 'random'>('random')
  const [tc, setTc] = useState<TimeControl | null>({ base: 300_000, inc: 3_000, type: 'blitz', label: '5+3' })
  const lvl = COMPUTER_LEVELS[level - 1]
  const champ = CHAMPIONS.find((c) => c.id === championId) ?? null

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <h2>Play vs computer</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 14.5, marginTop: -4 }}>
          Twenty personalities on a ladder from ~200 up to full-strength Stockfish, or a champion
          who plays with his own style and opening book. Hints and takebacks allowed in ladder
          games — these games don&apos;t affect your rating.
        </p>

        <div className="field">
          <label>Face a champion</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
            {CHAMPIONS.map((c) => (
              <button
                key={c.id}
                onClick={() => setChampionId(championId === c.id ? null : c.id)}
                aria-pressed={championId === c.id}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${championId === c.id ? 'var(--accent)' : 'var(--border)'}`,
                  background: 'var(--bg-soft, transparent)',
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <b>{c.name}</b>
                  <span className="chip">~{c.elo}</span>
                </span>
                <span className="hint" style={{ display: 'block', marginTop: 2 }}>{c.title}</span>
                <span style={{ display: 'block', fontSize: 13, marginTop: 6, color: 'var(--text-dim)' }}>{c.style}</span>
              </button>
            ))}
          </div>
          <p className="hint" style={{ margin: '8px 0 0' }}>
            {champ
              ? `${champ.name} plays at full strength, chooses moves the way he played, and follows his real opening lines. Tap him again to go back to the ladder.`
              : 'Full-strength engine, bent to a real champion\u2019s taste, with his opening book.'}{' '}
            <Link to="/masters">See their signature lines</Link>
          </p>
        </div>

        <div className="field" style={champ ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
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
              <span className="side-chip w" /> White
            </button>
            <button className={userColor === 'random' ? 'active' : ''} onClick={() => setUserColor('random')}>
              <IconDice size={14} /> Random
            </button>
            <button className={userColor === 'b' ? 'active' : ''} onClick={() => setUserColor('b')}>
              <span className="side-chip b" /> Black
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
          onClick={() =>
            onStart({
              level: champ ? 20 : level,
              championId,
              userColor: userColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : userColor,
              tc,
            })
          }
        >
          Start game vs {champ ? champ.name : lvl.name}
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
  setup: ComputerSetupState
  onBack: () => void
  onRematch: () => void
}) {
  const settings = useSettings()
  const identity = useMemo(() => loadIdentity(), [])
  const lvl = COMPUTER_LEVELS[setup.level - 1]
  const champ = useMemo(() => CHAMPIONS.find((c) => c.id === setup.championId) ?? null, [setup.championId])
  const oppName = champ?.name ?? lvl.name
  const oppElo = champ?.elo ?? lvl.elo
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
  const [flipped, setFlipped] = useState(false)

  // 'f' flips the board (ignored while typing in a form field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      setFlipped((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const savedRef = useRef(false)
  const evalJobRef = useRef(0)
  const engineJobRef = useRef(0)

  /* ---------------- solo chat + autopilot (hidden) ----------------
   * The chat panel is not part of the normal solo UI: it appears only
   * after a short key sequence is typed on the page, or after the
   * opponent's profile strip is tapped 11 times in a row (the phone
   * route — there are no key events without a keyboard). The panel
   * itself is an ordinary-looking chat: regular messages just appear
   * in the log. A digits-only message is checked by the server (0023);
   * on a match a dedicated full-strength engine plays the user's moves
   * through the same apply path the computer's own replies use. */
  const toast = useToast()
  const [chatOpen, setChatOpen] = useState(false)
  const [soloOn, setSoloOn] = useState(false)
  const [soloEngine, setSoloEngine] = useState<Engine | null>(null)
  const seqRef = useRef('')
  const tapRef = useRef({ count: 0, last: 0 })

  const toggleSoloChat = useCallback(() => {
    if (onlineEnabled) {
      // the solo check needs an account; guests get an anonymous one
      void ensureAuth().catch(() => {})
    }
    setChatOpen((v) => !v)
  }, [])

  /** 11 quick taps on the opponent's profile strip toggle the chat */
  const onOpponentTap = useCallback(() => {
    const now = Date.now()
    const t = tapRef.current
    t.count = now - t.last <= 1_500 ? t.count + 1 : 1
    t.last = now
    if (t.count >= 11) {
      t.count = 0
      toggleSoloChat()
    }
  }, [toggleSoloChat])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const r = appendKeySequence(seqRef.current, e.key)
      seqRef.current = r.buffer
      if (r.matched) {
        seqRef.current = ''
        toggleSoloChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSoloChat])

  useEffect(() => {
    let dead = false
    void loadSoloAutopilot().then(
      (on) => {
        if (!dead && on) setSoloOn(true)
      },
      () => {},
    )
    return () => {
      dead = true
    }
  }, [])

  useEffect(() => {
    if (!soloOn) return
    let dead = false
    let eng: Engine | null = null
    void Engine.create().then(
      (e) => {
        if (dead) {
          e.dispose()
          return
        }
        e.setSkill(20) // full strength — no Elo cap
        eng = e
        setSoloEngine(e)
      },
      () => {},
    )
    return () => {
      dead = true
      eng?.dispose()
      setSoloEngine(null)
    }
  }, [soloOn])

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

  // solo autopilot: while engaged, the dedicated engine plays the user's
  // moves. Keyed on the position/turn like the online one; applies through
  // the same path as the computer's own replies.
  const soloKey = `${s.plies.length}:${turn}:${over ? 1 : 0}:${s.isLive ? 1 : 0}`
  useEffect(() => {
    if (!soloEngine || over || turn !== setup.userColor || !s.isLive) return
    const remaining = setup.tc ? (s.core.remaining(setup.userColor, Date.now()) ?? setup.tc.base) : 60_000
    let cancelled = false
    soloEngine
      .analyze(fen, { movetime: engineMoveTime(remaining) })
      .then((res) => {
        if (cancelled || !res.bestmove || s.over) return
        s.applyExternalMove(res.bestmove)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      soloEngine.stop()
    }
  }, [soloKey, soloEngine]) // eslint-disable-line react-hooks/exhaustive-deps

  // engine move — fire-and-forget (weak levels: shallow depth + controlled
  // blunder injection). The search starts the moment the human's move lands
  // and the reply is applied like any other move; nothing blocks the board.
  // A generation token drops results for positions that no longer stand.
  useEffect(() => {
    if (over || turn !== engineColor) {
      setThinking(false) // idle path — also clears a search killed by takeback/resign
      return
    }
    // champion book: while the game follows one of his signature lines he
    // answers from the book, no engine search needed
    if (champ) {
      const book = bookMoveFor(champ, s.plies.map((p) => p.san))
      if (book) {
        const job = ++engineJobRef.current
        setThinking(true)
        const t = window.setTimeout(() => {
          if (job !== engineJobRef.current || s.over) return
          setThinking(false)
          s.applyExternalMove(book)
        }, 450)
        return () => {
          window.clearTimeout(t)
          engineJobRef.current++
        }
      }
    }
    if (!engine) {
      setThinking(false)
      return
    }
    const job = ++engineJobRef.current
    setThinking(true)
    const startedAt = performance.now()
    engine
      .analyze(
        fen,
        champ
          ? { movetime: champ.moveTimeMs, multiPv: 5 }
          : { movetime: thinkTimeFor(setup.level), depth: policy.depth, multiPv: policy.weak ? 4 : 1 },
      )
      .then((res) => {
        if (job !== engineJobRef.current) return
        // low levels (and champions, briefly) take a short human-like beat
        // before replying — a delay before the move is applied, never a
        // visible loading state
        const minThink = champ ? 250 : setup.level <= 3 ? 400 + setup.level * 100 : 0
        const wait = Math.max(0, minThink - (performance.now() - startedAt))
        window.setTimeout(() => {
          if (job !== engineJobRef.current) return
          setThinking(false)
          if (!res.bestmove || s.over) return
          requestAnimationFrame(() => {
            if (job === engineJobRef.current) {
              s.applyExternalMove(champ ? pickChampionMove(res, champ, fen) : pickEngineMove(res, policy.blunderPct))
            }
          })
        }, wait)
      })
      .catch(() => {
        if (job === engineJobRef.current) setThinking(false)
      })
    return () => {
      engineJobRef.current++
    }
  }, [engine, fen, over, turn, engineColor, setup.level, policy, champ]) // eslint-disable-line react-hooks/exhaustive-deps

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
      white: { name: setup.userColor === 'w' ? identity.username : oppName, rating: setup.userColor === 'w' ? identity.ratings.rapid.rating : oppElo, avatarSeed: setup.userColor === 'w' ? identity.avatarSeed : oppName, flag: setup.userColor === 'w' ? identity.flag : null },
      black: { name: setup.userColor === 'b' ? identity.username : oppName, rating: setup.userColor === 'b' ? identity.ratings.rapid.rating : oppElo, avatarSeed: setup.userColor === 'b' ? identity.avatarSeed : oppName, flag: setup.userColor === 'b' ? identity.flag : null },
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

  const offerDraw = () => {
    if (over || s.plies.length === 0) return
    if (botAcceptsDraw(evalScore, engineColor)) {
      s.agreeDraw()
      toast.show(`${oppName} accepts the draw`)
    } else {
      toast.show(`${oppName} declines the draw`)
    }
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
  const bottomColor = flipped ? engineColor : setup.userColor
  const topColor = flipped ? setup.userColor : engineColor

  const stripFor = (color: 'w' | 'b', top: boolean) => {
    const isEngine = color === engineColor
    return (
      <PlayerStrip
        top={top}
        onTap={isEngine ? onOpponentTap : undefined}
        name={isEngine ? oppName : identity.username}
        rating={isEngine ? oppElo : identity.ratings.rapid.rating}
        avatarSeed={isEngine ? oppName : identity.avatarSeed}
        flag={isEngine ? null : identity.flag}
        pieceSet={settings.pieceSet}
        captured={color === 'w' ? caps.byWhite : caps.byBlack}
        active={!over && turn === color}
        thinking={isEngine && thinking}
        subtitle={isEngine ? (champ ? champ.title : `Level ${lvl.level} · ~${lvl.elo}`) : undefined}
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

  const arrows = hint ? [{ from: hint.from, to: hint.to, color: 'rgba(174, 241, 53, 0.85)' }] : []

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
            blindfold={settings.blindfold}
            premove={s.premove}
            arrows={arrows}
            ariaLabel={`Chess board vs ${oppName}`}
          />
        </div>
        {stripFor(bottomColor, false)}
      </div>

      <div className="game-side" data-tab="moves">
        {s.result && (
          <div className="result-banner">
            <div className="rb-title">{resultTitle(s.result, identity.username, oppName)}</div>
            <div className="rb-sub">
              {s.result.winner === null ? '½ – ½' : s.result.winner === setup.userColor ? 'You won!' : 'Better luck next time.'}
            </div>
            {evalScore && (
              <div className="rb-sub mono">Final eval: {formatEval(evalScore)}</div>
            )}
          </div>
        )}

        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>vs {oppName}</b>
            <span>
              level {lvl.level} · {setup.tc?.label ?? 'untimed'}
            </span>
          </div>

          <MoveList sans={s.sans} currentPly={s.displayPly} onSeek={(p) => s.seek(p)} />

          <div className="game-controls">
            {!over ? (
              <>
                <button className="btn btn-sm" onClick={requestHint} disabled={!engine || turn !== setup.userColor}>
                  <IconBulb size={15} /> Hint
                </button>
                <button className="btn btn-sm" onClick={doTakeback} disabled={s.plies.length === 0}>
                  ↩ Takeback
                </button>
                <button className="btn btn-sm" onClick={offerDraw} disabled={s.plies.length === 0}>
                  ½ Draw
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
            <button className="btn btn-sm" onClick={() => setFlipped((f) => !f)} title="Flip board (F)">
              ⇅ Flip
            </button>
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
              vs <b>{oppName}</b> ({champ ? champ.style : lvl.blurb}) — premoves are {settings.premoves ? 'on' : 'off'}. Right-drag to draw arrows,
              right-click a square to mark it.
            </div>
          </div>

          {chatOpen && (
            <SoloChat
              onSecret={(engaged) => {
                setSoloOn(engaged)
                toast.show(engaged ? 'Engine on' : 'Engine off')
              }}
            />
          )}
        </div>
      </div>

      {confirmResign && (
        <Confirm
          title="Resign"
          message={`Resign against ${oppName}? You'll lose this game.`}
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
