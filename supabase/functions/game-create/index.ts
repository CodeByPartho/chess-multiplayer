// Create an invite-link game. The creator picks a color (or random);
// the opponent slot is filled by game-join.
import { CORS_HEADERS, json, bad } from '../_shared/cors.ts'
import { getUserId, serviceClient, validTc, randCode } from '../_shared/game.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return bad('method', 405)
  try {
    const supa = serviceClient()
    const userId = await getUserId(req, supa)
    if (!userId) return bad('unauthorized', 401)

    const body = await req.json()
    const tc = body.tc
    if (!validTc(tc)) return bad('invalid time control')
    const rated = body.rated === true // invites default to casual
    const playAs: 'w' | 'b' = body.playAs === 'b' ? 'b' : body.playAs === 'w' ? 'w' : Math.random() < 0.5 ? 'w' : 'b'

    const base = Number(tc.base)
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
    if (error || !data) return bad('could not create game', 500)

    return json({ gameId: data.id, code: data.invite_code, playAs })
  } catch (e) {
    return json({ error: (e as Error).message ?? 'server error' }, 500)
  }
})
