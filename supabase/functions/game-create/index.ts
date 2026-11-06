// Create an invite-link game. The creator picks a color (or random);
// the opponent slot is filled by game-join.
import { corsHeaders, json, bad } from '../_shared/cors.ts'
import { getUserId, readJsonLimited, serviceClient, validTc, randCode } from '../_shared/game.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return bad(req, 'method', 405)
  try {
    const supa = serviceClient()
    const userId = await getUserId(req, supa)
    if (!userId) return bad(req, 'unauthorized', 401)

    const body = await readJsonLimited(req, 4_096)
    if (!body) return bad(req, 'bad request')

    // Per-user ceiling on invite creation (public.rate_check, same pattern
    // as the report endpoint): without it one account could flood the
    // games table with unlimited waiting rows.
    const { data: allowed, error: rlErr } = await supa.rpc('rate_check', {
      p_user_id: userId,
      p_bucket: 'game_create',
      p_limit: 20,
      p_window_secs: 3_600,
    })
    if (rlErr) throw new Error(rlErr.message)
    if (allowed !== true) return json(req, { error: 'too many games created — try again later' }, 429)

    const tc = body.tc === null ? null : body.tc
    if (!validTc(tc)) return bad(req, 'invalid time control')
    const rated = body.rated === true // invites default to casual
    const playAs: 'w' | 'b' = body.playAs === 'b' ? 'b' : body.playAs === 'w' ? 'w' : Math.random() < 0.5 ? 'w' : 'b'

    const base = tc ? Number(tc.base) : 0
    const code = randCode()
    const { data, error } = await supa
      .from('games')
      .insert({
        status: 'waiting',
        white_id: playAs === 'w' ? userId : null,
        black_id: playAs === 'b' ? userId : null,
        tc,
        rated,
        wms: base,
        bms: base,
        invite_code: code,
      })
      .select('id, invite_code')
      .single()
    if (error || !data) return bad(req, 'could not create game', 500)

    return json(req, { gameId: data.id, code: data.invite_code, playAs })
  } catch (e) {
    return json(req, { error: (e as Error).message ?? 'server error' }, 500)
  }
})
