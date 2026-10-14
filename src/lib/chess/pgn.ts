import { Chess } from 'chess.js'
import type { Ply } from './types'

export interface PgnHeaders {
  white: string
  black: string
  result: string
  date?: string
  event?: string
  timecontrol?: string
  whiteelo?: string
  blackelo?: string
  opening?: string
}

function tag(name: string, value: string): string {
  return `[${name} "${value.replace(/"/g, "'")}"]`
}

export function buildPgn(startFen: string, plies: Ply[], h: PgnHeaders): string {
  const chess = new Chess(startFen)
  const sans = plies.map((p) => {
    const m = chess.move({
      from: p.uci.slice(0, 2),
      to: p.uci.slice(2, 4),
      promotion: p.uci.length > 4 ? p.uci[4] : undefined,
    })
    return m.san
  })
  const tags = [
    tag('Event', h.event ?? 'Casual Game'),
    tag('Site', 'chess-multiplayer.netlify.app'),
    tag('Date', h.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.')),
    tag('Round', '1'),
    tag('White', h.white),
    tag('Black', h.black),
    tag('Result', h.result),
  ]
  if (h.timecontrol) tags.push(tag('TimeControl', h.timecontrol))
  if (h.whiteelo) tags.push(tag('WhiteElo', h.whiteelo))
  if (h.blackelo) tags.push(tag('BlackElo', h.blackelo))
  if (h.opening) tags.push(tag('Opening', h.opening))
  if (startFen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
    tags.push(tag('FEN', startFen))
    tags.push(tag('SetUp', '1'))
  }

  // wrap SAN text at ~80 chars
  const body: string[] = []
  let line = ''
  sans.forEach((san, i) => {
    const moveNo = i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''
    const token = `${moveNo}${san} `
    if (line.length + token.length > 78) {
      body.push(line.trim())
      line = ''
    }
    line += token
  })
  if (line.trim()) body.push(line.trim())

  return `${tags.join('\n')}\n\n${body.join('\n ')} ${h.result}\n`
}

export interface ImportedGame {
  startFen: string
  ucis: string[]
  headers: Partial<PgnHeaders>
}

/** Parse PGN text (with or without tags). Throws on malformed move text. */
export function parsePgn(pgn: string): ImportedGame {
  const chess = new Chess()
  // throws on malformed tag/move text
  chess.loadPgn(pgn)
  const history = chess.history()
  // replay from the (possibly non-standard) start to extract ucis
  const startFen =
    /\[FEN "([^"]+)"\]/.exec(pgn)?.[1] ??
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  const replay = new Chess(startFen)
  const ucis: string[] = []
  for (const san of history) {
    const m = replay.move(san)
    ucis.push(m.from + m.to + (m.promotion ?? ''))
  }
  const grab = (k: string) => {
    const m = new RegExp(`\\[${k} "([^"]*)"\\]`).exec(pgn)
    return m ? m[1] : undefined
  }
  return {
    startFen,
    ucis,
    headers: {
      white: grab('White'),
      black: grab('Black'),
      result: grab('Result'),
      timecontrol: grab('TimeControl'),
      whiteelo: grab('WhiteElo'),
      blackelo: grab('BlackElo'),
      opening: grab('Opening'),
    },
  }
}

export function uciToSan(startFen: string, ucis: string[]): string[] {
  const chess = new Chess(startFen)
  return ucis.map(
    (u) =>
      chess.move({
        from: u.slice(0, 2),
        to: u.slice(2, 4),
        promotion: u.length > 4 ? u[4] : undefined,
      }).san,
  )
}

/** Validate a FEN string; returns the normalized FEN or throws. */
export function validateFen(fen: string): string {
  const chess = new Chess(fen.trim())
  return chess.fen()
}
