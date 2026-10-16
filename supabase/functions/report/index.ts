// Submit a player report (abuse / cheating / sandbagging).
//
// The service role is the only writer: the client-side insert policy on
// public.reports was dropped in 0019. Every report is gated here — the game
// must exist, the caller must have played it, the target must be the
// opponent, and a per-user ceiling (5/hour, public.rate_check) applies.
import { CORS_HEADERS, json, bad } from '../_shared/cors.ts'
import { getUserId, readJsonLimited, serviceClient } from '../_shared/game.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return bad('method', 405)
  try {
    const supa = serviceClient()
    const userId = await getUserId(req, supa)
    if (!userId) return bad('unauthorized', 401)

    const body = await readJsonLimited(req, 4_096)
    if (!body) return bad('bad request')
    const reportedId = String(body.reportedId ?? '')
    const gameId = body.gameId ? String(body.gameId) : null
    const reason = String(body.reason ?? '').trim().slice(0, 300)
    if (!reportedId || reportedId === userId) return bad('bad report target')
    if (reason.length < 3) return bad('describe the issue')

    // reports are filed from a game the reporter actually played
    if (!gameId) return bad('reports are filed from a game')
    const { data: game, error: gameErr } = await supa
      .from('games')
      .select('white_id, black_id')
      .eq('id', gameId)
      .maybeSingle()
    if (gameErr) throw new Error(gameErr.message)
    if (!game) return bad('game not found', 404)
    const me = game.white_id === userId ? 'w' : game.black_id === userId ? 'b' : null
    if (!me) return bad('not a player in this game', 403)
    const oppId = me === 'w' ? game.black_id : game.white_id
    if (!oppId || reportedId !== oppId) return bad('you can only report your opponent')

    // per-user ceiling, enforced in the database
    const { data: allowed, error: rlErr } = await supa.rpc('rate_check', {
      p_user_id: userId,
      p_bucket: 'report',
      p_limit: 5,
      p_window_secs: 3_600,
    })
    if (rlErr) throw new Error(rlErr.message)
    if (allowed !== true) return json({ error: 'too many reports — try again later' }, 429)

    const { error } = await supa.from('reports').insert({
      reporter_id: userId,
      reported_id: reportedId,
      game_id: gameId,
      reason,
    })
    if (error) throw new Error(error.message)
    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error).message ?? 'server error' }, 500)
  }
})
