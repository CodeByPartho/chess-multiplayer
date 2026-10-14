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

- Free-tier limits: Netlify (100 GB bandwidth/mo), Supabase (500 MB DB, projects pause after
  ~1 week inactive — restore from the dashboard when needed).
- The site's `chess-multiplayer-788.netlify.app` address works immediately; a custom domain
  costs extra. To switch the slug, rename the site in Netlify settings.
- Moving the Git integration to Netlify's native GitHub integration (for deploy previews)
  is optional — Settings → Build & deploy → Link repository in the Netlify UI.
