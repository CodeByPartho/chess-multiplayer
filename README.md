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

## Environment

- **Local dev**: copy `.env.example` to `.env` and fill in the values (already done on the
  setup machine — `.env` also records the database password; move it to a password manager).
- **CI/production**: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set on the Netlify
  site itself. The anon key is public by design (it ships in the browser bundle); security
  comes from Supabase Row Level Security policies.

## Testing

| Suite | Command | Touches |
|---|---|---|
| Types | `npm run typecheck` | nothing |
| Unit + integration (Glicko, policies, RPCs) | `npm test` | a local/temporary Postgres via `FC_TEST_DB_URL` (hard guard against production) |
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
