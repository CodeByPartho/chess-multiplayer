import { Chess } from 'chess.js'
import type { Analysis } from '@/engine/engine'

/**
 * Champion bots. Each persona is a full-strength engine whose *taste* is
 * bent: the engine returns its top lines (MultiPV), and the champion picks
 * the one that matches how he actually played — attackers take the checks
 * and captures inside a small evaluation window, grinders take the quiet
 * improving move, prophylactic players take the safest strong move. On top
 * of that, each champion follows his real opening book for as long as the
 * game stays on a line he was known for.
 */
export interface ChampionWeights {
  capture: number
  check: number
  pawnPush: number
  central: number
  quiet: number
}

export interface Champion {
  id: string
  name: string
  title: string
  /** display rating: their peak, roughly */
  elo: number
  /** how he thinks, in one line — shown on the setup card */
  style: string
  moveTimeMs: number
  /** how far below the engine's best (centipawns) a styled pick may fall */
  windowCp: number
  weights: ChampionWeights
  /** signature lines in SAN, from the start position */
  book: string[]
}

export const CHAMPIONS: Champion[] = [
  {
    id: 'magnus',
    name: 'Magnus Carlsen',
    title: 'World Champion 2013–2023',
    elo: 2882,
    style: 'Outplays you in equal positions. Quiet moves, small edges, endgames squeezed until something breaks.',
    moveTimeMs: 1100,
    windowCp: 55,
    weights: { capture: 6, check: 4, pawnPush: 8, central: 6, quiet: 14 },
    book: [
      // Ruy Lopez, Breyer variation — his squeeze as White
      'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7',
      // Berlin endgame as Black — the wall he made famous again
      'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8',
    ],
  },
  {
    id: 'hikaru',
    name: 'Hikaru Nakamura',
    title: 'Five-time US Champion · blitz king',
    elo: 2816,
    style: 'Sharp theory at bullet speed. Grabs space, opens lines, and trusts his tactics more than your preparation.',
    moveTimeMs: 350,
    windowCp: 65,
    weights: { capture: 14, check: 14, pawnPush: 8, central: 8, quiet: 0 },
    book: [
      // Najdorf as Black — his lifelong weapon
      'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be7 f3 O-O Qd2 Nc6',
      // Giuoco Piano as White — quiet setup, fast tactics
      'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 a6 Bb3 Ba7 O-O d6',
      // King's Indian as Black against d4
      'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7',
    ],
  },
  {
    id: 'kasparov',
    name: 'Garry Kasparov',
    title: 'World Champion 1985–2000',
    elo: 2851,
    style: 'Attacks with preparation and fury. Pawn storms, piece sacrifices, and pressure until the position catches fire.',
    moveTimeMs: 900,
    windowCp: 60,
    weights: { capture: 12, check: 16, pawnPush: 12, central: 10, quiet: 0 },
    book: [
      // Najdorf against the English Attack — opposite castling, both sides race
      'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e6 f3 b5 g4 h6 Qd2 Nbd7 O-O-O Bb7',
      // King's Indian — build the center, then blow it up with …f5
      'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Ne1 Nd7 f3 f5',
      // The Scotch he revived as White
      'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6',
    ],
  },
  {
    id: 'karpov',
    name: 'Anatoly Karpov',
    title: 'World Champion 1975–1985',
    elo: 2780,
    style: 'Prophylaxis first: stops your ideas before they exist, then improves his worst piece until you run out of moves.',
    moveTimeMs: 800,
    windowCp: 40,
    weights: { capture: 4, check: 2, pawnPush: 6, central: 8, quiet: 18 },
    book: [
      // Caro-Kann, Classical — the defence he turned into a weapon
      'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6',
      // Queen's Gambit as White — small, permanent pressure
      'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 Nxd5',
    ],
  },
  {
    id: 'fischer',
    name: 'Bobby Fischer',
    title: 'World Champion 1972–1975',
    elo: 2785,
    style: 'Crystal-clear plans played at full force. Grabs material others fear, centralizes everything, calculates to the end.',
    moveTimeMs: 700,
    windowCp: 50,
    weights: { capture: 10, check: 8, pawnPush: 10, central: 12, quiet: 6 },
    book: [
      // The Poisoned Pawn — he took b2 and dared you to refute it
      'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5 e6 f4 Qb6 Qd2 Qxb2 Rb1 Qa3',
      // King's Indian Attack as White — modest setup, hidden attack
      'e4 e6 d3 d5 Nd2 Nf6 Ngf3 c5 g3 Nc6 Bg2 Be7 O-O O-O e5 Nd7 Re1 b5',
    ],
  },
]

const CENTER = new Set(['d4', 'd5', 'e4', 'e5', 'c4', 'c5', 'f4', 'f5'])

/** line value from the mover's perspective, mate-aware */
function lineValue(score: { cp?: number; mate?: number }): number {
  if (score.mate !== undefined) return score.mate > 0 ? 100_000 - score.mate : -100_000 - score.mate
  return score.cp ?? 0
}

/**
 * The champion's next book move (UCI) when the game's SAN history is a
 * strict prefix of one of his signature lines, else null.
 */
export function bookMoveFor(champion: Champion, historySans: string[]): string | null {
  for (const line of champion.book) {
    const sans = line.split(' ')
    if (historySans.length >= sans.length) continue
    let match = true
    for (let i = 0; i < historySans.length; i++) {
      if (sans[i] !== historySans[i]) {
        match = false
        break
      }
    }
    if (!match) continue
    const chess = new Chess()
    let uci: string | null = null
    for (let i = 0; i <= historySans.length; i++) {
      const mv = chess.move(sans[i])
      if (i === historySans.length) uci = mv.from + mv.to + (mv.promotion ?? '')
    }
    if (uci) return uci
  }
  return null
}

/**
 * Pick the champion's move from a MultiPV analysis: keep the lines inside
 * his evaluation window, then let his style weights decide. Mate scores
 * always win — no style point is worth missing a forced mate.
 */
export function pickChampionMove(res: Analysis, champion: Champion, fen: string): string {
  const candidates = res.lines.filter((l) => l.pv.length > 0)
  if (candidates.length === 0) return res.bestmove ?? ''
  const best = Math.max(...candidates.map((l) => lineValue(l.score)))
  if (best > 90_000) {
    const mating = candidates.find((l) => lineValue(l.score) === best)
    return mating?.pv[0] ?? res.bestmove ?? ''
  }
  const eligible = candidates.filter((l) => best - lineValue(l.score) <= champion.windowCp)
  const chess = new Chess(fen)
  let pick = eligible[0]
  let pickScore = -Infinity
  for (const line of eligible) {
    const uci = line.pv[0]
    let mv
    try {
      mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
    } catch {
      continue
    }
    chess.undo()
    const w = champion.weights
    let style = lineValue(line.score)
    if (mv.captured) style += w.capture
    if (mv.san.includes('+') || mv.san.includes('#')) style += w.check
    if (mv.piece === 'p') style += w.pawnPush
    if (CENTER.has(mv.to)) style += w.central
    if (!mv.captured && !mv.san.includes('+')) style += w.quiet
    style += Math.random() * 3 // tie-break, keeps him human
    if (style > pickScore) {
      pickScore = style
      pick = line
    }
  }
  return pick?.pv[0] ?? res.bestmove ?? ''
}
