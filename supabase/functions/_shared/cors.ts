// CORS + JSON helpers shared by every function.
//
// Origins are pinned to an allowlist (the production site + local dev).
// The old wildcard let any website call these functions with a visitor's
// session token, so the request Origin is now reflected only when it is
// on the list; anything else gets the production origin, which the
// browser will not accept for cross-origin reads from another site.
const ALLOWED_ORIGINS = new Set([
  'https://playfreechess.netlify.app',
  'https://chess-multiplayer-788.netlify.app',
  'http://localhost:5173',
  'http://localhost:3000',
])
const DEFAULT_ORIGIN = 'https://chess-multiplayer-788.netlify.app'

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

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

export function bad(req: Request, message: string, status = 400): Response {
  return json(req, { error: message }, status)
}
