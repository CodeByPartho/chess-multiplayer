import { useEffect, useRef, useState } from 'react'
import { Link } from '@/router'
import { Avatar } from '@/components/Avatar'
import { Confirm } from '@/components/Modal'
import { useToast } from '@/components/Toast'
import { useAuth, identitySummary, signOutEverywhere, startProviderRedirect, type OAuthProvider } from '@/net/auth'
import {
  checkUsernameAvailable,
  deleteAccount,
  fetchMyProfile,
  updateUsername,
  type ProfileRow,
} from '@/net/profileClient'
import { fetchRatingHistory, fetchRatings } from '@/net/ratingsClient'
import { fetchPlayerGames } from '@/net/profileClient'
import { validateUsername, uuid, loadIdentity, saveIdentity } from '@/lib/identity'
import { supabase, onlineEnabled } from '@/net/supabase'

type Avail = { state: 'idle' | 'checking' | 'ok' | 'bad'; message?: string }

/** account settings: username, avatar/flag, linked logins, data, deletion */
export default function AccountPage() {
  const auth = useAuth()
  const toast = useToast()
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loaded, setLoaded] = useState(false)

  const [name, setName] = useState('')
  const [seed, setSeed] = useState('')
  const [flag, setFlag] = useState('')
  const [avail, setAvail] = useState<Avail>({ state: 'idle' })
  const [busy, setBusy] = useState(false)
  const [nameSaved, setNameSaved] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [linkBusy, setLink] = useState<OAuthProvider | null>(null)
  const checkSeq = useRef(0)

  // load profile when signed in
  useEffect(() => {
    if (!auth.user || auth.loading || !onlineEnabled) return
    let dead = false
    void fetchMyProfile(auth.user.id).then((p) => {
      if (dead) return
      setProfile(p)
      setName(p?.username ?? '')
      setSeed(p?.avatar_seed ?? loadIdentity().avatarSeed)
      setFlag(p?.flag ?? '')
      setNameSaved(p?.username ?? '')
      setLoaded(true)
    })
    return () => {
      dead = true
    }
  }, [auth.user?.id, auth.loading])

  const newName = name.trim()
  const localErr = validateUsername(newName)
  const nameChanged = newName !== nameSaved && newName.length > 0

  // live availability only when the name differs from the current one
  useEffect(() => {
    if (!nameChanged || validateUsername(newName)) {
      setAvail({ state: 'idle' })
      return
    }
    const seq = ++checkSeq.current
    setAvail({ state: 'checking' })
    const t = window.setTimeout(() => {
      void checkUsernameAvailable(newName).then((reason) => {
        if (seq !== checkSeq.current) return
        setAvail(reason ? { state: 'bad', message: reason } : { state: 'ok' })
      })
    }, 350)
    return () => window.clearTimeout(t)
  }, [newName, nameChanged])

  const saveName = async () => {
    if (busy || localErr || (nameChanged && avail.state !== 'ok')) return
    setBusy(true)
    try {
      if (nameChanged) {
        const r = await updateUsername(newName)
        if (!r.ok) {
          setAvail({ state: 'bad', message: r.error })
          toast.error(r.error ?? 'Could not change the username')
          return
        }
        const identity = loadIdentity()
        identity.username = newName
        saveIdentity(identity)
        setNameSaved(newName)
        toast.show('Username updated — your profile URL changed too.')
        return
      }
      // avatar / flag only (allowed column set for the owner)
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_seed: seed, flag: flag || null })
        .eq('id', auth.user!.id)
      if (error) {
        toast.error(`Could not save: ${error.message}`)
        return
      }
      const identity = loadIdentity()
      identity.avatarSeed = seed
      identity.flag = flag || null
      saveIdentity(identity)
      setProfile((p) => (p ? { ...p, avatar_seed: seed, flag: flag || null } : p))
      toast.show('Profile updated.')
    } finally {
      setBusy(false)
    }
  }

  const connect = async (provider: OAuthProvider) => {
    setLink(provider)
    try {
      const r = await startProviderRedirect(provider, { upgrade: true, next: '/account' })
      if (!r.ok && r.error) toast.error(r.error)
    } finally {
      setLink(null)
    }
  }

  const downloadData = async () => {
    if (!auth.user) return
    setBusy(true)
    try {
      const [ratings, history, games] = await Promise.all([
        fetchRatings(auth.user.id),
        fetchRatingHistory(auth.user.id, 'classical', 500),
        fetchPlayerGames(auth.user.id, 100),
      ])
      const payload = {
        exported_at: new Date().toISOString(),
        profile: profile ?? { note: 'no profile claimed yet' },
        ratings: ratings ?? {},
        rating_history_classical: history,
        games,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `freechess-data-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.show('Data downloaded.')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    setConfirmDelete(false)
    setBusy(true)
    try {
      const r = await deleteAccount()
      if (!r.ok) {
        toast.error(r.error ?? 'Could not delete the account')
        return
      }
      await signOutEverywhere()
      window.location.href = '/'
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    await signOutEverywhere()
    window.location.href = '/'
  }

  if (!onlineEnabled) {
    return (
      <div className="center-page">
        <h1>Account</h1>
        <p style={{ color: 'var(--text-dim)' }}>Online play isn’t configured on this deployment.</p>
      </div>
    )
  }

  if (auth.loading || (!auth.user && loaded === false && !auth.isGuest)) {
    return (
      <div className="page narrow">
        <div className="card">
          <div className="skel skel-row" />
        </div>
      </div>
    )
  }

  if (!auth.user || auth.isGuest) {
    return (
      <div className="center-page">
        <div className="card auth-card">
          <div style={{ fontSize: 38 }}>👤</div>
          <h1 style={{ margin: '4px 0' }}>You’re playing as a guest</h1>
          <p className="auth-note">
            Create an account to pick a username, appear on leaderboards, keep your rating across
            devices and manage your data — your guest rating moves with you.
          </p>
          <Link to="/login" className="btn btn-primary">
            Create an account
          </Link>
        </div>
      </div>
    )
  }

  const identities = identitySummary(auth.user)
  const linkedProviders = new Set(identities.map((i) => i.provider))
  const email = (auth.user.email ?? identities.find((i) => i.email)?.email) ?? null
  const pending = !profile

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1 style={{ margin: 0 }}>Account settings</h1>
        <p className="auth-note" style={{ margin: 0 }}>
          Signed in{email ? ` as ${email}` : ''} · <Link to="/leaderboard">leaderboard</Link>
          {profile && (
            <>
              {' '}
              · <Link to={`/@${profile.username}`}>public profile</Link>
            </>
          )}
        </p>
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Profile</h2>
        {pending && (
          <div className="form-error" role="status">
            You haven’t picked a username yet — pick one now to appear on leaderboards:{' '}
            <Link to="/">Open setup</Link>
          </div>
        )}
        <div className="onboard-avatar">
          <Avatar seed={seed} size={54} />
          <button className="btn btn-ghost" type="button" onClick={() => setSeed(uuid())} aria-label="Shuffle avatar">
            Shuffle avatar
          </button>
        </div>

        <label className="field-label" htmlFor="acc-name">
          Username
        </label>
        <input
          id="acc-name"
          className="input"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={avail.state === 'bad'}
        />
        <p className={`field-hint ${avail.state === 'ok' ? 'ok' : avail.state === 'bad' ? 'bad' : ''}`} aria-live="polite">
          {nameChanged
            ? avail.state === 'checking'
              ? 'checking…'
              : avail.state === 'ok'
                ? 'available ✓'
                : avail.state === 'bad'
                  ? (avail.message ?? 'unavailable')
                  : localErr
            : '5 changes per day · shown as /@username'}
        </p>

        <label className="field-label" htmlFor="acc-flag">
          Country flag <span className="field-optional">(optional)</span>
        </label>
        <select id="acc-flag" className="input" value={flag} onChange={(e) => setFlag(e.target.value)}>
          <option value="">No flag</option>
          {['US', 'GB', 'IN', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'JP', 'BR', 'CA', 'AU', 'PL', 'KR', 'MX', 'AR', 'TR', 'UA', 'ID', 'PH', 'VN', 'TH', 'MY', 'SG', 'ZA', 'EG', 'NG', 'KE', 'CL', 'CO', 'PE', 'RO', 'HU', 'CZ', 'PT', 'GR', 'FI', 'DK', 'IE', 'CH', 'AT', 'BE', 'IL', 'AE', 'SA', 'NZ', 'RU', 'CN'].map((f) => (
            <option key={f} value={f}>
              {f} {flagEmoji(f)}
            </option>
          ))}
        </select>

        <div className="auth-row" style={{ marginTop: 14 }}>
          <button
            className="btn btn-primary"
            disabled={busy || !!localErr || (nameChanged && avail.state !== 'ok')}
            onClick={() => void saveName()}
          >
            {busy ? 'Saving…' : nameChanged ? 'Save username' : 'Save profile'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Sign-in methods</h2>
        <ul className="provider-list">
          <li>
            <span className="pl-label">Email</span>
            <span className="pl-value">{email ?? 'not linked'}</span>
          </li>
          {(['google', 'discord', 'github'] as const).map((p) => (
            <li key={p}>
              <span className="pl-label">{labelOf(p)}</span>
              {linkedProviders.has(p) ? (
                <span className="pl-value ok">connected ✓</span>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => void connect(p)} disabled={linkBusy !== null}>
                  {linkBusy === p ? 'Redirecting…' : 'Connect'}
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="auth-note" style={{ fontSize: 12.5 }}>
          Connect extra sign-in methods so you can get in even if you lose access to one of them.
        </p>
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Your data</h2>
        <div className="auth-row">
          <button className="btn btn-ghost" onClick={() => void downloadData()} disabled={busy}>
            Download my data
          </button>
          <button className="btn btn-ghost" onClick={() => void signOut()}>
            Sign out everywhere
          </button>
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
            Delete account
          </button>
        </div>
        <p className="auth-note" style={{ fontSize: 12.5 }}>
          Deleting removes your profile, ratings and history; finished games stay replayable with
          your seat anonymized. Read the <Link to="/privacy">Privacy Policy</Link> for details.
        </p>
      </div>

      {confirmDelete && (
        <Confirm
          title="Delete your account?"
          message={
            <>
              This permanently removes your username, email login, ratings and game history. Your
              finished games remain as anonymized archives. This cannot be undone.
            </>
          }
          confirmLabel="Delete everything"
          danger
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function labelOf(p: OAuthProvider): string {
  return p === 'google' ? 'Google' : p === 'discord' ? 'Discord' : 'GitHub'
}

function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...code.split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
