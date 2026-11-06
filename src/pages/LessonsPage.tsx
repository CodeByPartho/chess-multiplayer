import { useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import { Board } from '@/board/Board'
import { Link } from '@/router'
import { useSettings } from '@/lib/settings'
import { useToast } from '@/components/Toast'
import { load, save } from '@/lib/storage'
import type { PieceColor } from '@/board/pieces'

interface LessonStep {
  text: string
  fen: string
  /** uci the learner must find (first 4 chars compared, promotion suffix optional) */
  findMove?: string
  hint?: string
}

interface Lesson {
  id: string
  title: string
  level: string
  steps: LessonStep[]
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const LESSONS: Lesson[] = [
  {
    id: 'checkmate',
    title: 'Check and checkmate',
    level: 'Basics',
    steps: [
      {
        text: 'Check means your king is under attack and must escape. Checkmate is check with no escape: the game ends. Here the black king is boxed in by its own pawns. Find the mate in one.',
        fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
        findMove: 'a1a8',
        hint: 'The rook wants the back rank.',
      },
      {
        text: 'A queen and king mate works by pushing the enemy king to the edge first. This queen move gives check and cuts off the whole board. Play it.',
        fen: '8/8/8/4k3/8/8/3Q4/4K3 w - - 0 1',
        findMove: 'd2d6',
        hint: 'Bring the queen close, next to her king.',
      },
    ],
  },
  {
    id: 'castling',
    title: 'Castling',
    level: 'Basics',
    steps: [
      {
        text: 'Castling tucks your king behind pawns and brings a rook out, in one move. It is the only move where two pieces move at once. Castle kingside: drag the king two squares toward the rook.',
        fen: '6k1/8/8/8/8/8/8/R3K2R w KQ - 0 1',
        findMove: 'e1g1',
        hint: 'King from e1 to g1.',
      },
      {
        text: 'You cannot castle out of check, through check, or after the king or that rook has moved. Knowing when it is still legal wins games by itself.',
        fen: START,
      },
    ],
  },
  {
    id: 'enpassant',
    title: 'En passant',
    level: 'Basics',
    steps: [
      {
        text: 'When an enemy pawn dashes two squares and lands beside yours, you may capture it as if it had moved one square. It is called en passant, and it is only legal on the very next move. Black just played e7-e5. Capture it en passant.',
        fen: '8/8/8/2kPp3/8/8/8/6K1 w - e6 0 1',
        findMove: 'd5e6',
        hint: 'Your d5 pawn captures onto e6, and the e5 pawn disappears.',
      },
    ],
  },
  {
    id: 'fork',
    title: 'The knight fork',
    level: 'Tactics',
    steps: [
      {
        text: 'A fork attacks two pieces at once; the opponent can only save one. Knights fork best because they jump. Find the knight move that checks the king and attacks the rook at the same time.',
        fen: 'r3k3/8/8/1N6/8/8/8/6K1 w - - 0 1',
        findMove: 'b5c7',
        hint: 'Land on c7: from there the knight checks e8 and eyes a8.',
      },
      {
        text: 'After Nc7+ the king must move, and the rook on a8 falls next move. That one tempo wins a whole rook. Always look at every knight check: half of them are forks.',
        fen: 'r3k3/2N5/8/8/8/8/8/6K1 b - - 0 1',
      },
    ],
  },
  {
    id: 'pin',
    title: 'The pin',
    level: 'Tactics',
    steps: [
      {
        text: 'A pin freezes a piece because moving it would expose something bigger behind it. Put the rook on the e-file so the black queen is pinned to her king.',
        fen: '4k3/8/4q3/8/8/8/8/R5K1 w - - 0 1',
        findMove: 'a1e1',
        hint: 'Line your rook up with the queen and the king behind her.',
      },
      {
        text: 'The queen cannot leave the e-file without exposing the king to check, which is illegal. Pins turn strong pieces into statues; build them whenever a king sits on an open line.',
        fen: '4k3/8/4q3/8/8/8/8/4R1K1 b - - 0 1',
      },
    ],
  },
  {
    id: 'scholars',
    title: 'Defend the classic trap',
    level: 'Openings',
    steps: [
      {
        text: 'White threatens Qxf7 checkmate, the famous Scholar\'s mate. Many beginners lose in four moves here. You are Black: find the move that stops the mate and attacks the queen.',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
        findMove: 'g7g6',
        hint: 'A pawn move blocks f7 and kicks the queen at once.',
      },
      {
        text: 'g6 does both jobs. The lesson is bigger than the trap: when a queen comes out early, look for moves that defend and gain time by attacking her.',
        fen: 'r1bqkbnr/pppp1p1p/2n3p1/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 4',
      },
    ],
  },
  {
    id: 'promotion',
    title: 'Promote the pawn',
    level: 'Endgames',
    steps: [
      {
        text: 'A pawn that reaches the last rank promotes, almost always to a queen. Your g-pawn is one step away and the black king is too far to stop it. Promote.',
        fen: '8/6P1/8/8/8/8/k6K/8 w - - 0 1',
        findMove: 'g7g8',
        hint: 'Push the pawn to g8 and choose the queen.',
      },
      {
        text: 'Most endgames are races: count who queens first, and whether the new queen can stop the enemy pawn. That one count decides whole games.',
        fen: START,
      },
    ],
  },
  {
    id: 'stalemate',
    title: 'Stalemate is a draw',
    level: 'Endgames',
    steps: [
      {
        text: 'If the side to move has no legal move and is NOT in check, the game is a draw called stalemate. Black to move here has no square: the queen covers everything without checking. A lost game saved by stalemate is half a point earned.',
        fen: '7k/8/6Q1/8/8/8/8/K7 b - - 0 1',
      },
      {
        text: 'When you are winning, the last thing to check before every move is: am I stalemating them? When you are losing, play for it. Whole rating points hide in this one rule.',
        fen: START,
      },
    ],
  },
]

const DONE_KEY = 'fc.lessonsDone'

export default function LessonsPage() {
  const settings = useSettings()
  const toast = useToast()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [done, setDone] = useState<string[]>(() => load<string[]>(DONE_KEY, []))
  const lesson = LESSONS.find((l) => l.id === activeId) ?? null
  const step = lesson?.steps[stepIdx] ?? null

  const chess = useMemo(() => {
    if (!step) return null
    try {
      return new Chess(step.fen)
    } catch {
      return null
    }
  }, [step])

  const finishLesson = () => {
    if (!lesson) return
    if (!done.includes(lesson.id)) {
      const next = [...done, lesson.id]
      setDone(next)
      save(DONE_KEY, next)
    }
    toast.show('Lesson complete')
    setActiveId(null)
    setStepIdx(0)
  }

  const onMove = (uci: string) => {
    if (!step?.findMove) return
    if (uci.slice(0, 4) === step.findMove.slice(0, 4)) {
      toast.show('Correct')
      if (stepIdx + 1 < (lesson?.steps.length ?? 0)) setStepIdx(stepIdx + 1)
      else finishLesson()
    } else {
      toast.show(step.hint ?? 'Not that one. Try again.', 'info')
    }
  }

  if (!lesson || !step || !chess) {
    return (
      <div className="page-narrow">
        <h1 className="page-title">Lessons</h1>
        <p className="hint" style={{ marginBottom: 14 }}>
          Short interactive lessons. Play the right move on the board to advance. {done.length}/{LESSONS.length} completed.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
          {LESSONS.map((l) => (
            <button
              key={l.id}
              className="action-card"
              onClick={() => {
                setActiveId(l.id)
                setStepIdx(0)
              }}
            >
              <span>
                <span className="ac-title">
                  {l.title} {done.includes(l.id) ? '✓' : ''}
                </span>
                <span className="ac-sub">
                  {l.level} · {l.steps.length} steps
                </span>
              </span>
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 14 }}>
          Prefer playing? <Link to="/practice">Practice key positions against the engine</Link>,{' '}
          <Link to="/studies">work through a study</Link> or <Link to="/puzzles">solve puzzles</Link>.
        </p>
      </div>
    )
  }

  const side = (step.fen.split(' ')[1] === 'b' ? 'b' : 'w') as PieceColor
  return (
    <div className="game-layout" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="game-main">
        <div className="board-slot">
          <Board
            fen={step.fen}
            orientation={side}
            movable={step.findMove ? [side] : []}
            onMove={onMove}
            legalTargets={(sq) => chess.moves({ square: sq as never, verbose: true }).map((m) => m.to)}
            pieceSet={settings.pieceSet}
            coords={settings.coords}
            ariaLabel={`Lesson: ${lesson.title}`}
          />
        </div>
      </div>
      <div className="game-side" data-tab="moves">
        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>{lesson.title}</b>
            <span>
              step {stepIdx + 1}/{lesson.steps.length}
            </span>
          </div>
          <div className="card" style={{ padding: 14 }}>
            <p style={{ margin: 0, lineHeight: 1.55 }}>{step.text}</p>
            {!step.findMove && (
              <button
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                onClick={() => (stepIdx + 1 < lesson.steps.length ? setStepIdx(stepIdx + 1) : finishLesson())}
              >
                {stepIdx + 1 < lesson.steps.length ? 'Continue' : 'Finish lesson'}
              </button>
            )}
            {step.findMove && <p className="hint" style={{ marginTop: 10 }}>Play the move on the board.</p>}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setActiveId(null)
              setStepIdx(0)
            }}
          >
            ← All lessons
          </button>
        </div>
      </div>
    </div>
  )
}
