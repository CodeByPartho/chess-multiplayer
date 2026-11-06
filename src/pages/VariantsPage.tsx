import { useEffect, useRef, useState } from 'react'
import type { Position } from 'chessops'
import { isDrop, type Role } from 'chessops'
import { Board } from '@/board/Board'
import { pieceUrl, type PieceColor, type PieceType } from '@/board/pieces'
import { Link } from '@/router'
import { useSettings } from '@/lib/settings'
import { useToast } from '@/components/Toast'
import { sounds } from '@/lib/sounds'
import {
  VARIANTS,
  displayFen,
  legalDests,
  newVariantPosition,
  pickVariantMove,
  pocketOf,
  tryPlay,
  variantOutcomeText,
  type VariantInfo,
} from '@/variants/variantGame'

type Mode = 'computer' | 'pass'

const ROLE_LETTER: Record<Role, string> = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' }

function PocketRow({
  pos,
  color,
  active,
  selected,
  onSelect,
}: {
  pos: Position
  color: 'white' | 'black'
  active: boolean
  selected: Role | null
  onSelect: (r: Role | null) => void
}) {
  const settings = useSettings()
  const pieces = pocketOf(pos, color)
  if (pieces.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 34 }}>
      <span className="hint" style={{ marginRight: 2 }}>
        Pocket
      </span>
      {pieces.map(({ role, count }) => (
        <button
          key={role}
          className="btn btn-sm"
          disabled={!active}
          onClick={() => onSelect(selected === role ? null : role)}
          style={{
            padding: '2px 6px',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            borderColor: selected === role ? 'var(--accent)' : undefined,
            background: selected === role ? 'var(--accent-soft, rgba(174,241,53,0.15))' : undefined,
          }}
          title={active ? `Drop a ${role}` : undefined}
        >
          <img src={pieceUrl(settings.pieceSet, color === 'white' ? 'w' : 'b', ROLE_LETTER[role].toLowerCase() as PieceType)} alt={role} width={22} height={22} />
          {count > 1 && <b>{count}</b>}
        </button>
      ))}
      {selected && active && <span className="hint">tap a square to drop the {selected}</span>}
    </div>
  )
}

function VariantGame({ info, mode, userColor, onExit }: { info: VariantInfo; mode: Mode; userColor: PieceColor; onExit: () => void }) {
  const settings = useSettings()
  const toast = useToast()
  const posRef = useRef<Position | null>(null)
  if (!posRef.current) posRef.current = newVariantPosition(info.id)
  const pos = posRef.current
  const [fen, setFen] = useState(() => displayFen(pos))
  const [sans, setSans] = useState<string[]>([])
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [pocketSel, setPocketSel] = useState<Role | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [, setTick] = useState(0)

  const outcome = variantOutcomeText(pos, info.id)
  const turn: PieceColor = pos.turn === 'white' ? 'w' : 'b'
  const myTurn = mode === 'pass' || turn === userColor
  const bottom: PieceColor = mode === 'pass' ? (flipped ? 'b' : 'w') : userColor

  const refresh = (san: string, move: { from?: string; to: string }) => {
    setFen(displayFen(pos))
    setSans((prev) => [...prev, san])
    setLastMove(move.from ? { from: move.from, to: move.to } : null)
    setPocketSel(null)
    setTick((t) => t + 1)
    sounds.playMove(san)
  }

  const computerMove = () => {
    const move = pickVariantMove(pos, info.id)
    if (!move) return
    const uci =
      'role' in move
        ? `${ROLE_LETTER[move.role]}@${squareName(move.to)}`
        : `${squareName(move.from)}${squareName(move.to)}${move.promotion ? ROLE_LETTER[move.promotion].toLowerCase() : ''}`
    const played = tryPlay(pos, uci) ?? tryPlay(pos, uci.replace('@', '@'.toLowerCase()))
    if (played) {
      refresh(played.san, isDrop(played.move) ? { to: squareName(played.move.to) } : { from: squareName(played.move.from), to: squareName(played.move.to) })
    }
  }

  useEffect(() => {
    if (mode !== 'computer' || outcome || turn === userColor) return
    const id = setTimeout(computerMove, 450)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, mode, outcome])

  const onMove = (uci: string) => {
    if (outcome || !myTurn) return
    const played = tryPlay(pos, uci)
    if (!played) {
      toast.show('Not a legal move in this variant', 'info')
      return
    }
    refresh(played.san, isDrop(played.move) ? { to: squareName(played.move.to) } : { from: squareName(played.move.from), to: squareName(played.move.to) })
  }

  const onDropSquare = (sq: string) => {
    if (!pocketSel || outcome || !myTurn) return
    const letter = ROLE_LETTER[pocketSel]
    const played = tryPlay(pos, `${letter}@${sq}`) ?? tryPlay(pos, `${letter.toLowerCase()}@${sq}`)
    if (!played) {
      toast.show('Cannot drop there', 'info')
      return
    }
    refresh(played.san, { to: sq })
  }

  const newGame = () => {
    posRef.current = newVariantPosition(info.id)
    setSans([])
    setLastMove(null)
    setPocketSel(null)
    setFen(displayFen(posRef.current))
    setTick((t) => t + 1)
  }

  const checksLine =
    info.id === 'threecheck' && pos.remainingChecks
      ? `Checks given: White ${3 - pos.remainingChecks.white}/3 · Black ${3 - pos.remainingChecks.black}/3`
      : null

  return (
    <div className="game-layout" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="game-main">
        <PocketRow pos={pos} color={bottom === 'w' ? 'black' : 'white'} active={false} selected={null} onSelect={() => {}} />
        <div className="board-slot">
          <Board
            fen={fen}
            orientation={bottom}
            movable={outcome || !myTurn || pocketSel ? [] : [turn]}
            onMove={onMove}
            legalTargets={(sq) => legalDests(pos, sq)}
            lastMove={lastMove}
            pieceSet={settings.pieceSet}
            coords={settings.coords}
            autoQueen={settings.autoQueen}
            blindfold={settings.blindfold}
            editorPiece={pocketSel ? { color: turn, type: ROLE_LETTER[pocketSel].toLowerCase() as PieceType } : undefined}
            onEditorPlace={onDropSquare}
            ariaLabel={`${info.name} board`}
          />
        </div>
        <PocketRow
          pos={pos}
          color={bottom === 'w' ? 'white' : 'black'}
          active={!outcome && myTurn && turn === bottom}
          selected={pocketSel}
          onSelect={setPocketSel}
        />
      </div>
      <div className="game-side" data-tab="moves">
        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>{info.name}</b>
            <span>{mode === 'computer' ? 'vs computer' : 'pass & play'}</span>
          </div>
          <div className="card" style={{ padding: 12 }}>
            <p className="hint" style={{ margin: 0, lineHeight: 1.5 }}>
              {info.rules}
            </p>
            {checksLine && <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>{checksLine}</p>}
            <p style={{ margin: '8px 0 0', fontSize: 14 }}>
              {outcome ? <b>{outcome}</b> : <>{turn === 'w' ? 'White' : 'Black'} to move{pos.isCheck() && info.id !== 'antichess' ? ' (check)' : ''}</>}
            </p>
          </div>
          <div className="card" style={{ padding: 12, maxHeight: 220, overflowY: 'auto' }}>
            <div className="hint" style={{ marginBottom: 6 }}>
              Moves
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 13.5, lineHeight: 1.7 }}>
              {sans.length === 0 && <span className="hint">No moves yet</span>}
              {sans.map((san, i) => (
                <span key={i} style={{ marginRight: 8 }}>
                  {i % 2 === 0 && <span className="hint">{i / 2 + 1}. </span>}
                  {san}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={newGame}>
              New game
            </button>
            {mode === 'pass' && (
              <button className="btn btn-sm" onClick={() => setFlipped((f) => !f)}>
                ⇅ Flip
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={onExit}>
              ← All variants
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function squareName(sq: number): string {
  return 'abcdefgh'[sq % 8] + String(Math.floor(sq / 8) + 1)
}

export default function VariantsPage() {
  const [active, setActive] = useState<VariantInfo | null>(null)
  const [mode, setMode] = useState<Mode>('computer')
  const [color, setColor] = useState<'w' | 'b' | 'random'>('w')
  const [round, setRound] = useState(0)

  if (active) {
    const userColor: PieceColor = color === 'random' ? (round % 2 === 0 ? 'w' : 'b') : color
    return (
      <VariantGame
        key={`${active.id}-${round}`}
        info={active}
        mode={mode}
        userColor={userColor}
        onExit={() => setActive(null)}
      />
    )
  }

  return (
    <div className="page-narrow">
      <h1 className="page-title">Variants</h1>
      <p className="hint" style={{ marginBottom: 12 }}>
        Eight ways to break the rules, played on this device: against the computer or pass and play. Same board, same
        pieces, very different games.
      </p>
      <div className="card" style={{ padding: 12, marginBottom: 14, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>
          <span className="hint" style={{ marginRight: 8 }}>Mode</span>
          <button className={`btn btn-sm ${mode === 'computer' ? 'btn-primary' : ''}`} onClick={() => setMode('computer')}>
            Vs computer
          </button>{' '}
          <button className={`btn btn-sm ${mode === 'pass' ? 'btn-primary' : ''}`} onClick={() => setMode('pass')}>
            Pass &amp; play
          </button>
        </span>
        {mode === 'computer' && (
          <span>
            <span className="hint" style={{ marginRight: 8 }}>Play as</span>
            <button className={`btn btn-sm ${color === 'w' ? 'btn-primary' : ''}`} onClick={() => setColor('w')}>
              White
            </button>{' '}
            <button className={`btn btn-sm ${color === 'b' ? 'btn-primary' : ''}`} onClick={() => setColor('b')}>
              Black
            </button>{' '}
            <button className={`btn btn-sm ${color === 'random' ? 'btn-primary' : ''}`} onClick={() => setColor('random')}>
              Random
            </button>
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            className="action-card"
            onClick={() => {
              setRound((r) => r + 1)
              setActive(v)
            }}
          >
            <span>
              <span className="ac-title">{v.name}</span>
              <span className="ac-sub">{v.tagline}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        Standard chess lives in the <Link to="/play">lobby</Link>; the computer in variants plays a sharp one-move
        lookahead, so bring your tactics.
      </p>
    </div>
  )
}
