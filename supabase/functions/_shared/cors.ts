// CORS + JSON helpers shared by every function.
//
// Origins are pinned to an allowlist (the production site + local dev).
// The old wildcard let any website call these functions with a visitor's
// session token, so the request Origin is now reflected only when it is
// on the list; anything else gets the production origin, which the
// browser will not accept for cross-origin reads from another site.
const ALLOWED_ORIGINS = new Set([
  'https://playfreechess-5a7.pages.dev',
  'https://playfreechess.netlify.app',
  'https://chess-multiplayer-788.netlify.app',
  'http://localhost:5173',
  'http://localhost:3000',
  // Playwright e2e: the test app is served on 5199 (playwright.config.ts)
  // and calls the test project's functions from that origin.
  'http://localhost:5199',
])
const DEFAULT_ORIGIN = 'https://playfreechess.netlify.app'

/** CORS headers for a request: reflect the Origin only when allowlisted. */
export function corsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

// Static default (production origin) for any legacy call site.
export const CORS_HEADERS: Record<string, string> = corsHeaders()

/** JSON response carrying this request's CORS headers. */
export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

/** Error response of the form { error: message } with CORS headers. */
export function bad(req: Request, message: string, status = 400): Response {
  return json(req, { error: message }, status)
}
