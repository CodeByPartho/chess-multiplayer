/**
 * Server-integration tests: the SQL rating stack against a TEST database.
 *
 *   * Function inventory — the public schema contains exactly the expected
 *     functions (the 0011 diagnostic probe must be gone; the 0017 hidden
 *     autopilot RPC is expected), every function has a pinned search_path,
 *     and nothing is executable by anon or PUBLIC.
 *   * Glicko-2 parity — glicko200_update() must produce the same numbers
 *     as the shared TypeScript implementation the client previews with.
 *   * Idempotent finalization — a game is rated exactly once, ever.
 *   * Anti-abuse — < 2 moves each ⇒ no rating change; 4 rated games vs the
 *     same opponent in 24h ⇒ the next game is forced casual.
 *   * Account rules — reserved names, case-insensitive uniqueness, rate
 *     limit, leaderboard eligibility (accounts only, never provisional),
 *     account deletion with anonymized game archives.
 *   * Write paths — client roles can never write ratings/history/results
 *     directly (REVOKE + RLS), and the leaderboard RPC is signed-in-only.
 *   * Puzzle ratings — the RPC takes no rating channel at all (the old
 *     client-fed function is gone), replays are idempotent, and rapid-fire
 *     submissions are rate limited.
 *
 * TEST-only target selection (never committed, never production):
 *   FC_TEST_DB_URL          connection string for a dedicated test database.
 *                           HARD GUARD: if it references the production
 *                           project ref, this suite refuses to run.
 *   (unset)                 boots a local embedded PostgreSQL, applies
 *                           src/test/harness.local.sql + supabase/migrations,
 *                           and wipes it afterwards.
 *   FC_SKIP_INTEGRATION=1   explicit opt-out where neither target exists.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { updateRating200 } from '../lib/chess/rating200'
import { assertNotProduction, startTestDb, type TestDb } from './pg-harness'

const FC_TEST_DB_URL = process.env.FC_TEST_DB_URL ?? ''
assertNotProduction(FC_TEST_DB_URL) // refuse at load time, before anything runs
const RUN = process.env.FC_SKIP_INTEGRATION !== '1'

const DAY = 24 * 3600 * 1000
const HERE = dirname(fileURLToPath(import.meta.url))

/** exact allowlist of public-schema functions — an unexpected one fails */
const ALLOWED_FUNCTIONS = [
  'apply_game_rules()',
  'cancel_queue()',
  'check_username(text)',
  'claim_username(text,text,text)',
  'delete_my_account()',
  'enable_autopilot(uuid,text)',
  'finalize_game(uuid)',
  'glicko200_update(integer,integer,numeric,timestamp with time zone,integer,integer,numeric,bigint,timestamp with time zone)',
  'leaderboard(text,integer,integer)',
  'puzzle_leaderboard(integer,integer)',
  'queue_match(jsonb,boolean,integer)',
  'record_puzzle_result(text,boolean,bigint,bigint)',
  'sync_guest(text,text,text)',
  'tc_category(jsonb)',
  'touch_guest()',
  'update_username(text)',
]

/** the only functions authenticated may execute (the browser-facing RPCs) */
const CLIENT_RPC_FUNCTIONS = [
  'cancel_queue',
  'check_username',
  'claim_username',
  'delete_my_account',
  'enable_autopilot',
  'finalize_game',
  'leaderboard',
  'puzzle_leaderboard',
  'queue_match',
  'record_puzzle_result',
  'sync_guest',
  'touch_guest',
  'update_username',
]

describe.skipIf(!RUN)('server rating stack (TEST database — never production)', () => {
  /** assigned in beforeAll once the test database is up */
  let db!: Client
  let server: TestDb | null = null
  let alice = ''
  let bob = ''
  let dave = ''
  let zoe = ''

  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0]

  /** fixture/direct-database perspective (superuser, no JWT claims) */
  const asPostgres = async () => {
    await db.query(`reset role`)
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }

  /** exactly what PostgREST gives the browser: authenticated + subject claim */
  const asUser = async (id: string) => {
    await db.query(`reset role`)
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: id, role: 'authenticated' }),
    ])
    await db.query(`set role authenticated`)
  }

  /** a caller with no session at all */
  const asAnon = async () => {
    await db.query(`reset role`)
    await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', false)`)
    await db.query(`set role anon`)
  }

  /** a registered test account (guests are is_anonymous and never claim names) */
  const createUser = async (local: string): Promise<string> => {
    await asPostgres()
    const id = crypto.randomUUID()
    await q(`insert into auth.users (id, email, is_anonymous) values ($1, $2, false)`, [
      id,
      `fc-test-${local.toLowerCase()}-${Date.now()}@example.test`,
    ])
    await q(`insert into public.guests (id, username) values ($1, $2) on conflict (id) do nothing`, [
      id,
      `Test${local}`,
    ])
    return id
  }

  beforeAll(async () => {
    server = await startTestDb()
    db = new Client(server.client)
    await db.connect()
    alice = await createUser('Alice')
    bob = await createUser('Bob')
    dave = await createUser('Dave')

    // seed the puzzle catalog from the app's own asset (same data production uses)
    const puzzles = JSON.parse(
      readFileSync(join(HERE, '..', 'assets', 'puzzles', 'puzzles.json'), 'utf8'),
    ) as { id: string; rating: number }[]
    await asPostgres()
    const params: unknown[] = []
    const tuples = puzzles.map((p, i) => {
      params.push(p.id, p.rating)
      return `($${i * 2 + 1}, $${i * 2 + 2})`
    })
    await q(
      `insert into public.puzzles (id, rating) values ${tuples.join(', ')}
       on conflict (id) do update set rating = excluded.rating`,
      params,
    )
  }, 180_000)

  afterAll(async () => {
    try {
      if (alice || bob || dave || zoe) {
        await asPostgres()
        const ids = [alice, bob, dave, zoe].filter(Boolean)
        // finish/nul seats first (FK: games reference the seat owners)
        await q(
          `update public.games set status = 'over',
                  result = coalesce(result, '{"winner": null, "reason": "resign"}'::jsonb)
            where status not in ('over', 'aborted')
              and (white_id = any ($1::uuid[]) or black_id = any ($1::uuid[]))`,
          [ids],
        )
        await q(`update public.games set white_id = null where white_id = any ($1::uuid[])`, [ids])
        await q(`update public.games set black_id = null where black_id = any ($1::uuid[])`, [ids])
        // cascades guests/profiles/ratings/rating_history/puzzle_results
        await q(`delete from auth.users where id = any ($1::uuid[])`, [ids])
      }
    } catch {
      /* ephemeral embedded database — best effort */
    }
    if (db) await db.end().catch(() => {})
    await server?.stop()
  })

  /* ------------------------------------------------------------------ */
  /* function inventory & permissions                                    */
  /* ------------------------------------------------------------------ */

  it('public function inventory matches the allowlist, fully locked down', async () => {
    await asPostgres()
    const rows = await q(`
      select p.oid::regprocedure::text as sig,
             p.proname,
             p.prosecdef as secdef,
             coalesce(p.proconfig::text, '') as cfg,
             has_function_privilege('anon', p.oid, 'execute') as anon_x,
             has_function_privilege('public', p.oid, 'execute') as pub_x,
             has_function_privilege('authenticated', p.oid, 'execute') as auth_x
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
       order by 1`)

    // exact set: no diagnostic probe, nothing unexpected (the hidden
    // autopilot RPC is the expected 0017 feature)
    expect(rows.map((r) => r.sig)).toEqual(ALLOWED_FUNCTIONS)
    expect(rows.some((r) => /probe|sync_puzzle/i.test(r.sig))).toBe(false)

    for (const r of rows) {
      expect(r.cfg, `${r.proname} must have a pinned search_path`).toContain('search_path')
      // nobody outside the app roles can execute anything in public
      expect(r.anon_x, `${r.proname} executable by anon`).toBe(false)
      expect(r.pub_x, `${r.proname} executable via PUBLIC`).toBe(false)
    }

    // authenticated gets exactly the browser-facing RPCs, nothing more
    const withAuth = rows.filter((r) => r.auth_x).map((r) => r.proname).sort()
    expect(withAuth).toEqual([...CLIENT_RPC_FUNCTIONS].sort())

    // SECURITY DEFINER everywhere it matters + search_path pinned to public
    for (const r of rows.filter((r) => ['enable_autopilot', 'finalize_game', 'record_puzzle_result', 'queue_match', 'sync_guest'].includes(r.proname))) {
      expect(r.secdef, `${r.proname} must be SECURITY DEFINER`).toBe(true)
      expect(r.cfg).toContain('search_path=public')
    }
  })

  /* ------------------------------------------------------------------ */
  /* rating math                                                         */
  /* ------------------------------------------------------------------ */

  it('glicko200_update is an exact port of updateRating200 (parity)', async () => {
    await asPostgres()
    const cases = [
      { p: { rating: 200, rd: 350, vol: 0.06 }, o: { rating: 200, rd: 350 }, score: 1, elapsed: 0 },
      { p: { rating: 245, rd: 80, vol: 0.05 }, o: { rating: 210, rd: 110 }, score: 0.5, elapsed: 3 * DAY },
      { p: { rating: 100, rd: 45, vol: 0.01 }, o: { rating: 1800, rd: 45 }, score: 0, elapsed: 10 * DAY },
      { p: { rating: 500, rd: 200, vol: 0.09 }, o: { rating: 500, rd: 200 }, score: 1, elapsed: 30 * DAY },
    ]
    for (const c of cases) {
      const ts = updateRating200(
        { ...c.p, updatedAt: 0 },
        [{ oppRating: c.o.rating, oppRd: c.o.rd, score: c.score, elapsedMs: c.elapsed }],
      )
      const sql = (
        await one(
          `select rating, rd, vol from public.glicko200_update($1, $2, $3, now(), $4, $5, $6, $7, now())`,
          [c.p.rating, c.p.rd, c.p.vol, c.o.rating, c.o.rd, c.score, c.elapsed],
        )
      ) as { rating: number; rd: number; vol: string }
      expect(sql.rating, `rating parity for ${JSON.stringify(c)}`).toBe(ts.rating)
      expect(sql.rd, `rd parity for ${JSON.stringify(c)}`).toBe(ts.rd)
      expect(Math.abs(Number(sql.vol) - ts.vol)).toBeLessThan(0.0002)
    }
  })

  /* ------------------------------------------------------------------ */
  /* game finalization                                                   */
  /* ------------------------------------------------------------------ */

  const makeGame = async (w: string, b: string, plies: number, rated = true, status = 'over') => {
    await asPostgres()
    const moves = JSON.stringify(
      Array.from({ length: plies }, (_, i) => ({ uci: 'e2e4', san: 'e4', at: i, wms: 1000, bms: 1000 })),
    )
    const row = await one(
      `insert into public.games (white_id, black_id, tc, rated, status, moves, result, wms, bms)
       values ($1, $2, '{"base": 300000, "inc": 0, "type": "blitz"}', $3, $4, $5::jsonb,
               case when $4 = 'over' then '{"winner": "w", "reason": "checkmate"}'::jsonb else null end,
               60000, 60000)
       returning id, rated, casual_reason`,
      [w, b, rated, status, moves],
    )
    return row as { id: string; rated: boolean; casual_reason: string | null }
  }

  it('finalize_game rates a finished game exactly once (idempotent)', async () => {
    const g = await makeGame(alice, bob, 4)
    await asUser(alice)

    const first = (await one(`select public.finalize_game($1) as r`, [g.id])).r as {
      changed: boolean
      category: string
      white: { before: number; after: number; rd: number }
      black: { before: number; after: number }
    }
    expect(first.changed).toBe(true)
    expect(first.category).toBe('blitz')
    expect(first.white.before).toBe(200)
    expect(first.white.after).toBeGreaterThan(first.white.before) // fresh win ≈ +162
    expect(first.white.rd).toBeLessThan(350)
    expect(first.black.after).toBeLessThan(200)

    // retry: no second change, still exactly one history row per player
    const second = (await one(`select public.finalize_game($1) as r`, [g.id])).r as { changed: boolean; reason: string }
    expect(second.changed).toBe(false)
    expect(second.reason).toBe('already_finalized')

    const rows = await q(`select user_id, result, rating_before, rating_after from public.rating_history where game_id = $1`, [g.id])
    expect(rows.length).toBe(2)
    expect(rows.filter((r) => r.result === 'win').length).toBe(1)
    expect(rows.filter((r) => r.result === 'loss').length).toBe(1)

    await asPostgres()
    const wr = await one(`select rating, games, wins, peak from public.ratings where user_id = $1 and category = 'blitz'`, [alice])
    expect(wr.games).toBe(1)
    expect(wr.wins).toBe(1)
    expect(wr.peak).toBe(wr.rating)
    expect(wr.rating).toBe(first.white.after)

    // third call still nothing
    await asUser(alice)
    const third = (await one(`select public.finalize_game($1) as r`, [g.id])).r as { changed: boolean }
    expect(third.changed).toBe(false)
  })

  it('fewer than 2 moves by each player never changes a rating', async () => {
    const g = await makeGame(alice, bob, 2) // 1 move each
    await asUser(alice)
    const res = (await one(`select public.finalize_game($1) as r`, [g.id])).r as { changed: boolean; reason: string }
    expect(res.changed).toBe(false)
    expect(res.reason).toBe('too_few_moves')
    await asPostgres()
    const rows = await q(`select 1 from public.rating_history where game_id = $1`, [g.id])
    expect(rows.length).toBe(0)
  })

  it('casual and unfinished games are no-ops', async () => {
    const casual = await makeGame(alice, bob, 4, false)
    const waiting = await makeGame(alice, bob, 4, true, 'active')
    await asUser(alice)
    const r1 = (await one(`select public.finalize_game($1) as r`, [casual.id])).r as { reason: string }
    const r2 = (await one(`select public.finalize_game($1) as r`, [waiting.id])).r as { reason: string }
    expect(r1.reason).toBe('casual')
    expect(r2.reason).toBe('not_finished')
  })

  it('after 4 rated games vs one opponent in 24h the next game is forced casual', async () => {
    // one rated game was already finalized in the idempotency test →
    // three more reach the limit of 4; the next insert must go casual
    for (let i = 0; i < 3; i++) {
      const g = await makeGame(alice, bob, 4)
      await asUser(alice)
      const res = (await one(`select public.finalize_game($1) as r`, [g.id])).r as { changed: boolean }
      expect(res.changed).toBe(true)
    }
    const fifth = await makeGame(alice, bob, 4)
    expect(fifth.rated).toBe(false)
    expect(fifth.casual_reason).toBe('farming_limit')

    // and the farming game itself never rates
    await asUser(alice)
    const res = (await one(`select public.finalize_game($1) as r`, [fifth.id])).r as { reason: string }
    expect(res.reason).toBe('casual')
  })

  /* ------------------------------------------------------------------ */
  /* accounts                                                            */
  /* ------------------------------------------------------------------ */

  it('username rules hold in the database', async () => {
    await asUser(alice)

    const reserved = (await one(`select public.claim_username('admin', 's', null) as r`)).r as { ok: boolean; error: string }
    expect(reserved.ok).toBe(false)
    expect(reserved.error).toMatch(/reserved/)

    const okRes = (await one(`select public.claim_username('TestAce_1', 'seedA', 'US') as r`, [])).r as { ok: boolean }
    expect(okRes.ok).toBe(true)
    await asPostgres()
    const prof = await one(`select username, username_key, avatar_seed, flag from public.profiles where id = $1`, [alice])
    expect(prof.username).toBe('TestAce_1')
    expect(prof.username_key).toBe('testace_1')
    expect(prof.flag).toBe('US')

    // case-insensitive uniqueness
    await asUser(alice)
    const dup = (await one(`select public.check_username('tEsTaCe_1') as e`)).e as string
    expect(dup).toMatch(/already taken/)

    // idempotent re-claim of the same name, refusal of a second name
    const again = (await one(`select public.claim_username('testace_1', 'seedB', null) as r`)).r as { ok: boolean }
    expect(again.ok).toBe(true)
    const secondName = (await one(`select public.claim_username('OtherName9', 's', null) as r`)).r as { ok: boolean; error: string }
    expect(secondName.ok).toBe(false)

    // change rate limit: 5 per day (unique names per run so a crashed run can
    // never leave squatters behind)
    const suffix = Date.now().toString(36)
    for (let i = 1; i <= 5; i++) {
      const r = (await one(`select public.update_username($1) as r`, [`Chg${suffix}${i}`])).r as { ok: boolean; error?: string }
      expect(r.ok, `change ${i}: ${r.error ?? ''}`).toBe(true)
    }
    const limited = (await one(`select public.update_username($1) as r`, [`Chg${suffix}6`])).r as { ok: boolean; error: string }
    expect(limited.ok).toBe(false)
    expect(limited.error).toMatch(/limited/)

    // guests row display name follows the account name
    await asPostgres()
    const guest = await one(`select username from public.guests where id = $1`, [alice])
    expect(guest.username).toBe(`Chg${suffix}5`)
  })

  it('leaderboard lists accounts only, never provisional players', async () => {
    // alice has a blitz row from the finalize tests — currently provisional
    await asUser(alice)
    let board = await q(`select user_id from public.leaderboard('blitz', 100, 0)`)
    expect(board.some((r) => r.user_id === alice)).toBe(false)

    // bob: established rating row but NO profile (a guest) — must never appear
    await asPostgres()
    await q(
      `insert into public.ratings (user_id, category, rating, rd, vol, games, wins, peak)
       values ($1, 'blitz', 240, 80, 0.05, 12, 7, 260)
       on conflict (user_id, category) do update set rd = 80, rating = 240`,
      [bob],
    )
    await asUser(alice)
    board = await q(`select user_id from public.leaderboard('blitz', 100, 0)`)
    expect(board.some((r) => r.user_id === bob)).toBe(false)

    // alice becomes established → appears
    await asPostgres()
    await q(`update public.ratings set rd = 80 where user_id = $1 and category = 'blitz'`, [alice])
    await asUser(alice)
    board = await q(`select user_id, rating from public.leaderboard('blitz', 100, 0)`)
    const row = board.find((r) => r.user_id === alice)
    expect(row).toBeTruthy()
    expect(row.rating).toBeGreaterThan(100)

    // provisional again → gone
    await asPostgres()
    await q(`update public.ratings set rd = 200 where user_id = $1 and category = 'blitz'`, [alice])
    await asUser(alice)
    board = await q(`select user_id from public.leaderboard('blitz', 100, 0)`)
    expect(board.some((r) => r.user_id === alice)).toBe(false)
  })

  it('signed-out callers cannot execute the leaderboard RPC (signed-in only)', async () => {
    await asAnon()
    await expect(one(`select user_id from public.leaderboard('blitz', 10, 0)`)).rejects.toThrow(/permission denied/)
    await expect(one(`select user_id from public.puzzle_leaderboard(10, 0)`)).rejects.toThrow(/permission denied/)
    // a signed-in guest can (leaderboard eligibility is decided by the SQL)
    await asUser(bob)
    const board = await q(`select user_id from public.leaderboard('blitz', 10, 0)`)
    expect(Array.isArray(board)).toBe(true)
  })

  /* ------------------------------------------------------------------ */
  /* write paths                                                         */
  /* ------------------------------------------------------------------ */

  it('client roles can never write ratings, history or results directly', async () => {
    const denial = /permission denied|row-level security/
    const inserts = [
      `insert into public.ratings (user_id, category, rating, rd, vol) values ($1, 'blitz', 3000, 45, 0.06)`,
      `insert into public.rating_history (user_id, category, game_id, rating_before, rating_after, rd_after, result)
         select $1, 'blitz', g.id, 3000, 3000, 45, 'win' from public.games g limit 1`,
      `insert into public.puzzle_results (user_id, puzzle_id, attempt_no, solved, rating_before, rating_after, rd_after)
         values ($1, 'p001', 1, true, 3000, 3000, 45)`,
      `update public.ratings set rating = 3000 where user_id = $1 and category = 'blitz'`,
      `update public.ratings set rating = 3000 where user_id = $1 and category = 'puzzle'`,
      `delete from public.ratings where user_id = $1`,
    ]
    for (const role of ['anon', 'authenticated'] as const) {
      if (role === 'anon') await asAnon()
      else await asUser(alice)
      for (const sql of inserts) {
        await expect(db.query(sql, [alice]), `${role}: ${sql.slice(0, 50)}`).rejects.toThrow(denial)
      }
    }
    await asPostgres()
  })

  it('account deletion blocks on active games, then anonymizes archives', async () => {
    // active game → refused
    await makeGame(dave, alice, 0, true, 'active')
    await asUser(dave)
    await expect(one(`select public.delete_my_account() as r`)).rejects.toThrow(/active games/)

    // finish it → deletion succeeds, the game stays anonymized
    await asPostgres()
    await q(`update public.games set status = 'over', result = '{"winner": "w", "reason": "resign"}'::jsonb
             where status = 'active' and white_id = $1`, [dave])
    const finished = await makeGame(dave, alice, 4)
    await asUser(dave)
    const res = (await one(`select public.delete_my_account() as r`)).r as { ok: boolean }
    expect(res.ok).toBe(true)

    await asPostgres()
    expect(await one(`select 1 from auth.users where id = $1`, [dave])).toBeFalsy()
    expect(await one(`select 1 from public.guests where id = $1`, [dave])).toBeFalsy()
    expect(await one(`select 1 from public.profiles where id = $1`, [dave])).toBeFalsy()
    const g = await one(`select white_id, black_id from public.games where id = $1`, [finished.id])
    expect(g.white_id).toBeNull()
    expect(g.black_id).toBe(alice) // opponent intact
    dave = '' // deleted — afterAll must not try again
  })

  /* ------------------------------------------------------------------ */
  /* puzzle ratings: server-authoritative                                */
  /* ------------------------------------------------------------------ */

  const solve = async (user: string, puzzleId: string, solved: boolean, timeMs: number | null, attempt: number) => {
    await asUser(user)
    return (await one(`select public.record_puzzle_result($1, $2, $3, $4) as r`, [puzzleId, solved, timeMs, attempt])).r as {
      ok: boolean
      rating: number
      rd: number
      games: number
      wins: number
      losses: number
      duplicate?: boolean
      ignored?: boolean
    }
  }

  it('record_puzzle_result: no client rating channel exists — the server computes', async () => {
    zoe = await createUser('Zoe')

    // the old client-fed entry point is gone entirely
    await asPostgres()
    await expect(
      one(`select public.sync_puzzle_rating(3000, 45, 0.06, 9, 9, 9, true)`),
    ).rejects.toThrow(/does not exist/)

    // the new RPC takes no rating/rd/vol arguments: forging is a signature error
    await expect(
      one(`select public.record_puzzle_result('p001', true, 8000, 1, 3000)`),
    ).rejects.toThrow(/does not exist/)

    // an honest solve: the server reads p001's difficulty and computes the gain
    const r1 = await solve(zoe, 'p001', true, 8000, 11)
    expect(r1.ok).toBe(true)
    expect(r1.duplicate).toBe(false)
    expect(r1.rating).toBeGreaterThan(200)
    expect(r1.rating).toBeLessThan(1000)

    await asPostgres()
    const row = await one(`select rating, games, wins from public.ratings where user_id = $1 and category = 'puzzle'`, [zoe])
    expect(row.games).toBe(1)
    expect(row.wins).toBe(1)
    expect(row.rating).toBe(r1.rating)
    const hist = await q(`select game_id, result from public.rating_history where user_id = $1 and category = 'puzzle'`, [zoe])
    expect(hist.length).toBe(1)
    expect(hist[0].game_id).toBeNull() // puzzles never carry a game row
    expect(hist[0].result).toBe('win')

    // no session at all → anon cannot even execute the RPC
    await asAnon()
    await expect(one(`select public.record_puzzle_result('p001', true, 8000, 12)`)).rejects.toThrow(/permission denied/)

    // signed-in role but no subject claim → refused by the function itself
    await db.query(`reset role`)
    await db.query(`select set_config('request.jwt.claims', '', false)`)
    await db.query(`set role authenticated`)
    await expect(one(`select public.record_puzzle_result('p001', true, 8000, 12)`)).rejects.toThrow(/not signed in/)
    await asPostgres()
  })

  it('replaying a puzzle attempt never rates twice', async () => {
    const state = async () =>
      await one(`select rating, games from public.ratings where user_id = $1 and category = 'puzzle'`, [zoe])
    const points = async () =>
      (await q(`select 1 from public.rating_history where user_id = $1 and category = 'puzzle'`, [zoe])).length

    const before = await state()
    const beforePts = await points()

    // exact replay of the previous test's attempt → duplicate, nothing moves
    const replay = await solve(zoe, 'p001', true, 8000, 11)
    expect(replay.duplicate).toBe(true)
    expect(replay.rating).toBe(before.rating)
    expect(await state()).toEqual(before)
    expect(await points()).toBe(beforePts)

    // a fresh attempt rates exactly once…
    const fresh = await solve(zoe, 'p002', false, null, 12)
    expect(fresh.duplicate).toBe(false)
    const mid = await state()
    expect(mid.games).toBe(Number(before.games) + 1)
    expect(await points()).toBe(beforePts + 1)

    // …and replaying IT is also a no-op
    const again = await solve(zoe, 'p002', false, null, 12)
    expect(again.duplicate).toBe(true)
    expect(await state()).toEqual(mid)
    expect(await points()).toBe(beforePts + 1)
  })

  it('rapid-fire puzzle submissions are rate limited, not silently absorbed', async () => {
    await asPostgres()
    const recent = Number(
      (
        await one(
          `select count(*)::int as n from public.puzzle_results
            where user_id = $1 and created_at > now() - interval '1 minute'`,
          [zoe],
        )
      ).n,
    )
    // tighten the per-minute limit to "3 more allowed" for a fast, deterministic run
    await q(`update public.puzzle_rating_config set value = $1 where key = 'rate_max_per_minute'`, [recent + 3])
    const gamesBefore = Number(
      (await one(`select games from public.ratings where user_id = $1 and category = 'puzzle'`, [zoe])).games,
    )

    try {
      for (let i = 0; i < 3; i++) {
        const r = await solve(zoe, 'p003', true, 4000, 100 + i)
        expect(r.ok).toBe(true)
      }
      // the next one over the limit must be REFUSED with an error the UI can show
      await expect(solve(zoe, 'p003', true, 4000, 103)).rejects.toThrow(/rate limited/)
    } finally {
      await asPostgres()
      await q(`update public.puzzle_rating_config set value = 30 where key = 'rate_max_per_minute'`)
    }

    // the refused submission never touched the rating
    const after = await one(`select games from public.ratings where user_id = $1 and category = 'puzzle'`, [zoe])
    expect(Number(after.games)).toBe(gamesBefore + 3)
  })
})
