import { useEffect, useRef, useState } from 'react'
import {
  OAUTH_PROVIDERS,
  TURNSTILE_SITE_KEY,
  clearGuestSession,
  completeAuthCallback,
  createAccountWithEmail,
  isEmail,
  sendEmailOtp,
  setUpgradeNotice,
  signInPassword,
  startProviderPopup,
  startProviderRedirect,
  verifyEmailOtp,
  verifyUpgradeEmail,
  type OAuthProvider,
} from '@/net/auth'
import { ensureAuth, onlineEnabled } from '@/net/supabase'
import { checkUsernameAvailable, claimUsername } from '@/net/profileClient'
import { loadIdentity, saveIdentity, validateUsername } from '@/lib/identity'
import { TurnstileWidget } from './Turnstile'
import { Link } from '@/router'

type View = 'main' | 'email' | 'code'
export type AuthPurpose = 'signin' | 'upgrade'
type Availability = { state: 'idle' | 'checking' | 'ok' | 'bad'; message?: string }

/**
 * Shared authentication panel — header modal and /login both mount this.
 *
 * upgrade: create an account out of the current guest. Email + password go
 *   through updateUser, which keeps the same user id, so rating and games
 *   carry over. Providers would need identity linking (see the message when
 *   the server has that off).
 * signin: enter an existing account. The guest session is dropped first —
 *   with a guest still active GoTrue tries to link the two users together
 *   and that is a server-side error ("Manual linking is disabled").
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
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [avail, setAvail] = useState<Availability>({ state: 'idle' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState('')
  const [sentTo, setSentTo] = useState('')
  const captchaRef = useRef<{ reset: () => void } | null>(null)
  const aliveRef = useRef(true)
  const checkSeq = useRef(0)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // live username availability while picking one (sign-up only)
  useEffect(() => {
    if (purpose !== 'upgrade') return
    const trimmed = name.trim()
    const seq = ++checkSeq.current
    if (validateUsername(trimmed)) {
      setAvail({ state: 'idle' })
      return
    }
    setAvail({ state: 'checking' })
    const t = window.setTimeout(() => {
      void checkUsernameAvailable(trimmed).then((reason) => {
        if (seq !== checkSeq.current) return
        setAvail(reason ? { state: 'bad', message: reason } : { state: 'ok' })
      })
    }, 350)
    return () => window.clearTimeout(t)
  }, [name, purpose])

  const fail = (msg: string | null) => {
    if (aliveRef.current) setError(msg)
  }

  const finish = () => {
    onDone?.()
    window.location.reload()
  }

  const switchPurpose = (p: AuthPurpose) => {
    setPurpose(p)
    setError(null)
    setNotice(null)
    setView('main')
  }

  const runProvider = async (provider: OAuthProvider) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (purpose === 'upgrade') {
        await ensureAuth() // the guest session is the user we're upgrading
        const r = await startProviderRedirect(provider, { upgrade: true, next })
        if (r.ok) return // navigating away
        if (r.code === 'linking_disabled') {
          return fail(
            `Linking ${provider} to a guest isn't switched on here yet — create your account with email + password instead. Your rating and games come along either way.`,
          )
        }
        if (r.code === 'already_exists') {
          // that provider belongs to a different account — offer the switch path
          setUpgradeNotice(
            'That sign-in belongs to another account. Your guest profile — name, rating and games — stays here as its own guest.',
          )
          setPurpose('signin')
          setNotice('Continuing will switch to that account. Your guest stays on this device as a guest.')
          await clearGuestSession()
          const r2 = await startProviderPopup(provider, next)
          if (r2.ok) return finish()
          if (r2.error === 'popup_closed') return fail('The sign-in window was closed before finishing.')
          return fail(r2.error ?? 'Sign-in failed — try again.')
        }
        return fail(r.error ?? 'Could not start sign-in.')
      }

      await clearGuestSession()
      const r = await startProviderPopup(provider, next)
      if (r.ok) return finish()
      if (r.error === 'popup_closed') return fail('The sign-in window was closed before finishing.')
      return fail(r.error ?? 'Could not start sign-in.')
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }

  /** sign-in by email code — a guest session must be gone first (see module docs) */
  const sendCode = async () => {
    if (busy || !isEmail(email)) {
      if (!isEmail(email)) setError('Enter a valid email address')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await clearGuestSession()
      const r = await sendEmailOtp(email.trim(), captchaToken || undefined)
      if (!r.ok) {
        captchaRef.current?.reset()
        setCaptchaToken('')
        return fail(r.error ?? 'Could not send the code')
      }
      if (!aliveRef.current) return
      setSentTo(email.trim())
      setCode('')
      setView('code')
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }

  /** sign-in with password */
  const signIn = async () => {
    if (busy) return
    if (!isEmail(email)) return setError('Enter a valid email address')
    if (!password) return setError('Enter your password')
    setBusy(true)
    setError(null)
    try {
      await clearGuestSession()
      const r = await signInPassword(email.trim(), password)
      if (!r.ok) {
        return fail(
          /invalid login/i.test(r.error ?? '')
            ? 'Wrong email or password. You can also sign in with a one-time code instead.'
            : (r.error ?? 'Could not sign in'),
        )
      }
      finish()
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }

  /** create the account from the guest, then claim the username */
  const createAccount = async () => {
    const trimmed = name.trim()
    if (busy) return
    const nameErr = validateUsername(trimmed)
    if (nameErr) return setError(nameErr)
    if (avail.state !== 'ok') return setError('Pick a username that is available')
    if (!isEmail(email)) return setError('Enter a valid email address')
    if (password.length < 6) return setError('Passwords need at least 6 characters')
    setBusy(true)
    setError(null)
    try {
      await ensureAuth() // every account starts as a guest; the id is what we keep
      const r = await createAccountWithEmail(email.trim(), password)
      if (!r.ok) {
        if (/already|registered|in use/i.test(r.error ?? '')) {
          setPurpose('signin')
          setNotice('That email already has an account — sign in with your password below.')
          return
        }
        return fail(r.error ?? 'Could not create the account')
      }
      if (r.needsCode) {
        setSentTo(email.trim())
        setCode('')
        setView('code')
        return
      }
      await finishAccount()
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }

  /** account exists now — claim the username so the profile is live */
  const finishAccount = async () => {
    const trimmed = name.trim()
    const identity = loadIdentity()
    const r = await claimUsername(trimmed, identity.avatarSeed, identity.flag)
    if (r.ok) {
      identity.username = trimmed
      saveIdentity(identity)
      window.dispatchEvent(new Event('fc:profile-changed'))
      finish()
      return
    }
    // the account is fine; the name just got taken in the meantime — the
    // onboarding dialog will offer another one
    setUpgradeNotice(`Your account is ready. "${trimmed}" was taken in the meantime — pick another username.`)
    finish()
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
      if (purpose === 'upgrade') {
        await finishAccount()
        return
      }
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

  const nameState =
    avail.state === 'checking'
      ? 'checking…'
      : avail.state === 'ok'
        ? 'available'
        : avail.state === 'bad'
          ? (avail.message ?? 'unavailable')
          : name.length > 0
            ? (validateUsername(name.trim()) ?? '')
            : ''

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
            void (purpose === 'upgrade' ? createAccount() : signIn())
          }}
        >
          {purpose === 'upgrade' && (
            <>
              <label className="field-label" htmlFor="auth-name">
                Username
              </label>
              <input
                id="auth-name"
                className="input"
                autoFocus
                maxLength={20}
                autoComplete="username"
                placeholder="e.g. KnightOwl42"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-describedby="auth-name-state"
                aria-invalid={avail.state === 'bad'}
              />
              <p
                id="auth-name-state"
                className={`field-hint ${avail.state === 'ok' ? 'ok' : avail.state === 'bad' ? 'bad' : ''}`}
                aria-live="polite"
              >
                {nameState}
              </p>
            </>
          )}

          <label className="field-label" htmlFor="auth-email">
            Email address
          </label>
          <input
            id="auth-email"
            className="input"
            type="email"
            autoFocus={purpose !== 'upgrade'}
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label className="field-label" htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            className="input"
            type="password"
            autoComplete={purpose === 'upgrade' ? 'new-password' : 'current-password'}
            placeholder={purpose === 'upgrade' ? 'at least 6 characters' : 'your password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {purpose === 'signin' && TURNSTILE_SITE_KEY && (
            <TurnstileWidget sitekey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} refCb={captchaRef} />
          )}

          <div className="auth-row">
            <button type="button" className="btn btn-ghost" onClick={() => setView('main')} disabled={busy}>
              Back
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Working…' : purpose === 'upgrade' ? 'Create account' : 'Sign in'}
            </button>
          </div>

          {purpose === 'signin' && (
            <div className="auth-switch">
              <button
                type="button"
                className="link-btn"
                onClick={() => void sendCode()}
                disabled={busy || (TURNSTILE_SITE_KEY !== '' && !captchaToken)}
              >
                Email me a one-time code instead
              </button>
            </div>
          )}
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
            {purpose === 'upgrade' ? 'One last step — we emailed a code to ' : 'We sent a 6-digit code to '}
            <b>{sentTo}</b>
            {purpose === 'upgrade' ? ' to finish setting up your account.' : '. It expires in a few minutes.'}
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
              {purpose === 'upgrade' ? 'Back' : 'Use a different email'}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </div>
        </form>
      )}

      <div className="auth-switch">
        {purpose === 'upgrade' ? (
          <button className="link-btn" onClick={() => switchPurpose('signin')}>
            Already have an account? Sign in
          </button>
        ) : (
          <button className="link-btn" onClick={() => switchPurpose('upgrade')}>
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
