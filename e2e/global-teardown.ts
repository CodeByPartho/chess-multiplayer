/**
 * Playwright global teardown — deletes everything this e2e run created in the
 * TEST backend: users, guests, games, lobby rows, rating/rating_history rows,
 * puzzle results, profiles and reports.
 *
 * Two strategies:
 *   sql   FC_TEST_DB_URL is set        → one transaction, exact counts (preferred)
 *   rest  FC_TEST_SERVICE_KEY is set   → REST/admin API fallback
 *
 * Scope is deliberately narrow so the teardown is safe even if the test
 * project later holds hand-made data:
 *   • users: created after the run marker, or anonymous, or `fc-e2e-*` emails
 *   • games / lobby / reports: created after the marker, or involving those users
 * Everything else cascades from the user rows.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { Client } from 'pg'
import { TEST_BACKEND, testProjectRef } from './test-backend'
import { RUN_MARKER_PATH, type RunMarker } from './global-setup'

const TEST_EMAIL_PREFIX = 'fc-e2e-'

interface Counts {
  [table: string]: number
}

function readMarker(): RunMarker | null {
  if (!existsSync(RUN_MARKER_PATH)) return null
  try {
    return JSON.parse(readFileSync(RUN_MARKER_PATH, 'utf8')) as RunMarker
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* SQL strategy                                                         */
/* ------------------------------------------------------------------ */

async function cleanupWithSql(marker: RunMarker): Promise<Counts> {
  const client = new Client({ connectionString: TEST_BACKEND.dbUrl, connectionTimeoutMillis: 30_000 })
  await client.connect()
  const counts: Counts = {}
  try {
    await client.query('begin')

    const users = await client.query<{ id: string }>(
      `select id from auth.users
        where created_at >= $1::timestamptz
           or is_anonymous
           or coalesce(email, '') like $2`,
      [marker.startedAt, `${TEST_EMAIL_PREFIX}%`],
    )
    const ids = users.rows.map((row) => row.id)

    // Each statement gets exactly the parameters it uses: Postgres cannot infer
    // the type of a placeholder the statement never references.
    const deletes: Array<{ table: string; sql: string; params: unknown[] }> = [
      {
        table: 'reports',
        sql: `delete from public.reports
               where created_at >= $1::timestamptz
                  or reporter_id = any($2::uuid[])
                  or reported_id = any($2::uuid[])`,
        params: [marker.startedAt, ids],
      },
      {
        table: 'games',
        sql: `delete from public.games
               where created_at >= $1::timestamptz
                  or white_id = any($2::uuid[])
                  or black_id = any($2::uuid[])`,
        params: [marker.startedAt, ids],
      },
      {
        table: 'lobby',
        sql: `delete from public.lobby
               where created_at >= $1::timestamptz
                  or guest_id = any($2::uuid[])`,
        params: [marker.startedAt, ids],
      },
      {
        table: 'rating_history',
        sql: `delete from public.rating_history
               where user_id = any($1::uuid[]) or opponent_id = any($1::uuid[])`,
        params: [ids],
      },
      {
        table: 'puzzle_results',
        sql: `delete from public.puzzle_results where user_id = any($1::uuid[])`,
        params: [ids],
      },
      { table: 'ratings', sql: `delete from public.ratings where user_id = any($1::uuid[])`, params: [ids] },
      { table: 'profiles', sql: `delete from public.profiles where id = any($1::uuid[])`, params: [ids] },
      { table: 'guests', sql: `delete from public.guests where id = any($1::uuid[])`, params: [ids] },
      { table: 'auth.users', sql: `delete from auth.users where id = any($1::uuid[])`, params: [ids] },
    ]

    for (const { table, sql, params } of deletes) {
      const result = await client.query(sql, params)
      counts[table] = result.rowCount ?? 0
    }

    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    await client.end().catch(() => {})
  }
  return counts
}

/* ------------------------------------------------------------------ */
/* REST strategy (service_role key)                                     */
/* ------------------------------------------------------------------ */

function adminHeaders(): Record<string, string> {
  return {
    apikey: TEST_BACKEND.serviceKey,
    Authorization: `Bearer ${TEST_BACKEND.serviceKey}`,
    'Content-Type': 'application/json',
  }
}

async function restDelete(table: string, filter: string): Promise<number> {
  const url = `${TEST_BACKEND.supabaseUrl}/rest/v1/${table}?${filter}`
  const res = await fetch(url, { method: 'DELETE', headers: { ...adminHeaders(), Prefer: 'return=representation' } })
  if (!res.ok) {
    throw new Error(`teardown: DELETE ${table} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`)
  }
  const rows = (await res.json()) as unknown[]
  return Array.isArray(rows) ? rows.length : 0
}

function inList(column: string, ids: string[]): string {
  return `${column}=in.(${ids.join(',')})`
}

async function cleanupWithRest(marker: RunMarker): Promise<Counts> {
  const counts: Counts = {}

  // users created by this run (or by earlier interrupted runs)
  const listed = await fetch(`${TEST_BACKEND.supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: adminHeaders(),
  })
  if (!listed.ok) {
    throw new Error(`teardown: listing users failed (HTTP ${listed.status})`)
  }
  const payload = (await listed.json()) as { users?: Array<Record<string, unknown>> }
  const doomed = (payload.users ?? []).filter((user) => {
    const created = String(user.created_at ?? '')
    const email = String(user.email ?? '')
    return created >= marker.startedAt || user.is_anonymous === true || email.startsWith(TEST_EMAIL_PREFIX)
  })
  const ids = doomed.map((user) => String(user.id))

  const sinceOrUsers = (userCols: string[]) =>
    [`created_at=gte.${marker.startedAt}`, ...userCols.map((col) => inList(col, ids))].join(',')

  counts.reports = ids.length ? await restDelete('reports', `or=(reporter_id.in.(${ids.join(',')}),reported_id.in.(${ids.join(',')}))`) : 0
  counts.games = await restDelete('games', `or=(${sinceOrUsers(['white_id', 'black_id'])})`)
  counts['rating_history'] = ids.length ? await restDelete('rating_history', `or=(${inList('user_id', ids)},${inList('opponent_id', ids)})`) : 0
  counts.puzzle_results = ids.length ? await restDelete('puzzle_results', inList('user_id', ids)) : 0
  counts.ratings = ids.length ? await restDelete('ratings', inList('user_id', ids)) : 0
  counts.lobby = await restDelete('lobby', `or=(${sinceOrUsers(['guest_id'])})`)
  counts.profiles = ids.length ? await restDelete('profiles', inList('id', ids)) : 0
  counts.guests = ids.length ? await restDelete('guests', inList('id', ids)) : 0

  let deletedUsers = 0
  for (const id of ids) {
    const res = await fetch(`${TEST_BACKEND.supabaseUrl}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    })
    if (!res.ok) {
      throw new Error(`teardown: deleting user ${id} failed (HTTP ${res.status})`)
    }
    deletedUsers += 1
  }
  counts['auth.users'] = deletedUsers

  return counts
}

/* ------------------------------------------------------------------ */

export default async function globalTeardown(): Promise<void> {
  const marker = readMarker()
  if (!marker) {
    console.warn('[e2e] no run marker found — skipping test-backend cleanup')
    return
  }

  const ref = testProjectRef()
  if (ref !== marker.projectRef || TEST_BACKEND.supabaseUrl !== marker.supabaseUrl) {
    // The backend changed between setup and teardown: never delete against a
    // backend the marker does not describe.
    throw new Error(
      `[e2e] refusing cleanup: marker describes ${marker.supabaseUrl} but the run targets ${TEST_BACKEND.supabaseUrl}`,
    )
  }

  const counts =
    marker.cleanup === 'sql' ? await cleanupWithSql(marker) : await cleanupWithRest(marker)

  const summary = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([table, n]) => `${table}=${n}`)
    .join(' ')

  console.log(`[e2e] cleaned test backend ${marker.projectRef}: ${summary || 'nothing to delete'}`)
  rmSync(RUN_MARKER_PATH, { force: true })
}
