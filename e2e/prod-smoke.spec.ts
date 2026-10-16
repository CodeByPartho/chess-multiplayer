import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Production smoke check — READ-ONLY, opt-in.
 *
 * Enabled with FC_PROD_SMOKE=1 (e.g. `FC_PROD_SMOKE=1 npm run test:e2e -- prod-smoke`).
 * It uses plain HTTP GETs only and never opens the app in a browser, so it
 * cannot create anonymous users, games or rating rows in production.
 *
 * Everything that writes lives in the other specs, which only ever run
 * against the TEST backend (see ../playwright.config.ts + ./test-backend.ts).
 */
const SITE = process.env.FC_PROD_SITE_URL ?? 'https://chess-multiplayer-788.netlify.app'

test.describe('production smoke (read-only)', () => {
  test.skip(process.env.FC_PROD_SMOKE !== '1', 'set FC_PROD_SMOKE=1 to check the live site')

  test('home page, robots.txt and sitemap.xml respond', async ({ request }) => {
    const home = await request.get(SITE)
    expect(home.status()).toBe(200)
    const html = await home.text()
    expect(html).toContain('<title>')
    expect(html).toContain('rel="canonical"')
    expect(html).toContain('og:title')

    const robots = await request.get(`${SITE}/robots.txt`)
    expect(robots.status()).toBe(200)
    expect(await robots.text()).toContain('Sitemap:')

    const sitemap = await request.get(`${SITE}/sitemap.xml`)
    expect(sitemap.status()).toBe(200)
    expect(await sitemap.text()).toContain('<urlset')
  })

  test('production data API answers reads (no writes attempted)', async ({ request }) => {
    const env = (() => {
      try {
        return readFileSync(new URL('../.env', import.meta.url), 'utf8')
      } catch {
        return ''
      }
    })()
    const url = process.env.FC_PROD_SUPABASE_URL ?? /VITE_SUPABASE_URL=(.+)/.exec(env)?.[1]?.trim() ?? ''
    const key = process.env.FC_PROD_SUPABASE_ANON_KEY ?? /VITE_SUPABASE_ANON_KEY=(.+)/.exec(env)?.[1]?.trim() ?? ''
    test.skip(!url || !key, 'production Supabase URL/anon key not available')

    const res = await request.get(`${url}/rest/v1/puzzles?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    expect(res.status()).toBe(200)
  })
})
