/**
 * Curated historical chess portraits. Every file is public domain or CC0
 * (per-file provenance in CREDITS.md next to this file) and ships with the
 * app — no runtime request leaves the browser. A profile picks one by
 * storing a seed of the form `hist:<id>`, which rides the same avatar_seed
 * channel as the generated identicons: guests keep it locally, online
 * opponents see it through the players data, and finished-game records
 * carry it along.
 */

export interface HistoricalAvatar {
  id: string
  name: string
  years: string
}

// every *.jpg in this folder is bundled; the file name equals the id below
const files = import.meta.glob('./*.jpg', { eager: true, import: 'default' }) as Record<string, string>

export const HISTORICAL_AVATARS: HistoricalAvatar[] = [
  { id: 'morphy', name: 'Paul Morphy', years: '1837–1884' },
  { id: 'anderssen', name: 'Adolf Anderssen', years: '1818–1879' },
  { id: 'chigorin', name: 'Mikhail Chigorin', years: '1850–1908' },
  { id: 'steinitz', name: 'Wilhelm Steinitz', years: '1836–1900' },
  { id: 'zukertort', name: 'Johannes Zukertort', years: '1842–1888' },
  { id: 'pillsbury', name: 'Harry Pillsbury', years: '1872–1906' },
  { id: 'lasker', name: 'Emanuel Lasker', years: '1868–1941' },
  { id: 'tarrasch', name: 'Siegbert Tarrasch', years: '1862–1934' },
  { id: 'marshall', name: 'Frank Marshall', years: '1877–1944' },
  { id: 'rubinstein', name: 'Akiba Rubinstein', years: '1880–1961' },
  { id: 'nimzowitsch', name: 'Aron Nimzowitsch', years: '1886–1935' },
  { id: 'capablanca', name: 'José Raúl Capablanca', years: '1888–1942' },
  { id: 'reti', name: 'Richard Réti', years: '1889–1929' },
  { id: 'alekhine', name: 'Alexander Alekhine', years: '1892–1946' },
  { id: 'euwe', name: 'Max Euwe', years: '1901–1981' },
  { id: 'menchik', name: 'Vera Menchik', years: '1906–1944' },
  { id: 'botvinnik', name: 'Mikhail Botvinnik', years: '1911–1995' },
  { id: 'reshevsky', name: 'Samuel Reshevsky', years: '1911–1992' },
  { id: 'keres', name: 'Paul Keres', years: '1916–1975' },
  { id: 'smyslov', name: 'Vasily Smyslov', years: '1921–2010' },
  { id: 'bronstein', name: 'David Bronstein', years: '1924–2006' },
  { id: 'petrosian', name: 'Tigran Petrosian', years: '1929–1984' },
  { id: 'tal', name: 'Mikhail Tal', years: '1936–1992' },
  { id: 'spassky', name: 'Boris Spassky', years: '1937–' },
  { id: 'fischer', name: 'Robert J. Fischer', years: '1943–2008' },
]

/** bundled portrait URL for an id, or null when the id is unknown */
export function historicalAvatarUrl(id: string): string | null {
  return files[`./${id}.jpg`] ?? null
}
