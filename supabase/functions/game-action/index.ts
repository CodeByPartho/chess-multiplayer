// Game actions: move, resign, abort, draw, takeback, claim-win, rematch.
// Server-authoritative: validates legality, clocks and termination.
import { Chess } from 'npm:chess.js@1.4.0'
import { CORS_HEADERS, json, bad } from '../_shared/cors.ts'
import {
  colorOf,
  endGame,
  getUserId,
  loadGame,
  readJsonLimited,
  remainingMs,
  replayChess,
  serviceClient,
  terminationAfter,
  type GameRow,
  type PlyRec,
} from '../_shared/game.ts'

const OPP = (c: 'w' | 'b'): 'w' | 'b' => (c === 'w' ? 'b' : 'w')
const DISCONNECT_CLAIM_MS = 120_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return bad('method', 405)

  try {
    const supa = serviceClient()
    const userId = await getUserId(req, supa)
    if (!userId) return bad('unauthorized', 401)

    const body = await readJsonLimited(req, 8_192)
    if (!body) return bad('bad request')
    const gameId = String(body.gameId ?? '')
    const action = String(body.action ?? '')
    if (!gameId || !action) return bad('bad request')

    const game = await loadGame(supa, gameId)
    if (!game) return bad('game not found', 404)
    const me = colorOf(game, userId)
    if (!me) return bad('not a player in this game', 403)
    const opp = OPP(me)

    const fresh = async (): Promise<GameRow | null> => loadGame(supa, gameId)

    switch (action) {
      case 'move': {
        const uci = String(body.uci ?? '')
        if (game.status !== 'active') return bad('game is not active')
        if (game.result) return bad('game is over')
        if (game.turn !== me) return bad('not your turn')

        const chess = replayChess(game)
        let move
        try {
          move = chess.move({
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            promotion: uci.length > 4 ? uci[4] : undefined,
          })
        } catch {
          return bad('illegal move', 422)
        }

        const now = Date.now()
        const myMs = remainingMs(game, me, now)
        if (myMs <= 0) {
          // flagged while trying to move
          const draw = chess.isInsufficientMaterial()
          await endGame(supa, game, draw ? { winner: null, reason: 'insufficient' } : { winner: opp, reason: 'timeout' })
          return json({ game: await fresh(), flagFell: true })
        }

        const inc = Number(game.tc?.inc ?? 0)
        const afterMs = myMs + inc
        const ply: PlyRec = { uci: move.from + move.to + (move.promotion ?? ''), san: move.san, at: now, wms: 0, bms: 0 }
        const moves = [...game.moves, ply]
        const wms = me === 'w' ? afterMs : remainingMs(game, 'w', now)
        const bms = me === 'b' ? afterMs : remainingMs(game, 'b', now)
        ply.wms = wms
        ply.bms = bms

        const term = terminationAfter(chess, me)
        const patch = {
          moves,
          fen: chess.fen(),
          turn: chess.turn(),
          halfmove: Number(chess.fen().split(' ')[4] ?? 0),
          wms,
          bms,
          last_move_at: new Date(now).toISOString(),
          draw_offer: null,
          takeback_offer: null,
          updated_at: new Date(now).toISOString(),
        }
        await supa.from('games').update(patch).eq('id', game.id)
        if (term) await endGame(supa, { ...game, ...patch }, term)
        return json({ game: await fresh() })
      }

      case 'resign': {
        if (game.status !== 'active' || game.result) return bad('game is not active')
        await endGame(supa, game, { winner: opp, reason: 'resign' })
        return json({ game: await fresh() })
      }

      case 'abort': {
        if (game.result) return bad('game already finished')
        if (game.moves.length >= 2) return bad('too late to abort — resign instead')
        await endGame(supa, game, { winner: null, reason: 'aborted' }, 'aborted')
        return json({ game: await fresh() })
      }

      case 'draw_offer': {
        if (game.status !== 'active' || game.result) return bad('game is not active')
        if (game.moves.length < 2) return bad('wait for the game to start')
        if (game.draw_offer === opp) {
          // opponent already offered — accepting
          await endGame(supa, game, { winner: null, reason: 'agreement' })
          return json({ game: await fresh() })
        }
        await supa.from('games').update({ draw_offer: me, updated_at: new Date().toISOString() }).eq('id', game.id)
        return json({ game: await fresh() })
      }

      case 'draw_decline': {
        if (game.draw_offer !== opp) return bad('no offer to decline')
        await supa.from('games').update({ draw_offer: null, updated_at: new Date().toISOString() }).eq('id', game.id)
        return json({ game: await fresh() })
      }

      case 'takeback_offer': {
        if (game.status !== 'active' || game.result) return bad('game is not active')
        if (game.rated) return bad('takebacks are disabled in rated games')
        if (game.moves.length === 0) return bad('no moves to take back')
        if (game.takeback_offer === opp) {
          // accepted implicitly (they offered first)
          return doTakeback(supa, game, opp)
        }
        await supa.from('games').update({ takeback_offer: me, updated_at: new Date().toISOString() }).eq('id', game.id)
        return json({ game: await fresh() })
      }

      case 'takeback_accept': {
        if (game.takeback_offer !== opp) return bad('no takeback offer')
        return doTakeback(supa, game, opp)
      }

      case 'takeback_decline': {
        if (game.takeback_offer !== opp) return bad('no offer to decline')
        await supa.from('games').update({ takeback_offer: null, updated_at: new Date().toISOString() }).eq('id', game.id)
        return json({ game: await fresh() })
      }

      case 'claim_win': {
        if (game.status !== 'active' || game.result) return bad('game is not active')
        const now = Date.now()

        // My own flag fell: end it now instead of waiting for the opponent to
        // notice. A client that sees its own clock at 0 asks for the verdict,
        // and the server decides the loss (not the claiming client).
        if (game.turn === me && remainingMs(game, me, now) <= 0) {
          const chess = replayChess(game)
          const draw = chess.isInsufficientMaterial()
          await endGame(supa, game, draw ? { winner: null, reason: 'insufficient' } : { winner: opp, reason: 'timeout' })
          return json({ game: await fresh() })
        }

        const oppMs = remainingMs(game, opp, now)
        let reason: string | null = null
        if (oppMs <= 0) reason = 'timeout'
        else {
          const oppId = game[opp === 'w' ? 'white_id' : 'black_id']
          if (!oppId) return bad('opponent unknown')
          const { data: guest } = await supa.from('guests').select('last_seen').eq('id', oppId).maybeSingle()
          const gap = guest ? now - new Date(guest.last_seen).getTime() : Number.POSITIVE_INFINITY
          if (game.turn === opp && gap >= DISCONNECT_CLAIM_MS) reason = 'disconnect'
        }
        if (!reason) return bad('opponent is still here', 409)

        // timeout with insufficient material = draw
        if (reason === 'timeout') {
          const chess = replayChess(game)
          if (chess.isInsufficientMaterial()) {
            await endGame(supa, game, { winner: null, reason: 'insufficient' })
            return json({ game: await fresh() })
          }
        }
        await endGame(supa, game, { winner: me, reason })
        return json({ game: await fresh() })
      }

      case 'rematch': {
        if (!game.result && game.status !== 'aborted') return bad('game is not finished')
        const rematch = { ...(game.rematch ?? { w: false, b: false, game_id: null }), [me]: true }
        if (rematch.w && rematch.b && !rematch.game_id) {
          const base = Number(game.tc?.base ?? 300_000)
          const inc = Number(game.tc?.inc ?? 0)
          const { data: created, error } = await supa
            .from('games')
            .insert({
              // colors swap for the rematch
              white_id: game.black_id,
              black_id: game.white_id,
              tc: game.tc,
              rated: game.rated,
              status: 'active',
              wms: base,
              bms: base,
              start_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
              fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
              rematch_of: game.id,
            })
            .select('id')
            .single()
          if (error || !created) return bad('rematch failed', 500)
          rematch.game_id = created.id
        }
        await supa.from('games').update({ rematch, updated_at: new Date().toISOString() }).eq('id', game.id)
        return json({ game: await fresh() })
      }

      default:
        return bad('unknown action')
    }
  } catch (e) {
    return json({ error: (e as Error).message ?? 'server error' }, 500)
  }
})

/** Pop plies back to the requester's turn, restore clocks, return new game. */
async function doTakeback(supa: ReturnType<typeof serviceClient>, game: GameRow, requester: 'w' | 'b'): Response {
  const n = game.moves.length
  const pop = n >= 2 ? 2 : 1
  const kept = game.moves.slice(0, n - pop)
  const chess = new Chess(game.start_fen)
  for (const p of kept) {
    chess.move({ from: p.uci.slice(0, 2), to: p.uci.slice(2, 4), promotion: p.uci.length > 4 ? p.uci[4] : undefined })
  }
  const last = kept[kept.length - 1]
  const now = Date.now()
  const base = Number(game.tc?.base ?? 300_000)
  const inc = Number(game.tc?.inc ?? 0)
  const patch = {
    moves: kept,
    fen: chess.fen(),
    turn: chess.turn(),
    halfmove: Number(chess.fen().split(' ')[4] ?? 0),
    // clocks revert to the position before the popped moves (inc is not refunded beyond that)
    wms: last ? last.wms : base,
    bms: last ? last.bms : base,
    last_move_at: new Date(now).toISOString(),
    takeback_offer: null,
    draw_offer: null,
    updated_at: new Date(now).toISOString(),
  }
  void inc
  void requester
  await supa.from('games').update(patch).eq('id', game.id)
  const updated = await loadGame(supa, game.id)
  return json({ game: updated })
}
