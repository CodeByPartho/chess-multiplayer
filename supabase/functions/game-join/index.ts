// Join an invite-link game by code; activates it and returns the game id.
import { CORS_HEADERS, json, bad } from '../_shared/cors.ts'
import { getUserId, readJsonLimited, serviceClient, type GameRow } from '../_shared/game.ts'

/** waiting invites stop being joinable after 24h (matches the client join screen) */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return bad('method', 405)
  try {
    const supa = serviceClient()
    const userId = await getUserId(req, supa)
    if (!userId) return bad('unauthorized', 401)

    const body = await readJsonLimited(req, 2_048)
    if (!body) return bad('bad request')
    const code = String(body.code ?? '').trim().toUpperCase()
    if (!code || code.length > 12) return bad('bad code')

    const { data, error } = await supa.from('games').select('*').eq('invite_code', code).maybeSingle()
    if (error) throw new Error(error.message)
    const game = data as GameRow | null
    if (!game) return json({ error: 'invite not found — check the link', code: 'not_found' }, 404)

    // a player of this game re-opening the link: let them back in (reconnect)
    const seated = game.white_id === userId || game.black_id === userId
    if (game.status === 'aborted') return json({ error: 'the creator cancelled this game', code: 'cancelled' }, 410)
    if (game.status === 'over') {
      if (seated) return json({ gameId: game.id })
      return json({ error: 'this game has already finished', code: 'finished' }, 410)
    }
    if (game.status === 'active') {
      if (seated) return json({ gameId: game.id })
      return json({ error: 'this game is already full', code: 'full' }, 409)
    }
    if (game.status !== 'waiting') return json({ error: 'game is not joinable', code: 'not_joinable' }, 410)

    // the creator opening their own invite: not an error state, but there is
    // no seat for them — the client shows the "open it in another browser"
    // explainer from the game row itself, so this is just a guard rail
    if (seated) return json({ error: 'you created this invite — open the link in a different browser', code: 'own_invite' }, 403)

    // stale invites die like the join screen says they do
    if (Date.now() - new Date(game.created_at).getTime() > INVITE_TTL_MS) {
      return json({ error: 'this invite has expired — ask for a new link', code: 'expired' }, 410)
    }

    const joinsAs: 'w' | 'b' = game.white_id === null ? 'w' : 'b'
    const patch = {
      status: 'active',
      white_id: joinsAs === 'w' ? userId : game.white_id,
      black_id: joinsAs === 'b' ? userId : game.black_id,
      last_move_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    // conditional on status='waiting' so two simultaneous joiners can never
    // both win the seat: the loser updates 0 rows and gets a 409
    const { data: updated, error: upErr } = await supa
      .from('games')
      .update(patch)
      .eq('id', game.id)
      .eq('status', 'waiting')
      .select('id')
    if (upErr) throw new Error(upErr.message)
    if (!updated || updated.length === 0) return json({ error: 'this game is already full', code: 'full' }, 409)

    return json({ gameId: game.id, color: joinsAs })
  } catch (e) {
    return json({ error: (e as Error).message ?? 'server error' }, 500)
  }
})
