#!/usr/bin/env node
// Validates src/assets/openings/openings.json:
//  - every entry replays legally from the standard start position (chess.js)
//  - ECO codes match /^[A-E][0-9]{2}$/
//  - no duplicate (eco, name) pairs
//  - no duplicate sans arrays
// Prints pass/fail per entry plus summary counts, exits 1 on any failure.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Chess } from 'chess.js'

const here = dirname(fileURLToPath(import.meta.url))
const jsonPath = join(here, '..', 'src', 'assets', 'openings', 'openings.json')

let entries
try {
  entries = JSON.parse(readFileSync(jsonPath, 'utf8'))
} catch (err) {
  console.error(`FAIL: could not read/parse ${jsonPath}: ${err.message}`)
  process.exit(1)
}

if (!Array.isArray(entries) || entries.length === 0) {
  console.error('FAIL: openings.json must be a non-empty array')
  process.exit(1)
}

const ECO_RE = /^[A-E][0-9]{2}$/
let failures = 0
const seenKey = new Set()
const seenSans = new Set()
const coverage = { A: new Set(), B: new Set(), C: new Set(), D: new Set(), E: new Set() }

entries.forEach((entry, i) => {
  const problems = []
  const label = () => `${entry?.eco ?? '?'} ${entry?.name ?? '(no name)'}`

  if (typeof entry !== 'object' || entry === null) {
    console.log(`FAIL [${i}] entry is not an object: ${JSON.stringify(entry)}`)
    failures++
    return
  }
  if (typeof entry.eco !== 'string' || !ECO_RE.test(entry.eco)) {
    problems.push(`invalid ECO code ${JSON.stringify(entry.eco)}`)
  }
  if (typeof entry.name !== 'string' || entry.name.trim() === '') {
    problems.push('missing name')
  }
  if (!Array.isArray(entry.sans) || entry.sans.length === 0) {
    problems.push('sans must be a non-empty array')
  } else if (!entry.sans.every((s) => typeof s === 'string' && s.length > 0)) {
    problems.push('sans must contain only non-empty strings')
  } else {
    const chess = new Chess()
    for (const san of entry.sans) {
      let move = null
      try {
        move = chess.move(san)
      } catch {
        // chess.js throws on illegal moves; handled below
      }
      if (!move) {
        problems.push(`illegal move ${JSON.stringify(san)} after ${entry.sans.slice(0, entry.sans.indexOf(san)).join(' ')}`)
        break
      }
    }
    const key = `${entry.eco}|${entry.name}`
    if (seenKey.has(key)) problems.push(`duplicate (eco, name) ${key}`)
    seenKey.add(key)
    const sig = entry.sans.join(' ')
    if (seenSans.has(sig)) problems.push(`duplicate sans array: ${sig}`)
    seenSans.add(sig)
    if (ECO_RE.test(entry.eco)) coverage[entry.eco[0]].add(entry.eco)
  }

  if (problems.length) {
    failures++
    console.log(`FAIL [${i}] ${label()}`)
    for (const p of problems) console.log(`       - ${p}`)
  } else {
    console.log(`PASS [${i}] ${label()} (${entry.sans.length} plies)`)
  }
})

console.log('')
console.log(`Entries: ${entries.length}`)
for (const letter of ['A', 'B', 'C', 'D', 'E']) {
  const codes = [...coverage[letter]].sort()
  console.log(`${letter}: ${codes.length} codes (${codes[0] ?? '-'}–${codes[codes.length - 1] ?? '-'})`)
}

if (failures > 0) {
  console.error(`\n${failures} entr${failures === 1 ? 'y' : 'ies'} FAILED`)
  process.exit(1)
}
console.log('\nAll entries passed.')
