/**
 * E2E test-backend resolution + hard guard.
 *
 * The Playwright suite creates anonymous users, games, lobby rows and rating
 * rows, so it must NEVER talk to the production Supabase project. The backend
 * is selected exclusively through TEST-only values:
 *
 *   FC_TEST_SUPABASE_URL        public API URL of a dedicated test project
 *   FC_TEST_SUPABASE_ANON_KEY   its public anon key (the app uses this)
 *   FC_TEST_DB_URL              optional: connection string, used by teardown
 *   FC_TEST_SERVICE_KEY         optional: service_role key, teardown fallback
 *
 * The same keys may live in a git-ignored `.env.test` at the repo root
 * (see `.env.test.example`). Real environment variables win over the file.
 *
 * Hard guard: if any configured value references the PRODUCTION project ref,
 * the whole run refuses to start. If no test backend is configured, the run
 * also refuses — the suite never silently falls back to `.env` (production).
 */
import { readFileSync } from 'node:fs'

/** Production Supabase project ref — the e2e suite may never point here. */
export const PRODUCTION_REF = 'vtyksxibpkstzjnjcyzs'

const ENV_FILE_URL = new URL('../.env.test', import.meta.url)

export interface TestBackend {
  /** public API URL, e.g. https://<ref>.supabase.co */
  supabaseUrl: string
  /** public anon key used by the app under test */
  anonKey: string
  /** optional service_role key (teardown fallback via REST/admin API) */
  serviceKey: string
  /** optional Postgres connection string (preferred teardown path) */
  dbUrl: string
  /** where the values came from, for logging */
  source: string
}

/** minimal KEY=VALUE parser for the git-ignored `.env.test` */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function readEnvTestFile(): { values: Record<string, string>; found: boolean } {
  try {
    return { values: parseEnvFile(readFileSync(ENV_FILE_URL, 'utf8')), found: true }
  } catch {
    return { values: {}, found: false }
  }
}

function resolveTestBackend(): TestBackend {
  const file = readEnvTestFile()
  const pick = (key: string): string => process.env[key]?.trim() || file.values[key]?.trim() || ''
  const source = ['process env FC_TEST_*', file.found ? '.env.test' : null].filter(Boolean).join(' + ')
  return {
    supabaseUrl: pick('FC_TEST_SUPABASE_URL'),
    anonKey: pick('FC_TEST_SUPABASE_ANON_KEY'),
    serviceKey: pick('FC_TEST_SERVICE_KEY'),
    dbUrl: pick('FC_TEST_DB_URL'),
    source,
  }
}

export interface GuardFailure {
  problem: string
}

/** Returns the list of reasons the run must refuse to start (empty = ok). */
export function testBackendProblems(cfg: TestBackend): GuardFailure[] {
  const problems: GuardFailure[] = []

  if (!cfg.supabaseUrl) {
    problems.push({
      problem:
        'FC_TEST_SUPABASE_URL is not set. The e2e suite writes users/games/ratings, ' +
        'so it only runs against a dedicated TEST Supabase project (never production).',
    })
  } else {
    if (!/^https:\/\//.test(cfg.supabaseUrl)) {
      problems.push({ problem: `FC_TEST_SUPABASE_URL must be an https URL (got "${cfg.supabaseUrl}")` })
    }
    if (cfg.supabaseUrl.includes(PRODUCTION_REF)) {
      problems.push({
        problem:
          `FC_TEST_SUPABASE_URL references the PRODUCTION project ref "${PRODUCTION_REF}". ` +
          'Refusing to run: use a second, dedicated Supabase project.',
      })
    }
  }

  if (!cfg.anonKey) {
    problems.push({ problem: 'FC_TEST_SUPABASE_ANON_KEY is not set (the public anon key of the test project).' })
  }

  if (cfg.dbUrl && cfg.dbUrl.includes(PRODUCTION_REF)) {
    problems.push({
      problem:
        `FC_TEST_DB_URL references the PRODUCTION project ref "${PRODUCTION_REF}". ` +
        'Refusing to run: teardown would delete production rows.',
    })
  }

  if (!cfg.dbUrl && !cfg.serviceKey) {
    problems.push({
      problem:
        'Neither FC_TEST_DB_URL nor FC_TEST_SERVICE_KEY is set, so the run could not clean up ' +
        'after itself. Refusing to write to the test backend without cleanup credentials.',
    })
  }

  return problems
}

/** Resolved backend for this run (also used by specs to reach the test API). */
export const TEST_BACKEND: TestBackend = resolveTestBackend()

/** Throws (loudly) unless the run is pointed at a dedicated test backend. */
export function assertTestBackend(): TestBackend {
  const problems = testBackendProblems(TEST_BACKEND)
  if (problems.length > 0) {
    throw new Error(
      [
        '',
        '  ✖ E2E REFUSED TO RUN — unsafe or missing test backend',
        '',
        ...problems.map((p) => `    • ${p.problem}`),
        '',
        '  Configure a dedicated test backend (git-ignored .env.test or env vars):',
        '    FC_TEST_SUPABASE_URL=https://<test-ref>.supabase.co',
        '    FC_TEST_SUPABASE_ANON_KEY=<public anon key>',
        '    FC_TEST_DB_URL=postgresql://postgres.<test-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres',
        '    FC_TEST_SERVICE_KEY=<service_role key>      # alternative to FC_TEST_DB_URL',
        '',
        '  See README → "Running the e2e suite without touching production".',
        '',
      ].join('\n'),
    )
  }
  return TEST_BACKEND
}

/** Project ref of the configured test backend (used in logs and assertions). */
export function testProjectRef(cfg: TestBackend = TEST_BACKEND): string {
  try {
    return new URL(cfg.supabaseUrl).host.split('.')[0]
  } catch {
    return ''
  }
}

/** true when the app under test has a backend configured (online specs need it) */
export function supabaseConfigured(): boolean {
  return Boolean(TEST_BACKEND.supabaseUrl && TEST_BACKEND.anonKey)
}
