/**
 * Test-database harness — the integration suite NEVER touches production.
 *
 * Target selection (TEST-only):
 *   FC_TEST_DB_URL   optional connection string for a dedicated test
 *                    database (e.g. a second Supabase project). Hard guard:
 *                    if it references the production project ref, the suite
 *                    refuses to run — loudly, not by skipping.
 *   (unset)          a local embedded PostgreSQL (dev dependency
 *                    `embedded-postgres`) is booted fresh for the run,
 *                    migrated from supabase/migrations/, and wiped after.
 *   FC_SKIP_INTEGRATION=1   explicit opt-out for platforms where neither
 *                    target is available.
 *
 * On Windows the embedded server must not run under an elevated admin
 * shell (postgres.exe refuses admin tokens); run the suite from a normal
 * terminal, or via:  runas /trustlevel:0x20000 "cmd /c npm test"
 */
import { Client, type ClientConfig } from 'pg'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** production Supabase project ref — must never appear in a test target */
export const PRODUCTION_PROJECT_REF = 'vtyksxibpkstzjnjcyzs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DATA_DIR = join(tmpdir(), 'fc-embedded-pg')
const PORT = Number(process.env.FC_TEST_PG_PORT ?? 55439)
const LOCAL_PASSWORD = 'fc-embedded-test-only'

export interface TestDb {
  /** connection string of the (non-production) test database */
  url: string
  /** client config incl. TLS only when the target actually needs it */
  client: ClientConfig
  /** shut down and clean up (embedded: stop + wipe; external: no-op) */
  stop: () => Promise<void>
}

/** hard guard: refuse any target that points at the production project */
export function assertNotProduction(url: string, variable = 'FC_TEST_DB_URL'): void {
  if (!url) return
  if (url.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      `${variable} references the PRODUCTION project (${PRODUCTION_PROJECT_REF}). ` +
        'Integration tests refuse to run against production — point it at a dedicated test database.',
    )
  }
}

function wipeDataDir(): void {
  rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}

async function startEmbedded(): Promise<TestDb> {
  const mod = (await import('embedded-postgres')) as unknown as { default?: new (o: Record<string, unknown>) => Record<string, (arg?: unknown) => Promise<unknown>> } & Record<string, unknown>
  const Ctor = (mod.default ?? mod) as new (o: Record<string, unknown>) => {
    initialise: () => Promise<void>
    start: () => Promise<void>
    stop: () => Promise<void>
  }

  if (existsSync(DATA_DIR)) wipeDataDir() // leftovers from an interrupted run

  const server = new Ctor({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: LOCAL_PASSWORD,
    port: PORT,
    persistent: true, // we wipe explicitly in stop() — avoids an rmdir race
    // Windows locales default initdb to WIN1252, which cannot store the
    // UTF-8 characters used in the migrations (and would not match the
    // production encoding either).
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  })

  await server.initialise()
  try {
    await server.start()
  } catch (err) {
    const msg = String((err as Error).message ?? err)
    if (msg.includes('unprivileged user ID')) {
      throw new Error(
        'PostgreSQL refuses to run under an elevated admin shell. ' +
          'Run the tests from a normal (unelevated) terminal — on Windows: ' +
          'runas /trustlevel:0x20000 "cmd /c npm test"',
      )
    }
    throw err
  }

  return {
    url: `postgresql://postgres:${LOCAL_PASSWORD}@127.0.0.1:${PORT}/postgres`,
    client: { connectionString: `postgresql://postgres:${LOCAL_PASSWORD}@127.0.0.1:${PORT}/postgres` },
    stop: async () => {
      await server.stop().catch(() => {})
      try {
        wipeDataDir()
      } catch {
        /* handles can linger a tick; next run wipes again */
      }
    },
  }
}

async function startExternal(url: string): Promise<TestDb> {
  const needsTls = /supabase\.(co|com)/.test(url)
  return {
    url,
    client: { connectionString: url, ...(needsTls ? { ssl: { rejectUnauthorized: false } } : {}) },
    stop: async () => {},
  }
}

/** boot/resolve the test database and apply harness + migrations if empty */
export async function startTestDb(): Promise<TestDb> {
  const external = process.env.FC_TEST_DB_URL ?? ''
  assertNotProduction(external)
  const db = external ? await startExternal(external) : await startEmbedded()

  const probe = new Client(db.client)
  await probe.connect()
  try {
    const existing = await probe.query(`select to_regclass('public.games') as g`)
    if (!existing.rows[0].g) {
      await probe.query(readFileSync(join(REPO_ROOT, 'src', 'test', 'harness.local.sql'), 'utf8'))
      const dir = join(REPO_ROOT, 'supabase', 'migrations')
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
      for (const f of files) {
        await probe.query(readFileSync(join(dir, f), 'utf8'))
      }
    }
  } finally {
    await probe.end().catch(() => {})
  }
  return db
}
