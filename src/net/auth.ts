/**
 * Authentication: guests first, then optional sign-up.
 *
 *  * anonymous sessions keep playing as before (guest-first),
 *  * Google / Discord / GitHub sign in through PKCE: a popup for signing in
 *    to an existing account, and a same-tab redirect when upgrading the
 *    current guest (the link must keep this session's user),
 *  * passwordless email: an OTP sign-in for accounts, and the anonymous-user
 *    email upgrade (updateUser + email_change OTP) which keeps the guest's
 *    rating and games because the user id never changes.
 *
 * Nothing here ever writes ratings or results — that lives in the database.
 */
import { useCallback, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, onlineEnabled } from './supabase'
import { load, save, STORAGE_KEYS } from '@/lib/storage'

export type OAuthProvider = 'google' | 'discord' | 'github'

export const OAUTH_PROVIDERS: { id: OAuthProvider; label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'discord', label: 'Discord' },
  { id: 'github', label: 'GitHub' },
]

/** captcha site key from the environment (absent = no Turnstile) */
export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? ''

export interface AuthState {
  user: User | null
  session: Session | null
  /** true while the session is still anonymous (a guest) */
  isGuest: boolean
  loading: boolean
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, session: null, isGuest: true, loading: true })

  useEffect(() => {
    if (!onlineEnabled) {
      setState({ user: null, session: null, isGuest: true, loading: false })
      return
    }
    let alive = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      const session = data.session
      setState({ user: session?.user ?? null, session, isGuest: session?.user.is_anonymous !== false, loading: false })
    })
    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ user: session?.user ?? null, session, isGuest: session?.user.is_anonymous !== false, loading: false })
    })
    return () => {
      alive = false
      sub.data.subscription.unsubscribe()
    }
  }, [])

  return state
}

function callbackUrl(next: string): string {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
}

export interface StartResult {
  ok: boolean
  error?: string
  /** 'already_exists' — the provider account belongs to a different user */
  code?: string
}

/**
 * Same-tab OAuth redirect. Used for upgrades (keeps this session's user) and
 * as the popup fallback. Navigates away on success.
 */
export async function startProviderRedirect(
  provider: OAuthProvider,
  opts: { upgrade?: boolean; next?: string; captchaToken?: string } = {},
): Promise<StartResult> {
  if (!onlineEnabled) return { ok: false, error: 'Online play is not configured' }
  const redirectTo = callbackUrl(opts.next ?? window.location.pathname)
  const options = { redirectTo, captchaToken: opts.captchaToken }
  try {
    const { error } = opts.upgrade
      ? await supabase.auth.linkIdentity({ provider, options })
      : await supabase.auth.signInWithOAuth({ provider, options })
    if (error) {
      const already = /already|linked/i.test(error.message)
      return { ok: false, error: error.message, code: already ? 'already_exists' : undefined }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Sign-in failed' }
  }
}

/**
 * Popup sign-in for an existing account. Resolves when the popup reports
 * success (then the parent reloads onto the new session) or closes empty.
 */
export function startProviderPopup(provider: OAuthProvider, next?: string): Promise<StartResult> {
  if (!onlineEnabled) return Promise.resolve({ ok: false, error: 'Online play is not configured' })
  return (async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl(next ?? window.location.pathname), skipBrowserRedirect: true },
    })
    if (error || !data?.url) return { ok: false, error: error?.message ?? 'Could not start sign-in' }
    const popup = window.open(data.url, 'fc-oauth', 'width=520,height=680,noopener')
    if (!popup) return { ok: false, error: 'The sign-in window was blocked — allow popups or use email' }
    return await new Promise<StartResult>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const d = ev.data as { type?: string; error?: string } | null
        if (d?.type !== 'fc-auth') return
        cleanup()
        resolve(d.error ? { ok: false, error: d.error } : { ok: true })
      }
      const timer = window.setInterval(() => {
        if (popup.closed) {
          cleanup()
          resolve({ ok: false, error: 'popup_closed' })
        }
      }, 500)
      const cleanup = () => {
        window.removeEventListener('message', onMsg)
        window.clearInterval(timer)
        try {
          popup.close()
        } catch {
          /* already gone */
        }
      }
      window.addEventListener('message', onMsg)
    })
  })()
}

/** passwordless email sign-in (creates the account when needed) */
export async function sendEmailOtp(email: string, captchaToken?: string): Promise<StartResult> {
  if (!onlineEnabled) return { ok: false, error: 'Online play is not configured' }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, captchaToken },
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** confirm an email sign-in code */
export async function verifyEmailOtp(email: string, token: string): Promise<StartResult> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/**
 * Upgrade the current guest by adding an email — same user id, so the
 * rating, games and history carry over untouched.
 */
export async function upgradeGuestEmail(email: string): Promise<StartResult> {
  const { error } = await supabase.auth.updateUser({ email })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** confirm the email-upgrade code (email_change OTP) */
export async function verifyUpgradeEmail(email: string, token: string): Promise<StartResult> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email_change' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** sign out on this device and every other device (global refresh revoke) */
export async function signOutEverywhere(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'global' })
  } catch {
    /* session already gone */
  }
}

/** one-time notice shown after switching accounts (guest data stays behind) */
export function setUpgradeNotice(text: string): void {
  save(STORAGE_KEYS.authNotice, { text, at: Date.now() })
}
export function takeUpgradeNotice(): string | null {
  const n = load<{ text?: string } | null>(STORAGE_KEYS.authNotice, null)
  if (n?.text) {
    save(STORAGE_KEYS.authNotice, null)
    return n.text
  }
  return null
}

/** callback page helper: complete a PKCE exchange for `code` */
export async function completeAuthCallback(code: string): Promise<StartResult> {
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** email availability probe kept near auth for the onboarding form */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export const isEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

/** used by the account page: current session's login identities summary */
export function identitySummary(user: User | null): { provider: string; email: string | null }[] {
  if (!user) return []
  return (user.identities ?? []).map((i) => ({
    provider: i.provider,
    email: (i.identity_data?.email as string | undefined) ?? null,
  }))
}

/** hook: stable navigate-free auth helpers bound to online state */
export function useAuthActions() {
  const guard = useCallback(
    (fn: () => Promise<StartResult>): Promise<StartResult> =>
      onlineEnabled ? fn() : Promise.resolve({ ok: false, error: 'Online play is not configured' }),
    [],
  )
  return { guard }
}
