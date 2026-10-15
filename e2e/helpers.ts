import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { Chess } from 'chess.js'

// puzzle data (same JSON the app imports — loaded via fs to stay Node-ESM clean)
export interface E2EPuzzle {
  id: string
  fen: string
  solution: string[]
  themes: string[]
  rating: number
  title: string
}
export const puzzles: E2EPuzzle[] = JSON.parse(
  readFileSync(new URL('../src/assets/puzzles/puzzles.json', import.meta.url), 'utf8'),
) as E2EPuzzle[]

/* ------------------------------------------------------------------ */
/* Viewports                                                           */
/* ------------------------------------------------------------------ */

export const VIEWPORTS = [
  { name: '360x740', width: 360, height: 740 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const

export type Viewport = (typeof VIEWPORTS)[number]
export type Orientation = 'white' | 'black'

/** a legal 20-ply opening line (Ruy Lopez, main line) — used for scripted moves */
export const LINE_20 = [
  'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7',
  'f1e1', 'b7b5', 'a4b3', 'd7d6', 'c2c3', 'e8g8', 'h2h3', 'c6a5', 'b3c2', 'c7c5',
]

/* ------------------------------------------------------------------ */
/* Navigation / setup                                                   */
/* ------------------------------------------------------------------ */

export async function gotoPath(page: Page, path: string) {
  await page.goto(path)
  await page.waitForSelector('.shell')
}

/** wait for the board to exist, be whole-pixel snapped to a multiple of 8, and stop resizing */
export async function waitBoardSettled(page: Page) {
  await page.waitForSelector('.board')
  await page.waitForFunction(() => {
    const b = document.querySelector('.board') as HTMLElement | null
    if (!b) return false
    const w = b.getBoundingClientRect().width
    return w >= 100 && Math.abs(w / 8 - Math.round(w / 8)) < 0.001
  })
  // stable across consecutive frames (resize observer finished)
  for (let i = 0; i < 20; i++) {
    const s1 = await boardSize(page)
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    )
    const s2 = await boardSize(page)
    if (Math.abs(s1.w - s2.w) < 0.5 && Math.abs(s1.h - s2.h) < 0.5) return
  }
}

export async function boardSize(page: Page): Promise<{ w: number; h: number }> {
  return page.evaluate(() => {
    const b = document.querySelector('.board')!
    const r = b.getBoundingClientRect()
    return { w: r.width, h: r.height }
  })
}

export async function startPassPlay(page: Page) {
  await gotoPath(page, '/passandplay')
  await page.getByRole('button', { name: 'Start game', exact: true }).click()
  await waitBoardSettled(page)
}

/** /analysis opens in the board editor — click through to the analysis board */
export async function startAnalysis(page: Page) {
  await gotoPath(page, '/analysis')
  expect(await clickButton(page, 'Analyze position')).toBe(true)
  await page.waitForSelector('.game-layout', { timeout: 20_000 })
  await waitBoardSettled(page)
}

export async function startComputer(page: Page, color: 'w' | 'b') {
  await gotoPath(page, '/computer')
  await page.waitForSelector('input[type="range"][aria-label="Computer level"]', { timeout: 20_000 })
  await page.evaluate(() => {
    const input = document.querySelector('input[type="range"][aria-label="Computer level"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, '1')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.evaluate((c) => {
    const label = c === 'w' ? 'White' : 'Black'
    const btn = [...document.querySelectorAll('.seg button')].find((b) => (b.textContent || '').includes(label))
    btn?.click()
  }, color)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Start game vs/.test(b.textContent || ''))
    btn?.click()
  })
  await waitBoardSettled(page)
}

/* ------------------------------------------------------------------ */
/* Board geometry & interaction                                         */
/* ------------------------------------------------------------------ */

export async function squareCenter(page: Page, sq: string): Promise<{ x: number; y: number }> {
  return page.evaluate((square) => {
    const b = document.querySelector('.board')!
    const rect = b.getBoundingClientRect()
    const or = b.getAttribute('data-orientation') as 'w' | 'b'
    const f = 'abcdefgh'.indexOf(square[0])
    const rank = Number(square[1])
    const x = or === 'w' ? f : 7 - f
    const y = or === 'w' ? 8 - rank : rank - 1
    return { x: rect.left + ((x + 0.5) * rect.width) / 8, y: rect.top + ((y + 0.5) * rect.height) / 8 }
  }, sq)
}

async function positionSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('.board .piece')] as HTMLElement[]
    return els
      .map((e) => `${e.dataset.square}:${(e.querySelector('img')?.src.split('/').pop() ?? '')}`)
      .sort()
      .join(',')
  })
}

/** click-move a move by its uci (clicks square centers; handles promotion) */
export async function playUci(page: Page, uci: string) {
  const prev = await positionSignature(page)
  for (let attempt = 0; ; attempt++) {
    const from = await squareCenter(page, uci.slice(0, 2))
    await page.mouse.click(from.x, from.y)
    // wait until the selection actually registered (dots) before the second click
    const selected = await page
      .waitForFunction(() => document.querySelectorAll('.board .dot').length > 0, null, { timeout: 3000 })
      .then(() => true)
      .catch(() => false)
    if (!selected) {
      if (attempt >= 4) throw new Error(`playUci: selection never registered for ${uci}`)
      continue
    }
    const to = await squareCenter(page, uci.slice(2, 4))
    await page.mouse.click(to.x, to.y)
    const outcome = await page
      .waitForFunction(
        (p) => {
          if (document.querySelector('.promo')) return 'promo'
          const els = [...document.querySelectorAll('.board .piece')] as HTMLElement[]
          const sig = els
            .map((e) => `${e.dataset.square}:${(e.querySelector('img')?.src.split('/').pop() ?? '')}`)
            .sort()
            .join(',')
          return sig !== p ? 'moved' : false
        },
        prev,
        { timeout: 8_000 },
      )
      .then((h) => h.jsonValue<string>())
      .catch(() => 'timeout')
    if (outcome === 'moved') return
    if (outcome === 'promo') {
      await page.locator(`.promo button[aria-label="Promote to ${uci[4] ?? 'q'}"]`).click()
      await waitForPositionChange(page, prev)
      return
    }
    if (attempt >= 4) throw new Error(`playUci: move ${uci} never applied`)
  }
}

async function waitForPositionChange(page: Page, prev: string, timeout = 15_000) {
  await page.waitForFunction(
    (p) => {
      const els = [...document.querySelectorAll('.board .piece')] as HTMLElement[]
      const sig = els
        .map((e) => `${e.dataset.square}:${(e.querySelector('img')?.src.split('/').pop() ?? '')}`)
        .sort()
        .join(',')
      return sig !== p
    },
    prev,
    { timeout },
  )
}

export async function playLine(page: Page, ucis: string[]) {
  for (const u of ucis) await playUci(page, u)
}

/** number of plies shown in the move list (0 if no move list on the page) */
export async function plyCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('.movelist .mv').length)
}

export async function waitForPlyCount(page: Page, min: number) {
  await page.waitForFunction((n) => document.querySelectorAll('.movelist .mv').length >= n, min, {
    timeout: 20_000,
  })
}

/**
 * Make one legal move with the side to move by selecting a piece with legal
 * targets and clicking the first target. Returns false when no move was found.
 */
export async function playRandomLegalMove(page: Page): Promise<boolean> {
  const prev = await positionSignature(page)
  const pieces = await page.evaluate(() =>
    ([...document.querySelectorAll('.board .piece')] as HTMLElement[]).map((e) => ({
      sq: e.dataset.square!,
      color: (e.querySelector('img')?.src.match(/\/([wb])[KQRBNP]\.svg$/) ?? [])[1] ?? '',
      turn: (e.closest('.board')?.getAttribute('data-orientation') ?? 'w') as string,
    })),
  )
  for (const p of pieces) {
    const c = await squareCenter(page, p.sq)
    await page.mouse.click(c.x, c.y)
    const target = await page.evaluate(() => {
      const d = document.querySelector('.board .dot') as HTMLElement | null
      if (!d) return null
      const r = d.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    if (!target) continue
    await page.mouse.click(target.x, target.y)
    const outcome = await page
      .waitForFunction(
        (sig) => {
          if (document.querySelector('.promo')) return 'promo'
          const els = [...document.querySelectorAll('.board .piece')] as HTMLElement[]
          const now = els
            .map((e) => `${e.dataset.square}:${(e.querySelector('img')?.src.split('/').pop() ?? '')}`)
            .sort()
            .join(',')
          return now !== sig ? 'moved' : false
        },
        prev,
        { timeout: 4_000 },
      )
      .then((h) => h.jsonValue<string>())
      .catch(() => 'timeout')
    if (outcome === 'promo') {
      await page.locator('.promo button[aria-label="Promote to q"]').click()
      await waitForPositionChange(page, prev, 8000)
      return true
    }
    if (outcome === 'moved') return true
  }
  return false
}

/**
 * Click a visible button whose text contains `text`, without letting
 * Playwright scroll the page. Auto-waits for late-rendered (lazy) UI.
 */
export async function clickButton(page: Page, text: string, timeout = 15_000): Promise<boolean> {
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
    if (ok) return true
    if (Date.now() > deadline) return false
    await page.waitForTimeout(150)
  }
}

/**
 * Make a legal move that does NOT match `solutionUci` (used for puzzle wrong
 * attempts). Returns false when no alternative legal move exists.
 */
export async function playWrongMove(page: Page, solutionUci: string): Promise<boolean> {
  const target = solutionUci.slice(2, 4)
  const pieces = await page.evaluate(() =>
    ([...document.querySelectorAll('.board .piece')] as HTMLElement[]).map((e) => ({
      sq: e.dataset.square!,
      color: (e.querySelector('img')?.src.match(/\/([wb])[KQRBNP]\.svg$/) ?? [])[1] ?? '',
    })),
  )
  for (const p of pieces) {
    const c = await squareCenter(page, p.sq)
    await page.mouse.click(c.x, c.y)
    const dots = await page.evaluate(() => {
      const board = document.querySelector('.board') as HTMLElement
      const rect = board.getBoundingClientRect()
      const or = board.getAttribute('data-orientation') as 'w' | 'b'
      return ([...board.querySelectorAll('.dot')] as HTMLElement[]).map((d) => {
        const r = d.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const fx = Math.round((cx - rect.left) / (rect.width / 8) - 0.5)
        const fy = Math.round((cy - rect.top) / (rect.height / 8) - 0.5)
        const file = or === 'w' ? 'abcdefgh'[fx] : 'abcdefgh'[7 - fx]
        const rank = or === 'w' ? 8 - fy : fy + 1
        return { sq: `${file}${rank}`, x: cx, y: cy }
      })
    })
    const dot = dots.find((d) => d.sq !== target)
    if (dot) {
      await page.mouse.click(dot.x, dot.y)
      return true
    }
  }
  return false
}

export async function flipBoard(page: Page) {
  const before = await page.getAttribute('.board', 'data-orientation')
  const found = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /flip/i.test(x.title || ''))
    if (!b) return false
    b.click()
    return true
  })
  expect(found).toBe(true)
  await page.waitForFunction(
    (o) => document.querySelector('.board')?.getAttribute('data-orientation') !== o,
    before,
  )
}

/* ------------------------------------------------------------------ */
/* Scroll stability                                                     */
/* ------------------------------------------------------------------ */

export interface ScrollState {
  win: number
  doc: number
  body: number
  ancestors: number[]
}

export async function scrollState(page: Page): Promise<ScrollState> {
  return page.evaluate(() => {
    const b = document.querySelector('.board')
    const ancestors: number[] = []
    let el: Element | null = b?.parentElement ?? null
    while (el) {
      ancestors.push((el as HTMLElement).scrollTop)
      el = el.parentElement
    }
    return {
      win: window.scrollY,
      doc: document.documentElement.scrollTop,
      body: document.body.scrollTop,
      ancestors,
    }
  })
}

/**
 * Scroll to a small known position (desktop game pages cannot scroll — the
 * value stays 0 there) while keeping the whole board visible: below the
 * sticky header and above the bottom tab bar, so square clicks stay valid.
 * Returns the baseline scroll state.
 */
export async function setKnownScroll(page: Page): Promise<ScrollState> {
  await page.evaluate(() => {
    const board = document.querySelector('.board')
    if (!board) {
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      window.scrollTo(0, Math.min(80, max))
      return
    }
    const header = document.querySelector('.topnav')
    const headerBottom = header && getComputedStyle(header).display !== 'none' ? header.getBoundingClientRect().bottom : 0
    const boardTop = board.getBoundingClientRect().top
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    // never scroll the board's top row under the sticky header
    const maxByHeader = Math.max(0, Math.floor(boardTop - headerBottom - 4))
    window.scrollTo(0, Math.min(80, max, maxByHeader))
  })
  return scrollState(page)
}

/**
 * Play `uci` on mover and wait until other's move list reaches `ply`,
 * asserting scroll stability on both pages. Tolerates a rare lost sync
 * (realtime/function hiccup): reload the receiver to re-sync from the
 * server; if the server never got the move, reload the mover (dropping its
 * optimistic state) and replay it. Returns possibly-refreshed baselines.
 */
export async function playSyncedMove(opts: {
  mover: Page
  other: Page
  uci: string
  ply: number
  moverBase: ScrollState
  otherBase: ScrollState
}): Promise<{ moverBase: ScrollState; otherBase: ScrollState }> {
  const { mover, other, uci, ply } = opts
  let { moverBase, otherBase } = opts

  const seePly = (p: Page, n: number, timeout: number) =>
    p
      .waitForFunction((k) => document.querySelectorAll('.movelist .mv').length >= k, n, { timeout })
      .then(() => true)
      .catch(() => false)

  await playUci(mover, uci)
  expectScrollUnchanged(await scrollState(mover), moverBase)
  if (await seePly(other, ply, 25_000)) {
    expectScrollUnchanged(await scrollState(other), otherBase)
    return { moverBase, otherBase }
  }

  // stalled — re-sync the receiver from the server
  await other.reload()
  await waitBoardSettled(other)
  otherBase = await setKnownScroll(other)
  if (await seePly(other, ply, 10_000)) {
    expectScrollUnchanged(await scrollState(other), otherBase)
    return { moverBase, otherBase }
  }

  // the server never got the move — reset the mover's optimistic state and replay
  await mover.reload()
  await waitBoardSettled(mover)
  moverBase = await setKnownScroll(mover)
  await playUci(mover, uci)
  expectScrollUnchanged(await scrollState(mover), moverBase)
  expect(await seePly(other, ply, 25_000), `move ${uci} synced after replay`).toBe(true)
  expectScrollUnchanged(await scrollState(other), otherBase)
  return { moverBase, otherBase }
}

export function expectScrollUnchanged(after: ScrollState, before: ScrollState) {
  expect(after.win).toBe(before.win)
  expect(after.doc).toBe(before.doc)
  expect(after.body).toBe(before.body)
  expect(after.ancestors).toEqual(before.ancestors)
}

/* ------------------------------------------------------------------ */
/* Misc fixtures                                                        */
/* ------------------------------------------------------------------ */

/** true when .env carries the Supabase URL + anon key (online tests need it) */
export function supabaseConfigured(): boolean {
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    return /VITE_SUPABASE_URL=\S/.test(env) && /VITE_SUPABASE_ANON_KEY=\S/.test(env)
  } catch {
    return false
  }
}

/** build a finished GameRecord for the review page (20-move line, white won) */
export function buildReviewRecord(id: string) {
  const chess = new Chess()
  const moves = LINE_20.map((uci) => {
    const m = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    })
    return { uci, san: m.san }
  })
  return {
    id,
    mode: 'passplay',
    tc: null,
    rated: false,
    startFen: new Chess().fen(),
    moves,
    result: { winner: 'w', reason: 'resign' },
    white: { name: 'Player 1', rating: 1200, avatarSeed: 'a', flag: null },
    black: { name: 'Player 2', rating: 1200, avatarSeed: 'b', flag: null },
    myColor: null,
    date: Date.now(),
  }
}

/* ------------------------------------------------------------------ */
/* Assertions: alignment / layout / eval bar                            */
/* ------------------------------------------------------------------ */

export interface AlignmentMetrics {
  maxCenterErr: number
  maxPieceSizeErr: number
  count: number
  snapped: boolean
  square: number
}

export async function alignmentMetrics(page: Page): Promise<AlignmentMetrics> {
  return page.evaluate(() => {
    const b = document.querySelector('.board')!
    const pieces = [...b.querySelectorAll('.piece')] as HTMLElement[]
    let maxCenterErr = 0
    let maxPieceSizeErr = 0
    let count = 0
    for (const p of pieces) {
      const sq = p.dataset.square!
      const sqEl = b.querySelector(`.sq[data-square="${sq}"]`)
      if (!sqEl) continue
      const pr = p.getBoundingClientRect()
      const sr = sqEl.getBoundingClientRect()
      maxCenterErr = Math.max(
        maxCenterErr,
        Math.abs(pr.left + pr.width / 2 - (sr.left + sr.width / 2)),
        Math.abs(pr.top + pr.height / 2 - (sr.top + sr.height / 2)),
      )
      const img = p.querySelector('img')
      if (img) {
        const ir = img.getBoundingClientRect()
        maxPieceSizeErr = Math.max(
          maxPieceSizeErr,
          Math.abs(ir.width - sr.width),
          Math.abs(ir.height - sr.height),
        )
      }
      count++
    }
    const r = b.getBoundingClientRect()
    const snapped =
      Math.abs(r.width / 8 - Math.round(r.width / 8)) < 0.001 &&
      Math.abs(r.height / 8 - Math.round(r.height / 8)) < 0.001 &&
      Math.abs(r.width - r.height) < 0.5
    return { maxCenterErr, maxPieceSizeErr, count, snapped, square: r.width / 8 }
  })
}

export function expectAligned(m: AlignmentMetrics) {
  expect(m.count, 'pieces measured').toBeGreaterThan(0)
  expect(m.maxCenterErr, 'piece center vs square center (px)').toBeLessThanOrEqual(0.5)
  expect(m.maxPieceSizeErr, 'piece art size vs square size (px)').toBeLessThanOrEqual(1)
  expect(m.snapped, 'board size is a whole multiple of 8 and square').toBe(true)
}

export interface LayoutState {
  boardInside: boolean
  stripsInside: boolean
  evalbarInside: boolean | null
  sideInside: boolean | null
  scrollWidth: number
  scrollHeight: number
  innerWidth: number
  innerHeight: number
  sideWidth: number
  sidenavVisible: boolean
  tabbarVisible: boolean
  boardSize: number
}

export async function layoutState(page: Page): Promise<LayoutState> {
  return page.evaluate(() => {
    const R = (sel: string) => {
      const el = document.querySelector(sel)
      return el ? el.getBoundingClientRect() : null
    }
    const inside = (r: DOMRect | null) =>
      !!r && r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1
    const de = document.documentElement
    const side = R('.game-side')
    const sidenav = document.querySelector('.sidenav')
    const tabbar = document.querySelector('.tabbar')
    return {
      boardInside: inside(R('.board')),
      stripsInside: inside(R('.player-strip.top')) && inside(R('.player-strip.bottom')),
      evalbarInside: R('.evalbar') ? inside(R('.evalbar')) : null,
      sideInside: side ? inside(side) : null,
      scrollWidth: de.scrollWidth,
      scrollHeight: de.scrollHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      sideWidth: side ? side.width : 0,
      sidenavVisible: !!sidenav && getComputedStyle(sidenav).display !== 'none',
      tabbarVisible: !!tabbar && getComputedStyle(tabbar).display !== 'none',
      boardSize: R('.board')?.width ?? 0,
    }
  })
}

export interface EvalLabelState {
  present: boolean
  fits: boolean
  barWidth: number
  labelWidth: number
  labelText: string
}

export async function evalLabelState(page: Page): Promise<EvalLabelState> {
  return page.evaluate(() => {
    const bar = document.querySelector('.evalbar')
    if (!bar) return { present: false, fits: false, barWidth: 0, labelWidth: 0, labelText: '' }
    const label = bar.querySelector('.eb-label') as HTMLElement
    const br = bar.getBoundingClientRect()
    const lr = label.getBoundingClientRect()
    const fits =
      lr.left >= br.left - 0.5 &&
      lr.right <= br.right + 0.5 &&
      lr.top >= br.top - 0.5 &&
      lr.bottom <= br.bottom + 0.5
    return {
      present: true,
      fits,
      barWidth: br.width,
      labelWidth: lr.width,
      labelText: label.textContent ?? '',
    }
  })
}
