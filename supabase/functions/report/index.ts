// Submit a player report (abuse / cheating / sandbagging).
import { CORS_HEADERS, json, bad } from '../_shared/cors.ts'
import { getUserId, serviceClient } from '../_shared/game.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return bad('method', 405)
  try {
    const supa = serviceClient()
    const userId = await getUserId(req, supa)
    if (!userId) return bad('unauthorized', 401)

    const body = await req.json()
    const reportedId = String(body.reportedId ?? '')
    const gameId = body.gameId ? String(body.gameId) : null
    const reason = String(body.reason ?? '').trim().slice(0, 300)
    if (!reportedId || reportedId === userId) return bad('bad report target')
    if (reason.length < 3) return bad('describe the issue')

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
