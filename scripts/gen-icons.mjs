/**
 * Writes the FreeChess app icon (public/icons/icon.svg).
 *
 * The mark is the cburnett white knight (the same piece set the board uses)
 * on a charcoal tile with the brand lime as a base bar. It is a vector file,
 * drawn once and committed; this script exists so `prebuild` keeps it in
 * place instead of regenerating the old pixel-art icon it replaces.
 *
 * The PNG icons (icon-192.png, icon-512.png) are rendered from this SVG and
 * committed as static files; re-render them with a browser if the SVG ever
 * changes. This script never touches them.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">
  <rect width="64" height="64" rx="14" fill="#161715"/>
  <g transform="translate(7 4) scale(1.111)" fill="none" fill-rule="evenodd" stroke="#0b0c0b" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
    <path fill="#f4f4ef" d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21"/>
    <path fill="#f4f4ef" d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3"/>
    <path fill="#0b0c0b" stroke="none" d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.433-9.75a.5 1.5 30 1 1-.866-.5.5 1.5 30 1 1 .866.5"/>
  </g>
  <rect x="20" y="56" width="24" height="3" rx="1.5" fill="#aef135"/>
</svg>`

writeFileSync(join(outDir, 'icon.svg'), SVG + '\n')
console.log('icon.svg written')
