// STEP 1 diagnostic — Play-a-Friend across two isolated browser contexts.
// Records console errors, page errors, non-2xx/failed network requests
// (URL, method, status, body) and the UI text each context ends up showing.
// Run: node e2e/repro-invite.mjs
import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5199'
const SUPA = 'https://vtyksxibpkstzjnjcyzs.supabase.co'

function watch(page, log, name) {
  page.on('console', (m) => {
    if (m.type() === 'error') log.push({ ctx: name, kind: 'console', text: m.text().slice(0, 300) })
  })
  page.on('pageerror', (e) => log.push({ ctx: name, kind: 'pageerror', text: String(e).slice(0, 300) }))
  page.on('response', async (r) => {
    if (r.status() >= 400) {
      let body = ''
      try {
        body = (await r.text()).slice(0, 300)
      } catch {
        /* stream already consumed */
      }
      log.push({ ctx: name, kind: 'response', method: r.request().method(), url: r.url(), status: r.status(), body })
    }
  })
  page.on('requestfailed', (req) =>
    log.push({ ctx: name, kind: 'requestfailed', method: req.method(), url: req.url(), error: req.failure()?.errorText }),
  )
}

async function clickText(page, text, timeout = 15_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const ok = await page.evaluate((t) => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.offsetParent !== null && (b.textContent || '').includes(t),
      )
      if (!btn) return false
      btn.click()
      return true
    }, text)
    if (ok) return
    if (Date.now() > deadline) throw new Error(`button "${text}" not found`)
    await page.waitForTimeout(150)
  }
}

const events = []
const browser = await chromium.launch()
try {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  watch(a, events, 'A(creator)')
  watch(b, events, 'B(friend)')

  // --- A: create a casual 5+0 invite playing White -------------------------
  await a.goto(`${BASE}/play`, { waitUntil: 'domcontentloaded' })
  await clickText(a, 'Play a friend')
  await clickText(a, 'Casual')
  await clickText(a, 'White')
  await clickText(a, '5+0')
  await clickText(a, 'Create invite link', 30_000)
  await a.waitForFunction(
    () => [...document.querySelectorAll('input')].some((i) => i.readOnly && /\/(invite|join)\//.test(i.value)),
    null,
    { timeout: 30_000 },
  )
  const inviteLink = await a.evaluate(
    () => [...document.querySelectorAll('input')].find((i) => i.readOnly && /\/(invite|join)\//.test(i.value)).value,
  )
  console.log('INVITE LINK:', inviteLink)
  console.log('A UI (waiting room):', (await a.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 400))

  // --- B: open the invite link in a separate guest session -----------------
  await b.goto(inviteLink, { waitUntil: 'domcontentloaded' })
  await b.waitForTimeout(8_000)
  console.log('B pathname:', new URL(b.url()).pathname)
  console.log('B UI:', (await b.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 600))

  await a.waitForTimeout(3_000)
  console.log('A pathname after B opened the link:', new URL(a.url()).pathname)
  console.log('A UI now:', (await a.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 300))

  // --- same-guest case: second tab inside A's browser profile --------------
  const a2 = await ctxA.newPage()
  watch(a2, events, 'A2(same guest, new tab)')
  await a2.goto(inviteLink, { waitUntil: 'domcontentloaded' })
  await a2.waitForTimeout(6_000)
  console.log('A2 (same guest tab) pathname:', new URL(a2.url()).pathname)
  console.log('A2 UI:', (await a2.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400))
  await a2.close()

  // --- CORS preflight probes against the deployed Edge Functions -----------
  const cors = await b.evaluate(async (supa) => {
    const out = []
    for (const fn of ['game-create', 'game-join', 'game-action']) {
      try {
        const r = await fetch(`${supa}/functions/v1/${fn}`, {
          method: 'OPTIONS',
          headers: {
            Origin: location.origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,apikey,x-client-info,content-type',
          },
        })
        out.push({
          fn,
          status: r.status,
          allowOrigin: r.headers.get('access-control-allow-origin'),
          allowHeaders: r.headers.get('access-control-allow-headers'),
          allowMethods: r.headers.get('access-control-allow-methods'),
        })
      } catch (e) {
        out.push({ fn, error: String(e) })
      }
    }
    return out
  }, SUPA)
  console.log('CORS preflight (deployed functions):', JSON.stringify(cors, null, 2))

  // --- unauthenticated game-join call: JWT validation probe ---------------
  const joinProbe = await b.evaluate(async (supa) => {
    const r = await fetch(`${supa}/functions/v1/game-join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ZZZZZZZZ' }),
    })
    return { status: r.status, body: (await r.text()).slice(0, 300) }
  }, SUPA)
  console.log('game-join without a JWT:', JSON.stringify(joinProbe))
} finally {
  await browser.close()
}

console.log('\n=== EVENTS: console errors / page errors / non-2xx or failed requests ===')
console.log(events.length ? JSON.stringify(events, null, 2) : '(none)')
