/**
 * Generates src/assets/puzzles/puzzles.json — a verified mate-in-1 puzzle database.
 *
 * Positions are built programmatically from mating-pattern families:
 *   backRank, corridor, smothered, promotion, ladder (2 rooks),
 *   krEndgame (K+R), kqEndgame (K+Q)
 * and also emitted in mirrored form (black to move) for variety.
 * Every candidate is fully verified with chess.js before acceptance:
 *   - the FEN is a legal position, the mating side is to move,
 *   - the defender is NOT already in check,
 *   - the listed move is legal and delivers checkmate.
 * Run: node scripts/gen-puzzles.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const FILES = 'abcdefgh'

/** Build a FEN from piece placements like {a8:'k', h7:'p'} (white = uppercase). */
function fen(placements, side = 'w') {
  const rows = []
  for (let r = 8; r >= 1; r--) {
    let row = ''
    let empty = 0
    for (const f of FILES) {
      const p = placements[f + r]
      if (p) {
        if (empty) row += empty
        empty = 0
        row += p
      } else empty++
    }
    if (empty) row += empty
    rows.push(row)
  }
  return `${rows.join('/')} ${side} - - 0 1`
}

/** Mirror a placement set horizontally+vertically and swap colors. */
function mirror(placements) {
  const out = {}
  for (const [sq, p] of Object.entries(placements)) {
    const nf = FILES[7 - FILES.indexOf(sq[0])]
    const nr = 9 - Number(sq[1])
    out[nf + nr] = p === p.toUpperCase() ? p.toLowerCase() : p.toUpperCase()
  }
  return out
}

const rnd = (() => {
  let s = 20261015
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
})()
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

function tryMove(chess, uci) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
  } catch {
    return null
  }
}

function blackAlreadyInCheck(placements) {
  const probe = new Chess(fen(placements, 'b'))
  return probe.inCheck()
}

/** All white mating moves for a position (empty when position is bad/over). */
function mateMoves(placements, side = 'w') {
  let chess
  try {
    chess = new Chess(fen(placements, side))
  } catch {
    return []
  }
  if (chess.isGameOver() || chess.inCheck()) return []
  const mates = []
  for (const m of chess.moves({ verbose: true })) {
    const t = new Chess(chess.fen())
    t.move({ from: m.from, to: m.to, promotion: m.promotion })
    if (t.isCheckmate()) mates.push(m.from + m.to + (m.promotion ?? ''))
  }
  return mates
}

const out = []
const seenFen = new Set()

function emit(placements, side, pattern, title, rating) {
  const key = fen(placements, side)
  if (seenFen.has(key)) return false
  if (side === 'w' && blackAlreadyInCheck(placements)) return false
  if (side === 'b') {
    // mirrored: "blackAlreadyInCheck" for mirrored means WHITE in check — probe as white
    const probe = new Chess(key)
    if (probe.inCheck()) return false
  }
  const mates = mateMoves(placements, side)
  if (mates.length === 0) return false
  seenFen.add(key)
  const uci = mates.length === 1 || pattern === 'smothered' ? mates[0] : pick(mates)
  out.push({
    fen: key,
    solution: [uci],
    themes: ['mateIn1', pattern],
    rating,
    title,
  })
  return true
}

function allSquares() {
  const res = []
  for (const f of FILES) for (let r = 1; r <= 8; r++) res.push(f + r)
  return res
}
function cheby(a, b) {
  return Math.max(Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])), Math.abs(Number(a[1]) - Number(b[1])))
}
function edgeSquares() {
  return allSquares().filter((s) => s[1] === '1' || s[1] === '8' || s[0] === 'a' || s[0] === 'h')
}
function blackInCheckNow(placements) {
  try {
    return new Chess(fen(placements, 'b')).inCheck()
  } catch {
    return true
  }
}

// ================= T1: back-rank =================
{
  const blackKs = ['h8', 'g8']
  const shells = [
    { g7: 'p', h7: 'p' },
    { f7: 'p', g7: 'p', h7: 'p' },
    { e7: 'p', f7: 'p', g7: 'p', h7: 'p' },
  ]
  const wkSpots = ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2', 'a3', 'b3', 'h3']
  let n = 0
  outer: for (const bk of blackKs) {
    for (const shell of shells) {
      for (const rf of FILES) {
        const rook = rf + '1'
        const wk = pick(wkSpots)
        if (wk === rook || shell[wk]) continue
        const pl = { [bk]: 'k', [rook]: 'R', [wk]: 'K', ...shell }
        if (emit(pl, 'w', 'backRank', `Back-rank mate on the ${rf}-file`, 420 + Math.floor(rnd() * 280))) {
          n++
          if (n >= 24) break outer
        }
      }
    }
  }
}

// ================= T2: corridor queen =================
{
  const blackKs = ['h8', 'g8']
  const shells = [
    { g7: 'p', h7: 'p' },
    { f7: 'p', g7: 'p', h7: 'p' },
    { f7: 'p', g7: 'p', h7: 'p', c7: 'p' },
  ]
  const wkSpots = ['a1', 'b1', 'c1', 'a2', 'b2', 'c2', 'a3', 'b3']
  let n = 0
  outer: for (const bk of blackKs) {
    for (const shell of shells) {
      for (const qf of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) {
        const q = qf + '1'
        const wk = pick(wkSpots)
        if (wk === q || shell[wk]) continue
        const pl = { [bk]: 'k', [q]: 'Q', [wk]: 'K', ...shell }
        if (emit(pl, 'w', 'corridor', 'Corridor queen mate', 480 + Math.floor(rnd() * 300))) {
          n++
          if (n >= 14) break outer
        }
      }
    }
  }
}

// ================= T3: smothered knight =================
{
  const origins = ['d6', 'e5', 'g5', 'h6', 'd8', 'c7', 'b6']
  const wkSpots = ['a1', 'b1', 'c1', 'a2', 'b2', 'c2', 'd2', 'a3', 'b3', 'c3', 'd1']
  let n = 0
  outer: for (const origin of origins) {
    for (const wk of wkSpots) {
      if (origin === wk) continue
      const pl = { h8: 'k', g8: 'r', g7: 'p', h7: 'p', [origin]: 'N', [wk]: 'K' }
      if (emit(pl, 'w', 'smothered', 'Smothered mate', 720 + Math.floor(rnd() * 320))) {
        n++
        if (n >= 14) break outer
      }
    }
  }
}

// ================= T4: promotion mate =================
// black Ka7, white Pb7 promotes b8=Q#. The pawn must not already check the
// king (a b7 pawn attacks a8/c8, so the king sits on a7). Rb1 supports b8,
// white king covers a6/b6 escapes.
{
  const blackFillers = [
    {},
    { d7: 'p' },
    { e7: 'p', f7: 'p' },
    { g7: 'p', h7: 'p' },
    { d6: 'p' },
    { e6: 'p', g6: 'p' },
  ]
  const rookSpots = ['b1', 'b2', 'b3', 'b4']
  let n = 0
  outer: for (const ex of blackFillers) {
    for (const rs of rookSpots) {
      if (ex[rs]) continue
      // Ka5 covers the a6/b6 escapes without blocking the b-file (b5 would);
      // Rb1..b4 defends the promotion square b8.
      const pl = { a7: 'k', b7: 'P', a5: 'K', [rs]: 'R', ...ex }
      if (emit(pl, 'w', 'promotion', 'Promotion mate', 820 + Math.floor(rnd() * 300))) {
        n++
        if (n >= 12) break outer
      }
    }
  }
}

// ================= T5: two-rook ladder =================
// black king on the edge, one rook far away controlling files/ranks, the other
// delivers. Verified for genuine two-rook necessity (mate disappears if the
// supporting rook is removed).
{
  const bkSquares = ['a4', 'a5', 'a6', 'a3', 'h4', 'h5', 'h6', 'h3', 'd1', 'e1', 'f1', 'g1']
  let n = 0
  outer: for (const bk of bkSquares) {
    const wk = bk[0] === 'a' ? 'f2' : 'c2'
    if (cheby(wk, bk) < 3) continue
    // support rook fixed far from the action, delivering rook varies
    const support = bk[0] === 'a' ? 'h8' : 'a8'
    for (const rsq of allSquares()) {
      if (rsq === bk || rsq === wk || rsq === support) continue
      const pl = { [bk]: 'k', [support]: 'R', [rsq]: 'R', [wk]: 'K' }
      if (blackInCheckNow(pl)) continue
      const mates = mateMoves(pl, 'w')
      if (mates.length === 0) continue
      // genuine two-rook mate? remove the support rook and re-check
      const without = { ...pl }
      delete without[support]
      const solo = mateMoves(without, 'w')
      if (solo.length > 0) continue // single-rook mate, belongs to another family
      seenFen.add(fen(pl, 'w'))
      out.push({
        fen: fen(pl, 'w'),
        solution: [pick(mates)],
        themes: ['mateIn1', 'ladder'],
        rating: 520 + Math.floor(rnd() * 300),
        title: 'Ladder mate',
      })
      n++
      if (n >= 14) break outer
    }
  }
}

// ================= T6: K+R vs K endgame mate =================
{
  let n = 0
  outer: for (const bk of edgeSquares()) {
    for (const wk of allSquares()) {
      const d = cheby(wk, bk)
      if (d < 2 || d > 3) continue
      for (const rsq of allSquares()) {
        if (rsq === bk || rsq === wk) continue
        const pl = { [bk]: 'k', [wk]: 'K', [rsq]: 'R' }
        if (blackInCheckNow(pl)) continue
        const mates = mateMoves(pl, 'w')
        if (mates.length === 0) continue
        emit(pl, 'w', 'krEndgame', 'Rook and king mate', 600 + Math.floor(rnd() * 260))
        n++
        if (n >= 14) break outer
      }
    }
  }
}

// ================= T7: K+Q vs K endgame mate =================
{
  let n = 0
  outer: for (const bk of edgeSquares()) {
    for (const wk of allSquares()) {
      const d = cheby(wk, bk)
      if (d < 2 || d > 3) continue
      for (const qsq of allSquares()) {
        if (qsq === bk || qsq === wk) continue
        const pl = { [bk]: 'k', [wk]: 'K', [qsq]: 'Q' }
        if (blackInCheckNow(pl)) continue
        const mates = mateMoves(pl, 'w')
        if (mates.length === 0) continue
        emit(pl, 'w', 'kqEndgame', 'Queen and king mate', 540 + Math.floor(rnd() * 240))
        n++
        if (n >= 14) break outer
      }
    }
  }
}

// ================= mirrored copies (black to move) =================
// take up to half of each theme, mirrored, to give both sides to move
const themed = {}
for (const p of out) themed[p.themes[1]] = (themed[p.themes[1]] ?? 0) + 1
const mirrored = []
for (const p of out) {
  if (rnd() > 0.45) continue
  const side = 'b'
  // rebuild placements from fen to mirror it
  const rows = p.fen.split(' ')[0].split('/')
  const pl = {}
  rows.forEach((row, i) => {
    const rank = 8 - i
    let f = 0
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch)
      else {
        pl[FILES[f] + rank] = ch
        f++
      }
    }
  })
  const mp = mirror(pl)
  const key = fen(mp, side)
  if (seenFen.has(key)) continue
  try {
    const c = new Chess(key)
    if (c.isGameOver() || c.inCheck()) continue
  } catch {
    continue
  }
  // white (the defender) must not already be in check: probe with white to move
  const wp = new Chess(fen(mp, 'w'))
  if (wp.inCheck()) continue
  const mates = mateMoves(mp, side)
  if (mates.length === 0) continue
  seenFen.add(key)
  mirrored.push({
    fen: key,
    solution: [mates[0]],
    themes: p.themes,
    rating: Math.min(1700, p.rating + 40),
    title: p.title,
  })
}

out.push(...mirrored)

// ================= emit =================
out.forEach((p, i) => (p.id = `p${String(i + 1).padStart(3, '0')}`))
mkdirSync(join(root, 'src', 'assets', 'puzzles'), { recursive: true })
writeFileSync(join(root, 'src', 'assets', 'puzzles', 'puzzles.json'), JSON.stringify(out, null, 1) + '\n')

const themes = {}
for (const p of out) for (const t of p.themes) themes[t] = (themes[t] ?? 0) + 1
const ratings = out.map((p) => p.rating)
console.log(`puzzles: ${out.length} | themes: ${JSON.stringify(themes)}`)
console.log(`rating range: ${Math.min(...ratings)}..${Math.max(...ratings)} | sides: w=${out.filter((p) => p.fen.split(' ')[1] === 'w').length} b=${out.filter((p) => p.fen.split(' ')[1] === 'b').length}`)
if (out.length < 100) {
  console.error(`ONLY ${out.length} PUZZLES — need >=100`)
  process.exit(1)
}
