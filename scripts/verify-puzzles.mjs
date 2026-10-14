/**
 * Standalone verifier for src/assets/puzzles/puzzles.json.
 * Independently re-checks every puzzle with chess.js (does not reuse the
 * generator's logic):
 *   a. FEN constructs; the puzzle side is to move; defender is not already in
 *      check; two kings; pawns not on ranks 1/8; the defender (side NOT to
 *      move) is not in check before the solution move (the position must be
 *      legal: side to move just played, so the OTHER side may be in check —
 *      but here the puzzle side is the mating side, so the defender must not
 *      already be mated/stalemated).
 *   b. solution[0] is legal and delivers checkmate.
 *   c. themes include mateIn1 or mateIn2; mateIn2 pairs are complete.
 *   d. ECO-style sanity: id unique, rating in [100, 3000].
 * Run: node scripts/verify-puzzles.mjs   (exit 1 on any failure)
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = JSON.parse(readFileSync(join(root, 'src', 'assets', 'puzzles', 'puzzles.json'), 'utf8'))

let pass = 0
const failures = []
const themeCounts = {}
const ids = new Set()

function tryMove(chess, uci) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
  } catch {
    return null
  }
}

for (const p of raw) {
  const fail = (msg) => failures.push(`${p.id ?? '?'}: ${msg}`)
  try {
    if (!p.id || ids.has(p.id)) fail('missing or duplicate id')
    ids.add(p.id)
    if (!Array.isArray(p.solution) || p.solution.length === 0) fail('empty solution')
    if (!Array.isArray(p.themes) || p.themes.length === 0) fail('no themes')
    if (!Number.isInteger(p.rating) || p.rating < 100 || p.rating > 3000) fail(`bad rating ${p.rating}`)

    const chess = new Chess(p.fen)
    const stm = chess.turn() // 'w' or 'b'
    const defender = stm === 'w' ? 'b' : 'w'

    // side to move must have legal moves and the game must not be over
    if (chess.isGameOver()) fail('position already over')
    if (chess.moves().length === 0) fail('no legal moves')

    // exactly two kings, no pawns on back ranks
    const board = chess.board()
    let wk = 0
    let bk = 0
    for (const row of board) {
      for (const sq of row) {
        if (!sq) continue
        if (sq.type === 'k') sq.color === 'w' ? wk++ : bk++
        if (sq.type === 'p' && (sq.square[1] === '1' || sq.square[1] === '8')) fail('pawn on back rank')
      }
    }
    if (wk !== 1 || bk !== 1) fail(`king count w=${wk} b=${bk}`)

    const isM1 = p.themes.includes('mateIn1')
    const isM2 = p.themes.includes('mateIn2')
    if (!isM1 && !isM2) fail('missing mateIn1/mateIn2 theme')

    if (isM1) {
      if (p.solution.length !== 1) fail(`mateIn1 must have exactly1 move, got ${p.solution.length}`)
      const before = new Chess(p.fen)
      const m = tryMove(before, p.solution[0])
      if (!m) fail(`solution ${p.solution[0]} illegal`)
      else if (!before.isCheckmate()) fail(`${p.solution[0]} is not checkmate`)
      // sanity: the mating side actually delivers — i.e. defender was in check after
      if (m) {
        const after = new Chess(p.fen)
        tryMove(after, p.solution[0])
        if (!after.inCheck()) fail('defender not in check after solution')
      }
    } else if (isM2) {
      const first = new Chess(p.fen)
      const m = tryMove(first, p.solution[0])
      if (!m) fail(`solution ${p.solution[0]} illegal`)
      else if (first.isCheckmate()) fail('actually mateIn1, not mateIn2')
      else {
        const replies = first.moves({ verbose: true }).map((r) => r.from + r.to + (r.promotion ?? ''))
        const pairs = new Map()
        for (let i = 1; i + 1 < p.solution.length; i += 2) {
          pairs.set(p.solution[i], p.solution[i + 1])
        }
        for (const r of replies) {
          const mateUci = pairs.get(r)
          if (!mateUci) {
            fail(`missing mate for reply ${r}`)
            continue
          }
          const t = new Chess(first.fen())
          if (!tryMove(t, r)) {
            fail(`reply ${r} illegal`)
            continue
          }
          const fin = new Chess(t.fen())
          if (!tryMove(fin, mateUci)) fail(`mate ${mateUci} illegal after ${r}`)
          else if (!fin.isCheckmate()) fail(`line ${r} ${mateUci} not mate`)
        }
        for (const r of pairs.keys()) if (!replies.includes(r)) fail(`extra pair for nonexistent reply ${r}`)
      }
    }

    for (const t of p.themes) themeCounts[t] = (themeCounts[t] ?? 0) + 1
    if (failures.length === 0 || !failures.some((f) => f.startsWith(p.id))) pass++
  } catch (e) {
    failures.push(`${p.id ?? '?'}: exception ${e.message}`)
  }
}

console.log(`verified ${raw.length} puzzles | pass=${pass} fail=${failures.length}`)
console.log('themes:', JSON.stringify(themeCounts))
if (failures.length) {
  console.log(failures.slice(0, 20).join('\n'))
  process.exit(1)
}
console.log('ALL PASS')
