import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Single-threaded lite build: ~1.8 MB, no SharedArrayBuffer headers required.
const build = 'stockfish-19-lite-single'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'stockfish', 'bin')
const dest = join(root, 'public', 'engine')

mkdirSync(dest, { recursive: true })
for (const ext of ['js', 'wasm']) {
  copyFileSync(join(src, `${build}.${ext}`), join(dest, `${build}.${ext}`))
}
console.log(`Stockfish ${build} synced to public/engine/`)
