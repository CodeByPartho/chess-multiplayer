import { useCallback, useMemo, useState } from 'react'
import { Board } from '@/board/Board'
import { useGameSession, capturedPieces } from '@/game/useGameSession'
import { useNavKeys, type NavAction } from '@/game/useNavKeys'
import { PlayerStrip } from '@/components/PlayerStrip'
import { GameClock } from '@/components/Clock'
import { MoveList } from '@/components/MoveList'
import { Modal, Confirm } from '@/components/Modal'
import { useToast } from '@/components/Toast'
import { useSettings } from '@/lib/settings'
import { buildPgn } from '@/lib/chess/pgn'
import { pgnResult, resultTitle, resultSubtitle } from '@/game/resultText'
import { copyText } from '@/lib/clipboard'
import { sounds } from '@/lib/sounds'
import type { TimeControl } from '@/lib/chess/types'

interface Setup {
  whiteName: string
  blackName: string
  tc: TimeControl | null
}

const CLOCK_OPTIONS: { label: string; tc: TimeControl | null }[] = [
  { label: 'Untimed', tc: null },
  { label: '5 + 3', tc: { base: 300_000, inc: 3_000, type: 'blitz', label: '5+3' } },
  { label: '10 + 0', tc: { base: 600_000, inc: 0, type: 'rapid', label: '10+0' } },
  { label: '15 + 10', tc: { base: 900_000, inc: 10_000, type: 'rapid', label: '15+10' } },
  { label: '30 + 0', tc: { base: 1_800_000, inc: 0, type: 'classical', label: '30+0' } },
]

export default function PassPlayPage() {
  const settings = useSettings()
  const toast = useToast()
  const [setup, setSetup] = useState<Setup | null>(null)
  const [round, setRound] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [confirmResign, setConfirmResign] = useState(false)
  const [confirmDraw, setConfirmDraw] = useState(false)
  const [showPgn, setShowPgn] = useState(false)

  if (!setup) return <SetupForm onStart={(s) => { setSetup(s); setRound(0); sounds.play('start') }} />

  return (
    <PassPlayGame
      key={round}
      setup={setup}
      flipped={flipped}
      onFlip={() => setFlipped((f) => !f)}
      onNewGame={() => setSetup(null)}
      onRematch={() => {
        setRound((r) => r + 1)
        sounds.play('start')
      }}
      settings={settings}
      toastError={toast.error}
      toastShow={toast.show}
      confirmResign={confirmResign}
      setConfirmResign={setConfirmResign}
      confirmDraw={confirmDraw}
      setConfirmDraw={setConfirmDraw}
      showPgn={showPgn}
      setShowPgn={setShowPgn}
    />
  )
}

function SetupForm({ onStart }: { onStart: (s: Setup) => void }) {
  const [whiteName, setWhiteName] = useState('Player 1')
  const [blackName, setBlackName] = useState('Player 2')
  const [tc, setTc] = useState<TimeControl | null>(null)

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div className="card">
        <h2>Pass &amp; Play</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 14.5 }}>
          Two players share one device. White sits at the bottom; use the flip button to turn the board between turns.
        </p>
        <div className="field">
          <label htmlFor="p1">White player</label>
          <input id="p1" className="input" value={whiteName} maxLength={20} onChange={(e) => setWhiteName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="p2">Black player</label>
          <input id="p2" className="input" value={blackName} maxLength={20} onChange={(e) => setBlackName(e.target.value)} />
        </div>
        <div className="field">
          <label>Clock</label>
          <div className="tc-row">
            {CLOCK_OPTIONS.map((o) => (
              <button
                key={o.label}
                className={`tc-btn ${((o.tc?.label ?? '') === (tc?.label ?? '')) ? 'selected' : ''}`}
                style={{ minWidth: 78, padding: '8px 12px' }}
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
              whiteName: whiteName.trim() || 'White',
              blackName: blackName.trim() || 'Black',
              tc,
            })
          }
        >
          Start game
        </button>
      </div>
    </div>
  )
}

function PassPlayGame({
  setup,
  flipped,
  onFlip,
  onNewGame,
  onRematch,
  settings,
  toastError,
  toastShow,
  confirmResign,
  setConfirmResign,
  confirmDraw,
  setConfirmDraw,
  showPgn,
  setShowPgn,
}: {
  setup: Setup
  flipped: boolean
  onFlip: () => void
  onNewGame: () => void
  onRematch: () => void
  settings: { pieceSet: string; coords: boolean; autoQueen: boolean }
  toastError: (m: string) => void
  toastShow: (m: string) => void
  confirmResign: boolean
  setConfirmResign: (v: boolean) => void
  confirmDraw: boolean
  setConfirmDraw: (v: boolean) => void
  showPgn: boolean
  setShowPgn: (v: boolean) => void
}) {
  const s = useGameSession({
    mode: 'passplay',
    tc: setup.tc,
    myColors: ['w', 'b'],
    myColorForSound: null,
    premoves: false,
  })

  const onSeek = useCallback(
    (action: NavAction) => {
      s.seek(action === 'first' ? 0 : action === 'last' ? s.plies.length : action === 'prev' ? s.displayPly - 1 : s.displayPly + 1)
    },
    [s],
  )
  useNavKeys(onSeek)

  const bottomColor = flipped ? 'b' : 'w'
  const topColor = flipped ? 'w' : 'b'
  const nameOf = (c: 'w' | 'b') => (c === 'w' ? setup.whiteName : setup.blackName)

  const caps = useMemo(() => capturedPieces(s.core.startFen, s.displayFen), [s.core.startFen, s.displayFen])
  const capFor = (c: 'w' | 'b') => (c === 'w' ? caps.byWhite : caps.byBlack)

  const pgn = useMemo(() => {
    if (!s.result) return null
    return buildPgn(s.core.startFen, s.plies, {
      white: setup.whiteName,
      black: setup.blackName,
      result: pgnResult(s.result),
      event: 'Pass & Play',
      timecontrol: setup.tc ? `${setup.tc.base / 1000}+${setup.tc.inc / 1000}` : undefined,
    })
  }, [s.result, s.plies, s.core.startFen, setup])

  const stripFor = (color: 'w' | 'b', top: boolean) => (
    <PlayerStrip
      top={top}
      name={nameOf(color)}
      pieceSet={settings.pieceSet}
      captured={capFor(color)}
      active={!s.over && s.turn === color && s.isLive}
      clock={
        setup.tc ? (
          <GameClock
            getMs={() => s.core.remaining(color, Date.now()) ?? 0}
            running={!s.over && s.turn === color}
            lowMs={Math.min(15_000, Math.floor((setup.tc?.base ?? 60000) / 6))}
          />
        ) : (
          <GameClock untimed getMs={() => 0} running={false} />
        )
      }
    />
  )

  return (
    <div className="game-layout">
      <div className="game-main">
        {stripFor(topColor, true)}
        <div className="board-slot">
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
            ariaLabel={`Chess board, ${nameOf(bottomColor)} at the bottom`}
          />
        </div>
        {stripFor(bottomColor, false)}
      </div>

      <div className="game-side" data-tab="moves">
        {s.over && s.result && (
          <div className="result-banner">
            <div className="rb-title">{resultTitle(s.result, setup.whiteName, setup.blackName)}</div>
            <div className="rb-sub">{resultSubtitle(s.result, null)}</div>
          </div>
        )}

        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>Pass &amp; Play</b>
            <span>{setup.tc?.label ?? 'untimed'}</span>
          </div>

          <MoveList sans={s.sans} currentPly={s.displayPly} onSeek={(p) => s.seek(p)} />

          <div className="game-controls">
            <button className="btn btn-sm" onClick={onFlip} title="Flip board (F)">
              ⇅ Flip
            </button>
            {!s.over ? (
              <>
                <button className="btn btn-sm" onClick={() => setConfirmDraw(true)}>
                  Draw
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => setConfirmResign(true)}>
                  Resign
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-sm" onClick={() => setShowPgn(true)}>
                  PGN
                </button>
                <button className="btn btn-sm btn-primary" onClick={onRematch}>
                  Rematch
                </button>
              </>
            )}
            <button className="btn btn-sm btn-ghost" onClick={onNewGame}>
              New game
            </button>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div className="hint">
              Navigate moves with <span className="kbd">←</span> <span className="kbd">→</span>, <span className="kbd">Home</span> /{' '}
              <span className="kbd">End</span>. Right-drag on the board to draw arrows.
            </div>
          </div>
        </div>
      </div>

      {confirmResign && (
        <Confirm
          title="Resign"
          message={`${nameOf(s.turn)} to move — resign as ${nameOf(s.turn)}? This loses the game.`}
          confirmLabel="Resign"
          danger
          onCancel={() => setConfirmResign(false)}
          onConfirm={() => {
            setConfirmResign(false)
            s.resign(s.turn)
          }}
        />
      )}
      {confirmDraw && (
        <Confirm
          title="Draw"
          message={`${nameOf(s.turn)} offers a draw. Since both players share this device, confirming ends the game as a draw by agreement.`}
          confirmLabel="Agree draw"
          onCancel={() => setConfirmDraw(false)}
          onConfirm={() => {
            setConfirmDraw(false)
            s.agreeDraw()
          }}
        />
      )}
      {showPgn && pgn && (
        <Modal
          title="PGN"
          onClose={() => setShowPgn(false)}
          actions={
            <>
              <button className="btn" onClick={() => setShowPgn(false)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  void copyText(pgn).then((ok) => (ok ? toastShow('PGN copied') : toastError('Copy failed')))
                  setShowPgn(false)
                }}
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
