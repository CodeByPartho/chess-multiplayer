# Chess Multiplayer

Realtime multiplayer chess. Free-tier stack, no API keys to pay for.

| Piece | Service | Notes |
|---|---|---|
| Frontend hosting | **Netlify** — https://chess-multiplayer-788.netlify.app | Static build (Vite). The name `chess-multiplayer` was taken, hence `-788`. |
| Code + auto-deploy | **GitHub** — https://github.com/CodeByPartho/chess-multiplayer | Every push to `main` deploys. |
| Realtime backend | **Supabase** — https://supabase.com/dashboard/project/vtyksxibpkstzjnjcyzs | Postgres + Realtime + anon guest sign-in + Edge Functions (project `chess-multiplayer`, Singapore). |
| Chess rules | **chess.js** | Runs client-side. |
| Engine | **Stockfish 19 WASM** (lite, single-threaded, 1.8 MB) | Runs in the player's browser as a Web Worker. No server cost. |

## How deploy works

Push to `main` → GitHub Actions (`.github/workflows/deploy.yml`) → `npm ci` →
`netlify deploy --prod`, which runs the `netlify.toml` build command and uploads `dist/`.
The Supabase credentials are injected by Netlify from the **site environment variables**
(dashboard → Site configuration → Environment variables), so they never live in GitHub.

Local deploy without git: `netlify deploy --prod` (uses your logged-in CLI).

### DDoS / request-per-IP (optional owner action — Cloudflare)

The honest story: Netlify applies platform-level abuse protection and per-plan edge
rate limiting, but that is **not** a configurable per-IP WAF on the free plan. The
app's real defense layer is Supabase RLS + per-user RPC rate limits (below), not the
CDN. If you ever need real per-IP filtering or DDoS mitigation, put Cloudflare's free
proxy in front of the site — dashboard work only, no code change:

1. Create a free Cloudflare account and **add your own domain** (the
   `*.netlify.app` address cannot be proxied — a custom domain on Netlify is a
   prerequisite, e.g. `chess.example.com`).
2. Point the domain's nameservers at the pair Cloudflare shows.
3. In Netlify: Domain management → add that custom domain → set it as the primary
   address (keep the netlify.app address as an alias).
4. In Cloudflare DNS, make sure the record for the domain is **Proxied** (orange
   cloud) — that is what activates Cloudflare's DDoS mitigation and WAF.
5. Optional hardening in Cloudflare: Security → Bot Fight Mode (free), Security
   Level Medium, and a rate-limiting rule on `/login*` if sign-up abuse appears.
6. Nothing else changes: Netlify still serves the app behind the proxy, and the
   security headers below pass through untouched.

## Environment

- **Local dev**: copy `.env.example` to `.env` and fill in the values (already done on the
  setup machine — `.env` also records the database password; move it to a password manager).
- **CI/production**: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set on the Netlify
  site itself. The anon key is public by design (it ships in the browser bundle); security
  comes from Supabase Row Level Security policies.
- **Optional**: `VITE_TURNSTILE_SITE_KEY` (Cloudflare Turnstile, set on Netlify) enables the
  sign-up captcha; the CSP in `netlify.toml` already allows the Turnstile script + iframe.

## Security

### Response headers (`netlify.toml`)

Every response ships `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` (camera / microphone / geolocation / payment / usb all off),
`Cross-Origin-Opener-Policy: same-origin`, and an enforcing Content-Security-Policy:

- `default-src 'self'` — everything is opt-in.
- `script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com` — the
  Stockfish engine compiles WASM in the browser; Turnstile loads its widget script.
- `style-src 'self' 'unsafe-inline'` — React inline styles.
- `img-src 'self' data: blob: https://*.supabase.co` — identicons are `data:` URLs,
  upload previews `blob:`, avatars come from Supabase Storage.
- `connect-src 'self' https://*.supabase.co wss://*.supabase.co
  https://challenges.cloudflare.com` — REST + Realtime (+ Turnstile verification).
- `frame-src https://challenges.cloudflare.com`, `worker-src 'self' blob:`,
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `frame-ancestors 'none'`.

The CSP was first shipped as `Content-Security-Policy-Report-Only` and only made
enforcing after a production build was served with these exact headers and walked
through the real flows — home boot, a move against the computer (proving the worker +
WASM compile under it), the matchmaking queue with Realtime, puzzles, and the sign-in
screen incl. Turnstile — with zero CSP violations. If a future change gets blocked,
read the violation in the browser console, fix the source, and never add
`'unsafe-inline'` to `script-src`.

### Server-side rate limits

Hot RPCs carry per-user ceilings enforced in Postgres itself (`rate_limits` table +
`public.rate_check()`, migration 0019) — a script cannot bypass the client-side pacing:

| RPC / path | Ceiling |
|---|---|
| `queue_match` | 60 / min |
| `sync_guest` | 30 / min (silent skip — identity heartbeats) |
| `touch_guest` | 60 / min (silent skip) |
| `check_username` | 120 / min |
| `update_username` | 10 / h **and** 5 / day |
| `claim_username` | 10 / h |
| report (edge function) | 5 / h |
| `record_puzzle_result` | 30 / min + daily cap (already server-side since 0013) |

Counters are readable only by their owner; only SECURITY DEFINER code and the service
role may write them. Reports have exactly one writer: the edge function checks that
the game exists, that the caller played it, and that the target is the opponent — the
old client-side insert policy was dropped entirely.

### Avatars (Storage)

The public-read `avatars` bucket accepts writes only into `avatars/<your-uid>/...`
(insert/update/delete policies check the folder owner), with a 1 MB size cap and a
JPEG/WebP/PNG mime allowlist. The client downscales every image to a 256×256
center-crop before uploading, so what land are small files; `profiles.avatar_path`
only ever stores paths matching your uid.

### Auth (dashboard settings, owner)

Rate limits and bot checks for sign-in itself live in the Supabase dashboard:
Authentication → **Rate Limits** (keep the built-ins on; the anonymous-sign-in cap is
the one that matters for guests) and Authentication → **Settings** for manual
linking / Turnstile. Deny-by-default applies everywhere else: no client role can
write ratings, results, histories, reports or rate-limit counters directly, and
`EXECUTE` is granted to `authenticated` only for the allowlisted RPCs.

### Chat

In-game chat is a Supabase Realtime **broadcast** channel — nothing is ever stored.
The client paces sends (650 ms minimum gap, 6 messages / 10 s burst), filters
profanity, caps message length at 300 chars, and validates + bounds every *received*
payload before rendering it as plain text. Supabase caps per-connection message rate
at the platform level; there is no server-side database to sanitize because nothing
is persisted.

## Testing

| Suite | Command | Touches |
|---|---|---|
| Types | `npm run typecheck` | nothing |
| Unit + integration (Glicko, RPCs, rate limits, RLS/storage policies) | `npm test` | a local/temporary Postgres via `FC_TEST_DB_URL` (hard guard against production) |
| End-to-end (Playwright) | `npm run test:e2e` | a **dedicated test Supabase project** — never production |
| Read-only production smoke | `FC_PROD_SMOKE=1 npm run test:e2e -- prod-smoke` | live site, GET only |

### Running the e2e suite without touching production

The e2e specs create anonymous users, games, lobby rows and rating rows, so they
only run against a dedicated test backend, selected by **TEST-only** values
(`.env.test`, git-ignored — copy `.env.test.example`):

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
- **The app under test is served with the test project's public URL + anon key**
  (the dev server gets those as real environment variables, which win over `.env`),
  and the server is never reused across runs.
- **Cleanup**: `e2e/global-teardown.ts` deletes everything the run created in the
  test backend (users, guests, games, lobby rows, ratings/rating-history, profiles,
  puzzle results, reports) and prints the counts. It refuses to run if the backend
  changed between setup and teardown.
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

`FC_DB_URL` is always **your own** connection string; it is only exported into the
child process environment, so the password never appears in process listings.

```bash
# one-command dump → backups/fc-backup-<UTC timestamp>.dump (git-ignored)
FC_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  npm run db:backup

# include the accounts (auth schema) too
FC_DB_URL="..." npm run db:backup -- --with-auth

# inspect a dump without touching any database
npm run db:restore -- backups/fc-backup-<…>.dump --list
```

Requires the PostgreSQL client tools (`pg_dump`/`pg_restore`) — the script finds
them on `PATH` or in the usual install locations, or you can point at one with
`PG_DUMP=` / `PG_RESTORE=`. Install with `winget install PostgreSQL.PostgreSQL.17`
(Windows), `brew install libpq` (macOS) or `apt-get install postgresql-client-17`.

### Restoring

```bash
# rehearse against a throwaway database first (strongly recommended)
FC_RESTORE_DB_URL="postgresql://…/<throwaway>" npm run db:restore -- backups/<file>.dump --yes

# or restore for real
FC_DB_URL="postgresql://…/<target>" npm run db:restore -- backups/<file>.dump --yes
```

- `--yes` is required: `pg_restore --clean --if-exists` drops and recreates the
  objects contained in the dump.
- Restore into a **Supabase** project (or any database that already has the `auth`
  schema and `auth.uid()`): the app tables reference `auth.users`, and the RLS
  policies call `auth.uid()`. A vanilla Postgres target needs `create schema auth;`
  plus a minimal `auth.users`/`auth.uid()` first.
- The default dump covers the `public` schema — tables, RLS policies, functions and
  data. Accounts live in `auth` (`--with-auth`); restore those only into an empty
  database, since the rows are GoTrue's own.
- A verified rehearsal (scratch cluster, empty target + auth stub): 0 restore
  errors, 15 functions, 14 policies, and pre-dump rows present afterwards.

## Keeping the free project awake

`.github/workflows/keep-alive.yml` sends one read-only request every 3 days (a
site GET plus a `SELECT` through the data API) so the free Supabase project is not
paused for inactivity. Add these in **Settings → Secrets and variables → Actions**
(nothing secret is hardcoded in the workflow):

| Name | Value |
|---|---|
| `FC_PROD_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `FC_PROD_SUPABASE_ANON_KEY` | the public anon key |
| `FC_PROD_SITE_URL` (optional) | defaults to `https://chess-multiplayer-788.netlify.app` |

It can also be triggered by hand from the Actions tab (useful after GitHub
disables schedules for a repo that has been idle for 60 days).

## Engine

`npm run engine:sync` copies `stockfish-19-lite-single.{js,wasm}` from `node_modules/stockfish`
into `public/engine/` (runs automatically before every build). `src/engine.js` wraps the worker
in a small UCI API: `createEngine()` → `engine.analyze(fen, depth)` → `{ bestmove }`.

## Project layout

```
src/main.js        app entry — Supabase client, game instance, status line
src/engine.js      Stockfish worker wrapper (UCI)
scripts/sync-stockfish.mjs   copies the engine build into public/
supabase/          CLI project config (supabase link --project-ref vtyksxibpkstzjnjcyzs)
.github/workflows/deploy.yml the auto-deploy pipeline
```

## Notes

- Free-tier limits: Netlify (100 GB bandwidth/mo), Supabase (500 MB DB). Supabase pauses a
  free project after ~1 week without activity — the keep-alive workflow above prevents that;
  if it does pause, restore it from the dashboard (and re-run the workflow afterwards).
- The site's `chess-multiplayer-788.netlify.app` address works immediately; a custom domain
  costs extra. To switch the slug, rename the site in Netlify settings.
- Moving the Git integration to Netlify's native GitHub integration (for deploy previews)
  is optional — Settings → Build & deploy → Link repository in the Netlify UI.
