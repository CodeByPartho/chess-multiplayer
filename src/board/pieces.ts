import setsJson from '@/assets/pieces/sets.json'

export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p'
export type PieceColor = 'w' | 'b'

export interface PieceSetInfo {
  id: string
  name: string
  license: string
  author?: string
  sourceUrl?: string
  note?: string
}

export const pieceSets: PieceSetInfo[] = (setsJson as { sets?: PieceSetInfo[] }).sets ?? (setsJson as PieceSetInfo[])

// eager-load every piece SVG as a URL
const files = import.meta.glob('/src/assets/pieces/*/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const urlIndex: Record<string, string> = {}
for (const [path, url] of Object.entries(files)) {
  // /src/assets/pieces/<set>/<color><Type>.svg
  const m = path.match(/pieces\/([^/]+)\/([wb])([KQRBNP])\.svg$/)
  if (m) urlIndex[`${m[1]}/${m[2]}${m[3]}`] = url
}

export function pieceUrl(setId: string, color: PieceColor, type: PieceType): string {
  const key = `${setId}/${color}${type.toUpperCase()}`
  return urlIndex[key] ?? urlIndex[`cburnett/${color}${type.toUpperCase()}`] ?? ''
}

/** default black/white sample for previews */
export function setPreviewUrls(setId: string): string[] {
  return ['w', 'b'].map((c) => pieceUrl(setId, c as PieceColor, 'n'))
}
