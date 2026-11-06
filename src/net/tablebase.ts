/**
 * Seven-piece endgame tablebase lookups via the public lichess
 * tablebase service. Best effort: any network or coverage failure
 * returns null and the analysis page simply shows nothing extra.
 */

export interface TablebaseMove {
  uci: string
  san: string
  category: string
}

export interface TablebaseResult {
  /** outcome for the side to move: win, draw, loss (plus cursed/blessed variants) */
  category: string
  dtm: number | null
  moves: TablebaseMove[]
}

const cache = new Map<string, TablebaseResult | null>()

export function pieceCount(fen: string): number {
  const placement = fen.split(' ')[0] ?? ''
  let n = 0
  for (const ch of placement) if (/[pnbrqkPNBRQK]/.test(ch)) n++
  return n
}

export async function fetchTablebase(fen: string): Promise<TablebaseResult | null> {
  if (pieceCount(fen) > 7) return null
  const hit = cache.get(fen)
  if (hit !== undefined) return hit
  try {
    const res = await fetch(`https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`)
    if (!res.ok) {
      cache.set(fen, null)
      return null
    }
    const data = (await res.json()) as {
      category?: string
      dtm?: number | null
      moves?: { uci: string; san: string; category: string }[]
    }
    if (!data.category) {
      cache.set(fen, null)
      return null
    }
    const out: TablebaseResult = {
      category: data.category,
      dtm: data.dtm ?? null,
      moves: (data.moves ?? []).slice(0, 4).map((m) => ({ uci: m.uci, san: m.san, category: m.category })),
    }
    cache.set(fen, out)
    return out
  } catch {
    return null
  }
}

export function tablebaseSummary(fen: string, tb: TablebaseResult): string {
  const side = fen.split(' ')[1] === 'b' ? 'Black' : 'White'
  const opp = side === 'White' ? 'Black' : 'White'
  switch (tb.category) {
    case 'win':
    case 'maybe-win':
      return `${side} wins with perfect play${tb.dtm ? ` (mate in ${Math.ceil(Math.abs(tb.dtm) / 2)} or faster)` : ''}.`
    case 'loss':
    case 'maybe-loss':
      return `${side} is lost with perfect play; ${opp} mates${tb.dtm ? ` in ${Math.ceil(Math.abs(tb.dtm) / 2)}` : ''}.`
    default:
      return 'Drawn with perfect play.'
  }
}
