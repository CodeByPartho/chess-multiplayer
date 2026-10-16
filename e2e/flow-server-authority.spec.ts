import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Ratings are server-authoritative: the browser cannot forge them through
 * the data API. The anon key (which is public by design) can READ ratings,
 * but writes are rejected and the rating RPCs are not executable by the
 * signed-out role at all.
 */

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const SB_URL = /VITE_SUPABASE_URL=(.+)/.exec(env)?.[1]?.trim() ?? ''
const SB_KEY = /VITE_SUPABASE_ANON_KEY=(.+)/.exec(env)?.[1]?.trim() ?? ''

test.describe('server-side rating authority', () => {
  test.skip(!SB_URL || !SB_KEY, 'Supabase env not configured')

  test('client roles cannot write ratings; RPCs refuse the signed-out role', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.shell')

    const call = (path: string, init: RequestInit) =>
      page.evaluate(
        async ({ api, key, path, init }) => {
          const r = await fetch(`${api}${path}`, {
            ...init,
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
              ...(init.headers as Record<string, string> | undefined),
            },
          })
          return { status: r.status, body: (await r.text()).slice(0, 300) }
        },
        { api: `${SB_URL}/rest/v1`, key: SB_KEY, path, init },
      )

    // reads are open by design
    const reads = await call('/ratings?limit=5', { method: 'GET' })
    expect(reads.status).toBe(200)

    // a forged INSERT is refused outright
    const forged = await call('/ratings', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([
        { user_id: '00000000-0000-4000-8000-000000000001', category: 'blitz', rating: 3000, rd: 45, vol: 0.06 },
      ]),
    })
    expect(forged.status).toBeGreaterThanOrEqual(400)

    // a forged UPDATE moves nothing: snapshot, attempt, compare
    const before = await call('/ratings?select=user_id,category,rating&limit=20', { method: 'GET' })
    const upd = await call('/ratings?category=eq.blitz', { method: 'PATCH', body: JSON.stringify({ rating: 3000 }) })
    const after = await call('/ratings?select=user_id,category,rating&limit=20', { method: 'GET' })
    if (upd.status < 400) expect(after.body).toBe(before.body)

    // history writes are refused too
    const hist = await call('/rating_history', {
      method: 'POST',
      body: JSON.stringify([
        {
          user_id: '00000000-0000-4000-8000-000000000001',
          category: 'blitz',
          game_id: '00000000-0000-4000-8000-000000000002',
          rating_before: 3000,
          rating_after: 3000,
          rd_after: 45,
          result: 'win',
        },
      ]),
    })
    expect(hist.status).toBeGreaterThanOrEqual(400)

    // rating RPCs are not executable by the signed-out role
    for (const rpc of ['leaderboard', 'finalize_game', 'record_puzzle_result']) {
      const res = await call(`/rpc/${rpc}`, { method: 'POST', body: JSON.stringify({}) })
      expect(res.status, `rpc ${rpc}`).toBeGreaterThanOrEqual(400)
    }
  })
})
