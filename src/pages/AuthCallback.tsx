import { useEffect, useState } from 'react'
import { useRoute, Link } from '@/router'
import { handleCallbackCode } from '@/components/AuthPanel'
import { takeUpgradeNotice } from '@/net/auth'

/**
 * OAuth / PKCE landing page.
 *
 * - popup context: completes the exchange, tells the opener, closes itself.
 * - top-level: completes the exchange and lands on `next` with a fresh load
 *   (so the app boots on the new session — no stale in-memory state).
 * - provider errors (denied, expired link, mismatch): friendly error card.
 */
export default function AuthCallback() {
  const { path } = useRoute()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (done) return
    let dead = false
    const search = window.location.search
    const params = new URLSearchParams(search)
    const code = params.get('code')
    const oauthError = params.get('error_description') || params.get('error')
    const next = sanitizeNext(params.get('next') || '/')

    const inPopup = !!window.opener && window.self !== window.top

    if (oauthError) {
      const msg = friendlyOAuthError(oauthError)
      if (inPopup) {
        window.opener.postMessage({ type: 'fc-auth', error: msg }, window.location.origin)
        setError(msg)
      } else {
        setError(msg)
      }
      return
    }

    if (!code) {
      setError('This sign-in link is invalid or has expired — try again.')
      return
    }

    void handleCallbackCode(code).then((err) => {
      if (dead) return
      if (err) {
        const msg = friendlyOAuthError(err)
        if (inPopup) window.opener.postMessage({ type: 'fc-auth', error: msg }, window.location.origin)
        setError(msg)
        return
      }
      setDone(true)
      if (inPopup) {
        // the opener owns the page: it reloads onto the new session and
        // closes this window; if that never happens, show a close hint
        window.opener.postMessage({ type: 'fc-auth' }, window.location.origin)
        window.close()
        window.setTimeout(() => {
          if (!window.closed) setError('__close_hint__')
        }, 800)
        return
      }
      window.location.replace(next)
    })
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  if (error) {
    const closeHint = error === '__close_hint__'
    return (
      <div className="center-page">
        <div className="card auth-card">
          <div style={{ fontSize: 40 }}>🔐</div>
          <h1 style={{ margin: '4px 0' }}>{closeHint ? 'You’re signed in!' : 'Sign-in didn’t finish'}</h1>
          <p className="auth-note">{closeHint ? 'You can close this window.' : error}</p>
          <div className="auth-row" style={{ justifyContent: 'center' }}>
            <Link to="/login" className="btn btn-primary">
              Try again
            </Link>
            <Link to="/" className="btn btn-ghost">
              Back home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="center-page">
      <div className="spinner" aria-label="Completing sign-in" />
      <p className="auth-note">Finishing sign-in…</p>
    </div>
  )
}

/** only same-origin absolute paths may be used as a redirect target */
function sanitizeNext(next: string): string {
  if (!next.startsWith('/') || next.startsWith('//')) return '/'
  return next
}

function friendlyOAuthError(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes('expired') || s.includes('otp')) return 'That link expired — request a new code and try again.'
  if (s.includes('access_denied') || s.includes('denied')) return 'The provider denied the request — you can cancel and try again.'
  if (s.includes('provider') && s.includes('not')) return 'That sign-in provider isn’t enabled yet — email sign-in still works.'
  if (s.includes('same') || s.includes('different')) return 'That account is already linked to another user — sign in to it instead.'
  if (s.includes('code') && s.includes('verifier')) return 'The sign-in session was interrupted — try again from the start.'
  return raw.replace(/_/g, ' ')
}

/** one-time notice carried across the redirect (unused placeholder) */
export function readAuthNotice(): string | null {
  return takeUpgradeNotice()
}
