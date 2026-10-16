#!/usr/bin/env node
/**
 * One-command database backup.
 *
 *   FC_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
 *     npm run db:backup
 *
 * Writes `backups/fc-backup-<UTC timestamp>.dump` (PostgreSQL custom format).
 * `backups/` is git-ignored, so a dump never lands in the repository.
 *
 * Flags:
 *   --with-auth   also dump the `auth` schema (accounts) — see README
 *   --all         dump every schema (largest; restore only into an empty DB)
 *   --schema a,b  dump exactly these schemas
 *
 * The connection string is only ever passed through the child process
 * environment (PGHOST/PGPASSWORD/...), never on the command line, so the
 * password does not show up in process listings.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = join(REPO_ROOT, 'backups')

function fail(message) {
  console.error(`\n  ✖ ${message}\n`)
  process.exit(1)
}

function findPgDump() {
  if (process.env.PG_DUMP) return process.env.PG_DUMP

  const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const found = execFileSync(which, [exe], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0]
    if (found) return found
  } catch {
    /* not on PATH — try the usual install locations below */
  }

  const roots =
    process.platform === 'win32'
      ? ['C:/Program Files/PostgreSQL', 'C:/Program Files (x86)/PostgreSQL']
      : ['/usr/lib/postgresql', '/opt/homebrew/opt', '/usr/local/opt']

  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root).sort().reverse()) {
      for (const candidate of [join(root, entry, 'bin', exe), join(root, entry, 'bin', 'bin', exe)]) {
        if (existsSync(candidate)) return candidate
      }
    }
  }

  fail(
    [
      'pg_dump not found.',
      '  Install the PostgreSQL client tools, then re-run:',
      '    winget install PostgreSQL.PostgreSQL.17                      # Windows',
      '    brew install libpq && export PATH="$(brew --prefix libpq)/bin:$PATH"  # macOS',
      '    apt-get install postgresql-client-17                         # Debian/Ubuntu',
      '  Or point straight at an existing binary:',
      '    PG_DUMP="/c/Program Files/PostgreSQL/17/bin/pg_dump.exe" npm run db:backup',
    ].join('\n'),
  )
}

function connectionEnv(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    fail('FC_DB_URL is not a valid URL')
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) fail('FC_DB_URL must start with postgresql://')
  const database = decodeURIComponent(url.pathname.replace(/^\//, '') || 'postgres')
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    PGSSLMODE: process.env.PGSSLMODE ?? 'require',
  }
}

/** never echo a connection string — this is all the logs ever show */
const REDACTED = '<connection string hidden>'

function main() {
  const args = process.argv.slice(2)
  const dbUrl = process.env.FC_DB_URL
  if (!dbUrl) {
    fail(
      'FC_DB_URL is not set. Use your own credentials, e.g.\n' +
        '    FC_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" npm run db:backup',
    )
  }

  const schemas = []
  if (args.includes('--all')) schemas.push('--all')
  else if (args.includes('--with-auth')) schemas.push('--schema=public', '--schema=auth')
  else {
    const explicit = args.find((a) => a.startsWith('--schema'))
    if (explicit) schemas.push(explicit)
    else schemas.push('--schema=public')
  }

  const pgDump = findPgDump()
  mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const outFile = join(OUT_DIR, `fc-backup-${stamp}.dump`)

  console.log(`[db:backup] ${pgDump}`)
  console.log(`[db:backup] target ${REDACTED}  →  ${outFile}`)

  execFileSync(
    pgDump,
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--verbose',
      ...schemas,
      '--file',
      outFile,
    ],
    { env: { ...process.env, ...connectionEnv(dbUrl) }, stdio: ['ignore', 'ignore', 'inherit'] },
  )

  const size = statSync(outFile).size
  console.log(`[db:backup] done — ${(size / 1024 / 1024).toFixed(2)} MB`)
  console.log(`[db:backup] restore with: FC_DB_URL="<target>" npm run db:restore -- "${outFile}" --yes`)
}

main()
