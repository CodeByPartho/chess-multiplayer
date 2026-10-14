/**
 * Generates original PWA icons (PNG128/512) from a hand-authored pixel-art
 * knight matrix — zero dependencies (node:zlib for deflate + manual CRC32).
 * Deterministic; run via prebuild: node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

// ---- original pixel art: a knight silhouette on a rounded dark tile ----
//32x32 grid: '.' empty, '#' knight, 'o' outline/shadow accent
const ART = `
................................
..............####..............
.............####...............
............######..............
...........########.............
..........##########............
.........####.#######...........
........#####..#######..........
.......######...######..........
......########..#######.........
.....############..####.........
.....###########..####..........
.....##########...####..........
......########...#####..........
......#######....######.........
.......#####.....######.........
.......####......######.........
......#####......######.........
.....######......######.........
.....#####.......#####..........
.....####........####...........
.....###..........###...........
....#####........#####..........
....#######....#######..........
....##################..........
....##################..........
.....##############.............
......############..............
.......##########...............
........########................
................................
................................
`.trim().split('\n')

// palette: transparent bg, tile color, knight color, accent
const PALETTE = {
  '.': null,
  '#': [236, 214, 160], // ivory knight
  o: [236, 214, 160],
}
const TILE = [46, 42, 36]

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function renderPng(size) {
  const scale = size / 32
  const raw = Buffer.alloc((size * 4 + 1) * size)
  let off = 0
  for (let y = 0; y < size; y++) {
    raw[off++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const sx = Math.floor(x / scale)
      const sy = Math.floor(y / scale)
      const ch = ART[sy]?.[sx] ?? '.'
      // rounded-corner tile mask
      const r = 4 * scale
      const corner = (() => {
        const dx = x < r ? r - x : x > size - r ? x - (size - r) : 0
        const dy = y < r ? r - y : y > size - r ? y - (size - r) : 0
        return dx * dx + dy * dy > r * r
      })()
      let rgba = ch === '.' || corner ? [0, 0, 0, 0] : [...TILE, 255]
      if (ch === '#' || ch === 'o') rgba = [...PALETTE[ch], 255]
      raw[off++] = rgba[0]
      raw[off++] = rgba[1]
      raw[off++] = rgba[2]
      raw[off++] = rgba[3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return png
}

for (const s of [192, 512]) {
  writeFileSync(join(outDir, `icon-${s}.png`), renderPng(s))
}

// original SVG icon (maskable-friendly square)
const cell = 1
let rects = ''
ART.forEach((row, y) => {
  ;[...row].forEach((ch, x) => {
    if (ch === '#') rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="#ece6a0"/>`
  })
})
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="512" height="512">
<rect width="32" height="32" rx="5" fill="#2e2a24"/>
${rects}
</svg>
`
writeFileSync(join(outDir, 'icon.svg'), svg)
console.log('icons: icon-192.png, icon-512.png, icon.svg')
