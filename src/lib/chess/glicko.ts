/**
 * Glicko-2 rating system (full algorithm, Mark Glickman's specification).
 * Ratings are stored per guest per pool (bullet/blitz/rapid/classical/puzzle).
 */

export interface GlickoPlayer {
  /** Glicko-2 rating (mu),1500 = default */
  rating: number
  /** rating deviation (phi),350 = default (unrated) */
  rd: number
  /** volatility (sigma),0.06 = default */
  vol: number
  /** timestamp of last rating update (ms) */
  updatedAt: number
}

export const TAU = 0.5
export const DEFAULT_PLAYER: Omit<GlickoPlayer, 'updatedAt'> = { rating: 1500, rd: 350, vol: 0.06 }

const GLICKO2_SCALE = 173.7178
const toInternal = (r: number) => (r - 1500) / GLICKO2_SCALE
const toDisplay = (mu: number) => mu * GLICKO2_SCALE + 1500

// φ(350) is the default (unrated) deviation; volatility is bounded to keep a
// single game from detonating the rating on the next one.
const PHI_LIMIT = 350 / GLICKO2_SCALE
const MIN_VOL = 0.01
const MAX_VOL = 0.5

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
}

function E(mu: number, muj: number, phij: number): number {
  return 1 / (1 + Math.exp(-g(phij) * (mu - muj)))
}

function f(x: number, delta: number, phi: number, vol: number, a: number): number {
  const ex = Math.exp(x)
  const num = ex * (delta * delta - phi * phi - vol * vol - ex)
  const den = 2 * (phi * phi + vol * vol + ex) ** 2
  return num / den - (x - a) / (vol * vol)
}

export interface Result {
  /** rating of the opponent (display scale) */
  oppRating: number
  oppRd: number
  /**1 win,0.5 draw,0 loss */
  score: number
  /** time since the player's last update (ms) */
  elapsedMs: number
}

/**
 * Update a player from a set of results in one rating period.
 * Returns the new player. Opponents are treated as fixed (their own updates
 * are computed symmetrically by the caller with swapped roles).
 */
export function updateGlicko(player: GlickoPlayer, results: Result[]): GlickoPlayer {
  if (results.length === 0) return { ...player }

  const mu = toInternal(player.rating)
  let phi = player.rd / GLICKO2_SCALE
  // clamp inputs defensively: a rating record persisted before the tau/RD
  // fix can carry out-of-range vol (e.g. 45.9) or rd (>350). Feeding those
  // raw into the Newton step (ln of a huge sigma) detonates the bracket.
  const sigma = Math.max(0.02, Math.min(0.1, player.vol || 0.06))

  // cap rd growth for long inactivity at the default350 (phi <=2)
  const years = Math.min(4, results[0].elapsedMs / (365.25 * 24 * 3600 * 1000))
  phi = Math.min(Math.sqrt(phi * phi + years * 0.0655 ** 2), 350 / GLICKO2_SCALE)

  const opps = results.map((r) => ({
    muj: toInternal(r.oppRating),
    phij: r.oppRd / GLICKO2_SCALE,
    s: r.score,
  }))

  const vInv = opps.reduce((acc, o) => acc + g(o.phij) ** 2 * E(mu, o.muj, o.phij) * (1 - E(mu, o.muj, o.phij)), 0)
  const v = 1 / vInv
  const deltaPrime =
    (v * opps.reduce((acc, o) => acc + g(o.phij) * (o.s - E(mu, o.muj, o.phij)), 0))

  // volatility iteration (Illinois algorithm, bracket + bisect)
  const a = Math.log(sigma * sigma)
  const delta2 = deltaPrime / phi
  const deltaSquared = delta2 * delta2
  const fVol = (x: number) => f(x, deltaPrime, phi, sigma, a)

  let lo: number
  let hi: number
  if (deltaSquared > phi * phi + sigma * sigma) {
    lo = a
    hi = Math.log(deltaSquared - phi * phi - sigma * sigma)
  } else {
    // per the Glicko-2 spec: when Δ'² ≤ φ² + σ² the bracket collapses to a
    // and the volatility stays essentially unchanged
    lo = a
    hi = a
  }
  for (let i = 0; i < 100 && hi - lo > 1e-10; i++) {
    const mid = (lo + hi) / 2
    if (fVol(mid) < 0) lo = mid
    else hi = mid
  }
  // Glicko-2 volatility constraint: |ln σ′ − ln σ| ≤ τ (paper step 5). Without
  // this the Newton step is unconstrained and a single game can drive volatility
  // into the tens, which detonates the rating on the following game.
  const rawVol = Math.exp((lo + hi) / 2)
  const lnVol = Math.min(Math.max(a, Math.log(rawVol)), a + TAU * TAU)
  const newVol = Math.min(MAX_VOL, Math.max(MIN_VOL, Math.exp(lnVol)))

  const phiStar = Math.sqrt(phi * phi + newVol * newVol)
  const newPhi = Math.min(PHI_LIMIT, 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v))
  const newMu = mu + newPhi * newPhi * opps.reduce((acc, o) => acc + g(o.phij) * (o.s - E(mu, o.muj, o.phij)), 0)

  return {
    rating: Math.round(toDisplay(newMu)),
    rd: Math.round(newPhi * GLICKO2_SCALE),
    vol: newVol,
    updatedAt: player.updatedAt + results[0].elapsedMs,
  }
}

/** Expected score for the player against an opponent (display scale). */
export function expectedScore(player: GlickoPlayer, opp: Pick<GlickoPlayer, 'rating' | 'rd'>): number {
  const mu = toInternal(player.rating)
  const muj = toInternal(opp.rating)
  const phij = opp.rd / GLICKO2_SCALE
  return E(mu, muj, phij)
}
