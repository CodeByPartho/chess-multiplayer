# FreeChess

I wanted a chess site where my friends and I could start a game in two clicks —
no signup wall, no ads, no engine locked behind a subscription. So this runs on
free tiers end to end: a static Vite app on Netlify, a Supabase project for
Postgres + Realtime + anonymous sign-ins, and Stockfish in the browser as a Web
Worker. There is no API key anywhere in this repo that costs money.

- live site: https://chess-multiplayer-788.netlify.app
- code: https://github.com/CodeByPartho/chess-multiplayer
- backend: https://supabase.com/dashboard/project/vtyksxibpkstzjnjcyzs

The `-788` is on the site name because `chess-multiplayer` was taken.

## Quick start

```bash
npm install
cp .env.example .env      # fill in your Supabase URL + anon key
npm run dev
```

The app talks to whatever project `.env` points at, so don't point local
experiments at production by accident. (My `.env` also has the database
password in it — it belongs in a password manager; the file is git-ignored,
but still.)

## How deploy works

Push to `main` → GitHub Actions (`.github/workflows/deploy.yml`) runs `npm ci`
and `netlify deploy --prod`, which builds through `netlify.toml` and uploads
`dist/`. The Supabase credentials come from Netlify's site environment
variables (dashboard → Site configuration → Environment variables), so they
never live in GitHub.

Local deploy without git: `netlify deploy --prod` from my logged-in CLI.

### DDoS / request-per-IP (owner action — Cloudflare)

Honest version first: Netlify's free plan has platform-level abuse protection,
but it is not a configurable per-IP WAF. The real defense here is Supabase RLS
plus per-user rate limits inside the RPCs (see Security below), not the CDN.
If real per-IP filtering is ever needed, the free-tier answer is Cloudflare in
front of the site — all dashboard work, no code change:

1. Make a free Cloudflare account and add a domain I own — the `*.netlify.app`
   address can't be proxied, so a custom domain on Netlify comes first.
2. Point that domain's nameservers at the pair Cloudflare shows.
3. In Netlify: Domain management → add the custom domain → set it as primary
   (the netlify.app address stays as an alias).
4. In Cloudflare DNS, make sure the record is **Proxied** (orange cloud) —
   that's what switches on DDoS mitigation and the WAF.
5. Optional: Security → Bot Fight Mode (free), Security Level Medium, and a
   rate-limit rule on `/login*` if sign-up abuse ever shows up.
6. Nothing else changes: Netlify still serves the app, and the security
   headers below pass through untouched.

## Environment

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are all the frontend needs.
Locally they live in `.env`; in production they're set on the Netlify site.
The anon key is public by design (it ships in the bundle) — the security model
is Row Level Security, not hiding the key.

`VITE_TURNSTILE_SITE_KEY` (Cloudflare Turnstile) is optional. Set it on
Netlify to turn the sign-up captcha on; the CSP already allows the Turnstile
script and iframe either way.

## Security

### Response headers

`netlify.toml` sets these on every response: HSTS,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy`
that turns off camera / microphone / geolocation / payment / usb,
`Cross-Origin-Opener-Policy: same-origin`, and an enforcing CSP:

- `default-src 'self'` — everything else is opt-in
- `script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com` —
  Stockfish compiles WASM in the browser; Turnstile loads its widget script
- `style-src 'self' 'unsafe-inline'` — React inline styles
- `img-src 'self' data: blob: https://*.supabase.co` — identicons are `data:`
  URLs, upload previews are `blob:`, avatars come from Storage
- `connect-src 'self' https://*.supabase.co wss://*.supabase.co
  https://challenges.cloudflare.com` — REST + Realtime
- `frame-src` only Cloudflare; `worker-src 'self' blob:`; `object-src 'none'`;
  `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`

I shipped the CSP as report-only first and only flipped it to enforcing after
serving a production build with these exact headers and walking the real
flows against it — home, an engine move against the computer (worker + WASM),
the matchmaking queue with Realtime, puzzles, and sign-in with Turnstile — with
zero violations. If a future change gets blocked, the browser console names
the exact directive; fix the source instead of adding `'unsafe-inline'` to
`script-src`.

### Rate limits

Every hot RPC carries a per-user ceiling in Postgres itself (`rate_limits`
table + `public.rate_check()`, migration 0019), so nothing depends on
client-side pacing:

| call | ceiling |
|---|---|
| `queue_match` | 60 / min |
| `sync_guest` | 30 / min — silent skip (identity heartbeats) |
| `touch_guest` | 60 / min — silent skip |
| `check_username` | 120 / min |
| `update_username` | 10 / h and 5 / day |
| `claim_username` | 10 / h |
| report edge function | 5 / h |
| `record_puzzle_result` | 30 / min + a daily cap (server-side since 0013) |

Counters are readable only by their owner, and only SECURITY DEFINER code and
the service role can write them. Reports have exactly one writer: the report
edge function checks that the game exists, that the caller played it, and that
the target is the opponent. The old client-side insert path was dropped.

### Avatars

The `avatars` storage bucket is public-read, but writes must land under
`avatars/<your-uid>/...` — the insert/update/delete policies check the folder
owner. 1 MB cap, JPEG/WebP/PNG only. The client center-crops and downscales
every image to 256×256 before upload, and `profiles.avatar_path` only ever
stores a path matching your own uid.

### Auth dashboard settings to keep an eye on

Sign-in rate limits and bot checks live in the Supabase dashboard:
Authentication → **Rate Limits** (the anonymous-sign-in cap is the one that
matters for guests) and Authentication → **Settings** (manual linking,
Turnstile). Everything else is deny-by-default: no client role can write
ratings, results, histories, reports or rate-limit counters directly, and
`EXECUTE` is granted to `authenticated` only for the allowlisted RPCs.

### Chat

In-game chat is a Realtime broadcast channel — nothing is ever stored, so
there is no server-side database to sanitize. The client paces sends (650 ms
minimum gap, 6 per 10 s), filters profanity, caps messages at 300 characters,
and bounds every *received* payload before rendering it as plain text.
Supabase caps per-connection message rate at the platform level.

## Testing

| Suite | Command | Touches |
|---|---|---|
| Types | `npm run typecheck` | nothing |
| Unit + integration (Glicko, RPCs, rate limits, RLS/storage policies) | `npm test` | a local/temporary Postgres via `FC_TEST_DB_URL` (hard guard against production) |
| End-to-end (Playwright) | `npm run test:e2e` | a **dedicated test Supabase project** — never production |
| Read-only production smoke | `FC_PROD_SMOKE=1 npm run test:e2e -- prod-smoke` | live site, GET only |

### Running the e2e suite without touching production

The e2e specs create anonymous users, games, lobby rows and rating rows, so
they only run against a dedicated test backend, selected by **TEST-only**
values (`.env.test`, git-ignored — copy `.env.test.example`):

```
FC_TEST_SUPABASE_URL=https://<test-ref>.supabase.co
FC_TEST_SUPABASE_ANON_KEY=<public anon key>
FC_TEST_DB_URL=postgresql://postgres.<test-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
FC_TEST_SERVICE_KEY=<service_role key>        # alternative to FC_TEST_DB_URL
```

- **Hard guard** (`e2e/test-backend.ts`, called from `playwright.config.ts` and
  `e2e/global-setup.ts`): if nothing is configured, or any value references the
  production ref `vtyksxibpkstzjnjcyzs`, the run refuses to start. There is no
  fallback to `.env`.
- The app under test is served with the test project's public URL + anon key
  (real environment variables win over `.env`), and the dev server is never
  reused across runs.
- **Cleanup**: `e2e/global-teardown.ts` deletes everything the run created in
  the test backend (users, guests, games, lobby rows, ratings/rating-history,
  profiles, puzzle results, reports, uploaded avatars — the last one through
  the Storage API, since hosted projects block direct SQL writes to storage
  tables) and prints the counts. It refuses to run if the backend changed
  between setup and teardown.
- `e2e/flow-test-backend.spec.ts` asserts the page really is bound to the test
  project ref and that no production session key exists.

Provisioning a test project from scratch (one-off):

```
supabase projects create chess-multiplayer-test --org-id <org> --db-password '<pw>'
supabase config push --project-ref <test-ref>           # enables anonymous sign-ins
supabase db push --db-url "postgresql://postgres.<test-ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres"
supabase functions deploy game-create game-join game-action report --project-ref <test-ref>
```

## Backups

`FC_DB_URL` is always **your own** connection string; it is only exported into
the child process environment, so the password never shows up in process
listings.

```bash
# one-command dump → backups/fc-backup-<UTC timestamp>.dump (git-ignored)
FC_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  npm run db:backup

# include the accounts (auth schema) too
FC_DB_URL="..." npm run db:backup -- --with-auth

# inspect a dump without touching any database
npm run db:restore -- backups/fc-backup-<…>.dump --list
```

Needs the PostgreSQL client tools (`pg_dump`/`pg_restore`). The script looks on
`PATH` and the usual install locations, or point at them with `PG_DUMP=` /
`PG_RESTORE=`. Install: `winget install PostgreSQL.PostgreSQL.17` (Windows),
`brew install libpq` (macOS), `apt-get install postgresql-client-17` (Debian/Ubuntu).

### Restoring

```bash
# rehearse against a throwaway database first (strongly recommended)
FC_RESTORE_DB_URL="postgresql://…/<throwaway>" npm run db:restore -- backups/<file>.dump --yes

# or restore for real
FC_DB_URL="postgresql://…/<target>" npm run db:restore -- backups/<file>.dump --yes
```

- `--yes` is required: `pg_restore --clean --if-exists` drops and recreates the
  objects contained in the dump.
- Restore into a **Supabase** project (or any database that already has the
  `auth` schema and `auth.uid()`): the app tables reference `auth.users`, and
  the RLS policies call `auth.uid()`. A vanilla Postgres target needs
  `create schema auth;` plus a minimal `auth.users`/`auth.uid()` first.
- The default dump covers `public` — tables, RLS policies, functions and data.
  Accounts live in `auth` (`--with-auth`); only restore those into an empty
  database, since the rows are GoTrue's own.
- The rehearsal I ran (scratch cluster, empty target + auth stub): 0 restore
  errors, 15 functions, 14 policies, and the pre-dump rows present afterwards.

## Keeping the free project awake

`.github/workflows/keep-alive.yml` sends one read-only request every 3 days (a
site GET plus a `SELECT` through the data API) so the free Supabase project
isn't paused for inactivity. Add these in **Settings → Secrets and variables →
Actions** (nothing secret is hardcoded in the workflow):

| secret | value |
|---|---|
| `FC_PROD_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `FC_PROD_SUPABASE_ANON_KEY` | the public anon key |
| `FC_PROD_SITE_URL` (optional) | defaults to `https://chess-multiplayer-788.netlify.app` |

It can also be run by hand from the Actions tab — useful after GitHub disables
schedules for a repo that's been idle for 60 days.

## Engine

`npm run engine:sync` copies `stockfish-19-lite-single.{js,wasm}` from
`node_modules/stockfish` into `public/engine/` (runs automatically before every
build). `src/engine/engine.ts` wraps the worker in a small UCI API:
`createEngine()` then `engine.analyze(fen, depth)`.

## What's where

```
src/main.tsx          entry point
src/App.tsx           shell, routes, nav
src/pages/            one file per route
src/net/              supabase client + every server call
src/lib/              identity, settings, avatars, small helpers
src/board/            board rendering + interaction
src/engine/           stockfish wrapper
supabase/migrations/  the database, in order (0019 is current)
supabase/functions/   edge functions (game-create/join/action, report)
e2e/                  playwright specs — test backend only, never prod
scripts/              engine sync, generators, db backup/restore
```

## Notes

- Free-tier limits: Netlify (100 GB bandwidth/mo), Supabase (500 MB DB).
  Supabase pauses a free project after ~1 week of inactivity — the keep-alive
  workflow prevents that; if it does pause, unpause it from the dashboard and
  re-run the workflow.
- `chess-multiplayer-788.netlify.app` works as-is; a custom domain costs extra.
  To change the slug, rename the site in Netlify.
- Moving the Git integration to Netlify's native GitHub integration (for deploy
  previews) is optional: Settings → Build & deploy → Link repository.
