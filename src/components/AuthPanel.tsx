import { useEffect, useRef, useState } from 'react'
import {
  OAUTH_PROVIDERS,
  TURNSTILE_SITE_KEY,
  completeAuthCallback,
  isEmail,
  sendEmailOtp,
  startProviderPopup,
  startProviderRedirect,
  upgradeGuestEmail,
  verifyEmailOtp,
  verifyUpgradeEmail,
  type OAuthProvider,
} from '@/net/auth'
import { ensureAuth, onlineEnabled } from '@/net/supabase'
import { setUpgradeNotice } from '@/net/auth'
import { TurnstileWidget } from './Turnstile'
import { Link } from '@/router'

type View = 'main' | 'email' | 'code'
export type AuthPurpose = 'signin' | 'upgrade'

/**
 * The shared authentication panel — used by the header modal and /login.
 *
 * upgrade: create an account *from the current guest* (same user id, so
 * rating + games carry over) via linkIdentity / email_change OTP.
 * signin: enter an existing account (OAuth popup or email OTP), replacing
 * the guest session — the guest stays behind untouched.
 */
export function AuthPanel({
  purpose: initialPurpose,
  next,
  onDone,
}: {
  purpose: AuthPurpose
  next?: string
  onDone?: () => void
}) {
  const [purpose, setPurpose] = useState<AuthPurpose>(initialPurpose)
  const [view, setView] = useState<View>('main')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState('')
  const [sentTo, setSentTo] = useState('')
  const captchaRef = useRef<{ reset: () => void } | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const fail = (msg: string | null) => {
    if (aliveRef.current) setError(msg)
  }

  const finish = () => {
    onDone?.()
    window.location.reload()
  }

  const runProvider = async (provider: OAuthProvider) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (purpose === 'upgrade') {
        await ensureAuth() // make sure the guest session exists to link onto
        const r = await startProviderRedirect(provider, { upgrade: true, next })
        if (r.ok) return // navigating away
        if (r.code === 'already_exists') {
          // the provider belongs to a different account — offer the switch path
          setUpgradeNotice(
            'That sign-in belongs to another account. Your guest profile — name, rating and games — stays here as its own guest.',
          )
          setPurpose('signin')
          setNotice('Continuing will switch to that account. Your guest stays on this device as a guest.')
          const r2 = await startProviderPopup(provider, next)
          if (r2.ok) return finish()
          if (r2.error === 'popup_closed') return fail('The sign-in window was closed before finishing.')
          return fail(r2.error ?? 'Sign-in failed — try again.')
        }
        return fail(r.error ?? 'Could not start sign-in.')
      }

      const r = await startProviderPopup(provider, next)
      if (r.ok) return finish()
      if (r.error === 'popup_closed') return fail('The sign-in window was closed before finishing.')
      return fail(r.error ?? 'Could not start sign-in.')
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }

  const sendCode = async () => {
    if (busy || !isEmail(email)) {
      if (!isEmail(email)) setError('Enter a valid email address')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (purpose === 'upgrade') {
        await ensureAuth()
        const r = await upgradeGuestEmail(email.trim())
        if (!r.ok) return fail(r.error ?? 'Could not send the code')
      } else {
        const r = await sendEmailOtp(email.trim(), captchaToken || undefined)
        if (!r.ok) {
          captchaRef.current?.reset()
          setCaptchaToken('')
          return fail(r.error ?? 'Could not send the code')
        }
      }
      if (!aliveRef.current) return
      setSentTo(email.trim())
      setCode('')
      setView('code')
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }

  const checkCode = async () => {
    const token = code.trim()
    if (busy) return
    if (token.length < 6) {
      setError('Enter the 6-digit code')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r =
        purpose === 'upgrade'
          ? await verifyUpgradeEmail(sentTo, token)
          : await verifyEmailOtp(sentTo, token)
      if (!r.ok) return fail(r.error ?? 'That code did not work — check it and try again.')
      finish()
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }

  if (!onlineEnabled) {
    return (
      <p className="auth-note">
        Online play isn&apos;t configured on this deployment — local games still work fine.
      </p>
    )
  }

  const title = purpose === 'upgrade' ? 'Create your account' : 'Welcome back'
  const sub =
    purpose === 'upgrade'
      ? 'Keep your guest name, rating and games — they move with you.'
      : 'Sign in to your profile, ratings and game archive.'

  return (
    <div className="auth-panel">
      <p className="auth-sub">{title}</p>
      <p className="auth-note">{notice ?? sub}</p>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      {view === 'main' && (
        <div className="auth-providers">
          {OAUTH_PROVIDERS.map((p) => (
            <button
              key={p.id}
              className="btn btn-ghost auth-provider"
              onClick={() => void runProvider(p.id)}
              disabled={busy}
            >
              <span className="auth-provider-icon" aria-hidden="true">
                {p.id === 'google' ? 'G' : p.id === 'discord' ? 'D' : '⌥'}
              </span>
              {busy ? 'Working…' : `Continue with ${p.label}`}
            </button>
          ))}
          <button
            className="btn btn-primary"
            onClick={() => {
              setError(null)
              setView('email')
            }}
            disabled={busy}
          >
            Continue with email
          </button>
        </div>
      )}

      {view === 'email' && (
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault()
            void sendCode()
          }}
        >
          <label className="field-label" htmlFor="auth-email">
            Email address
          </label>
          <input
            id="auth-email"
            className="input"
            type="email"
            autoFocus
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {TURNSTILE_SITE_KEY && (
            <TurnstileWidget sitekey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} refCb={captchaRef} />
          )}
          <div className="auth-row">
            <button type="button" className="btn btn-ghost" onClick={() => setView('main')} disabled={busy}>
              Back
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || (TURNSTILE_SITE_KEY !== '' && !captchaToken)}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </div>
        </form>
      )}

      {view === 'code' && (
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault()
            void checkCode()
          }}
        >
          <p className="auth-note">
            We sent a 6-digit code to <b>{sentTo}</b>. It expires in a few minutes.
          </p>
          <label className="field-label" htmlFor="auth-code">
            Verification code
          </label>
          <input
            id="auth-code"
            className="input auth-code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            autoFocus
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
          />
          <div className="auth-row">
            <button type="button" className="btn btn-ghost" onClick={() => setView('email')} disabled={busy}>
              Use a different email
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </div>
        </form>
      )}

      <div className="auth-switch">
        {purpose === 'upgrade' ? (
          <button
            className="link-btn"
            onClick={() => {
              setPurpose('signin')
              setError(null)
              setNotice(null)
              setView('main')
            }}
          >
            Already have an account? Sign in
          </button>
        ) : (
          <button
            className="link-btn"
            onClick={() => {
              setPurpose('upgrade')
              setError(null)
              setNotice(null)
              setView('main')
            }}
          >
            New here? Create an account
          </button>
        )}
      </div>

      <p className="auth-legal">
        By continuing you agree to our <Link to="/terms">Terms</Link> and{' '}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </div>
  )
}

/** completes a PKCE exchange — shared by the callback page and popup */
export async function handleCallbackCode(code: string): Promise<string | null> {
  const r = await completeAuthCallback(code)
  return r.ok ? null : r.error ?? 'Could not complete sign-in'
}
