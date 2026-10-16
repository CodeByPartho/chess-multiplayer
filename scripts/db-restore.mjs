#!/usr/bin/env node
/**
 * Restore a dump created by `npm run db:backup`.
 *
 *   # inspect what is inside without touching a database
 *   npm run db:restore -- backups/fc-backup-2026-10-16_20-30-00.dump --list
 *
 *   # restore into the database named by FC_DB_URL (destructive!)
 *   FC_DB_URL="postgresql://..." npm run db:restore -- backups/<file>.dump --yes
 *
 * Safety:
 *   • refuses to run without `--yes` (restoring rewrites the target schema)
 *   • `FC_RESTORE_DB_URL` overrides the destination, so a backup can be
 *     rehearsed against a throwaway/test database first
 *   • the connection string is only passed through PG* environment variables
 *
 * Restore order on Supabase: this uses `--clean --if-exists`, which drops and
 * recreates the objects in the dump. The `public` schema (tables, policies,
 * RPCs) is what the app needs; `auth` holds the accounts (dump with
 * `db:backup --with-auth`).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

function fail(message) {
  console.error(`\n  ✖ ${message}\n`)
  process.exit(1)
}

function findTool(name, envKey) {
  if (process.env[envKey]) return process.env[envKey]
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const found = execFileSync(which, [exe], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0]
    if (found) return found
  } catch {
    /* fall through to install locations */
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
  fail(`${name} not found — install the PostgreSQL client tools (see npm run db:backup output).`)
}

function connectionEnv(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    fail('FC_DB_URL is not a valid URL')
  }
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '') || 'postgres'),
    PGSSLMODE: process.env.PGSSLMODE ?? 'require',
  }
}

function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) fail('usage: npm run db:restore -- backups/<file>.dump [--yes|--list]')
  const dump = resolve(file)
  if (!existsSync(dump)) fail(`dump not found: ${dump}`)

  if (args.includes('--list')) {
    const pgRestore = findTool('pg_restore', 'PG_RESTORE')
    const toc = execFileSync(pgRestore, ['--list', dump], { encoding: 'utf8' })
    const entries = toc.split(/\r?\n/).filter((line) => line && !line.startsWith(';'))
    console.log(`[db:restore] ${entries.length} archive entries in ${dump}`)
    console.log(toc.split(/\r?\n/).filter((l) => /TABLE DATA|FUNCTION|POLICY/.test(l)).slice(0, 15).join('\n'))
    return
  }

  const target = process.env.FC_RESTORE_DB_URL ?? process.env.FC_DB_URL
  if (!target) {
    fail(
      'FC_DB_URL (or FC_RESTORE_DB_URL for a rehearsal target) is not set. Example:\n' +
        '    FC_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" npm run db:restore -- backups/<file>.dump --yes',
    )
  }
  if (!args.includes('--yes')) {
    fail(
      `about to restore ${dump} into the database in ${process.env.FC_RESTORE_DB_URL ? 'FC_RESTORE_DB_URL' : 'FC_DB_URL'}.\n` +
        '    This drops and recreates every object contained in the dump.\n' +
        '    Re-run with --yes to proceed (or FC_RESTORE_DB_URL=<throwaway> to rehearse).',
    )
  }

  const pgRestore = findTool('pg_restore', 'PG_RESTORE')
  console.log(`[db:restore] ${pgRestore}  ←  ${dump} (${(statSync(dump).size / 1024 / 1024).toFixed(2)} MB)`)
  const env = { ...process.env, ...connectionEnv(target) }
  execFileSync(
    pgRestore,
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--verbose',
      // only the database name goes on the command line; host/port/user/password
      // travel through the PG* environment so no credential is ever in argv
      '--dbname',
      env.PGDATABASE,
      dump,
    ],
    { env, stdio: ['ignore', 'inherit', 'inherit'] },
  )
  console.log('[db:restore] done')
}

main()
