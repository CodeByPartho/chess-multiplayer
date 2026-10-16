/**
 * Playwright global setup — runs once, before any test.
 *
 * 1. Hard guard: refuse to start unless a dedicated TEST backend is configured
 *    and it is not the production project (see ./test-backend.ts).
 * 2. Sanity-check that the test backend answers.
 * 3. Seed the static puzzle library (reference data — the same JSON the client
 *    ships), so a fresh test project supports the puzzle flows. Idempotent.
 * 4. Drop a run marker (timestamp) that the teardown uses to delete only the
 *    rows this run created.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'pg'
import { assertTestBackend, testProjectRef, type TestBackend } from './test-backend'

/** Marker written by setup and read by teardown. */
export const RUN_MARKER_PATH = join(tmpdir(), 'fc-e2e-run.json')

/** The puzzle library the app imports — also the source of `public.puzzles`. */
const PUZZLE_LIBRARY_URL = new URL('../src/assets/puzzles/puzzles.json', import.meta.url)

export interface RunMarker {
  startedAt: string
  supabaseUrl: string
  projectRef: string
  cleanup: 'sql' | 'rest'
}

async function assertBackendReachable(backend: TestBackend): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    // A real table read (the root /rest/v1/ endpoint is service-role only since
    // the PostgREST v12+ hardening).
    const res = await fetch(`${backend.supabaseUrl}/rest/v1/puzzles?select=id&limit=1`, {
      headers: { apikey: backend.anonKey, Authorization: `Bearer ${backend.anonKey}` },
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) {
      throw new Error(`test backend rejected the anon key (HTTP ${res.status})`)
    }
    if (res.status >= 500) {
      throw new Error(`test backend returned HTTP ${res.status} for a table read`)
    }
    if (!res.ok) {
      throw new Error(`test backend returned HTTP ${res.status} for a table read`)
    }
  } finally {
    clearTimeout(timer)
  }
}

function puzzleRows(): Array<{ id: string; rating: number }> {
  const raw = JSON.parse(readFileSync(PUZZLE_LIBRARY_URL, 'utf8')) as
    | Array<{ id: string; rating: number }>
    | Record<string, { id: string; rating: number }>
  const list = Array.isArray(raw) ? raw : Object.values(raw)
  return list.map((p) => ({ id: p.id, rating: p.rating }))
}

/** Insert/refresh `public.puzzles` in the test backend (idempotent). */
async function seedPuzzleLibrary(backend: TestBackend): Promise<number> {
  const rows = puzzleRows()
  if (rows.length === 0) return 0

  if (backend.dbUrl) {
    const client = new Client({ connectionString: backend.dbUrl, connectionTimeoutMillis: 30_000 })
    await client.connect()
    try {
      await client.query(
        `insert into public.puzzles (id, rating)
         select * from unnest($1::text[], $2::int[])
         on conflict (id) do update set rating = excluded.rating`,
        [rows.map((r) => r.id), rows.map((r) => r.rating)],
      )
    } finally {
      await client.end().catch(() => {})
    }
    return rows.length
  }

  if (backend.serviceKey) {
    const res = await fetch(`${backend.supabaseUrl}/rest/v1/puzzles`, {
      method: 'POST',
      headers: {
        apikey: backend.serviceKey,
        Authorization: `Bearer ${backend.serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    })
    if (!res.ok) throw new Error(`seeding puzzles failed (HTTP ${res.status})`)
    return rows.length
  }

  return 0
}

export default async function globalSetup(): Promise<void> {
  const backend = assertTestBackend()
  const ref = testProjectRef(backend)

  if (existsSync(RUN_MARKER_PATH)) rmSync(RUN_MARKER_PATH)

  await assertBackendReachable(backend).catch((err: unknown) => {
    throw new Error(
      `\n  ✖ E2E test backend ${backend.supabaseUrl} is not reachable: ${(err as Error).message}\n` +
        '    Check the project is active (free projects pause after inactivity) and the URL/key are correct.\n',
    )
  })

  const seeded = await seedPuzzleLibrary(backend)

  mkdirSync(tmpdir(), { recursive: true })
  const marker: RunMarker = {
    startedAt: new Date().toISOString(),
    supabaseUrl: backend.supabaseUrl,
    projectRef: ref,
    cleanup: backend.dbUrl ? 'sql' : 'rest',
  }
  writeFileSync(RUN_MARKER_PATH, JSON.stringify(marker, null, 2))

  console.log(
    `[e2e] backend: ${backend.supabaseUrl} (ref ${ref}, ${backend.source}); ` +
      `puzzles seeded: ${seeded}; cleanup: ${marker.cleanup}; run started ${marker.startedAt}`,
  )
}
