// Glicko-2 (Mark Glickman's specification) — server-side port used for
// rated online games. Same math as the client implementation.
export interface GlickoPlayer {
  rating: number
  rd: number
  vol: number
  updatedAt: number
}

const SCALE = 173.7178
const toInternal = (r: number) => (r - 1500) / SCALE
const toDisplay = (mu: number) => mu * SCALE + 1500

// Glicko-2 constants: φ(350) is the default (unrated) deviation and TAU
// bounds how much the volatility may move in a single rating period. Without
// the TAU clamp the Newton step is unconstrained and a single game can drive
// volatility into the tens, which then detonates the rating on the next game.
const PHI_LIMIT = 350 / SCALE
const TAU = 0.5
const MIN_VOL = 0.01
const MAX_VOL = 0.5

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
}

function E(mu: number, muj: number, phij: number): number {
  return 1 / (1 + Math.exp(-g(phij) * (mu - muj)))
}

function fVol(x: number, delta: number, phi: number, vol: number, a: number): number {
  const ex = Math.exp(x)
  const num = ex * (delta * delta - phi * phi - vol * vol - ex)
  const den = 2 * (phi * phi + vol * vol + ex) ** 2
  return num / den - (x - a) / (vol * vol)
}

export interface Result {
  oppRating: number
  oppRd: number
  /** 1 win, 0.5 draw, 0 loss */
  score: number
  elapsedMs: number
}

export function updateGlicko(player: GlickoPlayer, results: Result[]): GlickoPlayer {
  if (results.length === 0) return { ...player }

  const mu = toInternal(player.rating)
  let phi = player.rd / SCALE
  const sigma = Math.max(0.02, Math.min(0.1, player.vol || 0.06))

  const years = Math.min(4, results[0].elapsedMs / (365.25 * 24 * 3600 * 1000))
  phi = Math.min(Math.sqrt(phi * phi + years * 0.0655 ** 2), 350 / SCALE)

  const opps = results.map((r) => ({
    muj: toInternal(r.oppRating),
    phij: Math.max(0.05, r.oppRd / SCALE),
    s: r.score,
  }))

  const vInv = opps.reduce((acc, o) => acc + g(o.phij) ** 2 * E(mu, o.muj, o.phij) * (1 - E(mu, o.muj, o.phij)), 0)
  const v = 1 / vInv
  const deltaPrime = v * opps.reduce((acc, o) => acc + g(o.phij) * (o.s - E(mu, o.muj, o.phij)), 0)

  const a = Math.log(sigma * sigma)
  const delta2 = deltaPrime / phi
  const deltaSquared = delta2 * delta2

  let lo: number
  let hi: number
  if (deltaSquared > phi * phi + sigma * sigma) {
    lo = a
    hi = Math.log(deltaSquared - phi * phi - sigma * sigma)
  } else {
    lo = a
    hi = a
  }
  for (let i = 0; i < 100 && hi - lo > 1e-10; i++) {
    const mid = (lo + hi) / 2
    if (fVol(mid, deltaPrime, phi, sigma, a) < 0) lo = mid
    else hi = mid
  }
  // |ln σ′ − ln σ| ≤ τ  (Glicko-2 volatility constraint)
  const rawVol = Math.exp((lo + hi) / 2)
  const lnVol = Math.min(Math.max(a, Math.log(rawVol)), a + TAU * TAU)
  const newVol = Math.min(MAX_VOL, Math.max(MIN_VOL, Math.exp(lnVol)))

  const phiStar = Math.sqrt(phi * phi + newVol * newVol)
  const newPhi = Math.min(PHI_LIMIT, 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v))
  const newMu = mu + newPhi * newPhi * opps.reduce((acc, o) => acc + g(o.phij) * (o.s - E(mu, o.muj, o.phij)), 0)

  return {
    rating: Math.round(toDisplay(newMu)),
    rd: Math.round(newPhi * SCALE),
    vol: newVol,
    updatedAt: player.updatedAt + results[0].elapsedMs,
  }
}
