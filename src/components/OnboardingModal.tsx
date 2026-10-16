import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Avatar } from './Avatar'
import { useToast } from './Toast'
import { checkUsernameAvailable, claimUsername } from '@/net/profileClient'
import { validateUsername, uuid } from '@/lib/identity'
import { loadIdentity, saveIdentity } from '@/lib/identity'

const FLAGS = [
  '', 'US', 'GB', 'IN', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'FI', 'PL', 'PT', 'CZ',
  'AT', 'CH', 'BE', 'DK', 'IE', 'GR', 'HU', 'RO', 'UA', 'TR', 'RU', 'JP', 'KR', 'CN',
  'VN', 'TH', 'MY', 'SG', 'ID', 'PH', 'AU', 'NZ', 'BR', 'MX', 'AR', 'CL', 'CO', 'PE',
  'CA', 'EG', 'ZA', 'NG', 'KE', 'AE', 'SA', 'IL',
]

type Availability = { state: 'idle' | 'checking' | 'ok' | 'bad'; message?: string }

/**
 * First sign-up step: pick the public username that ties the account to its
 * profile page (/@username), leaderboard entry and archives. Mirrors the
 * server rules — availability is checked live against the database.
 */
export function OnboardingModal({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [seed, setSeed] = useState(() => loadIdentity().avatarSeed)
  const [flag, setFlag] = useState('')
  const [avail, setAvail] = useState<Availability>({ state: 'idle' })
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const checkSeq = useRef(0)

  const localErr = validateUsername(name.trim())

  useEffect(() => {
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
  }, [name])

  const submit = async () => {
    const trimmed = name.trim()
    if (busy || validateUsername(trimmed) || avail.state !== 'ok') return
    setBusy(true)
    try {
      const r = await claimUsername(trimmed, seed, flag || null)
      if (!r.ok) {
        setAvail({ state: 'bad', message: r.error })
        return
      }
      // keep the local guest identity in step with the account name
      const identity = loadIdentity()
      identity.username = trimmed
      identity.avatarSeed = seed
      identity.flag = flag || null
      saveIdentity(identity)
      window.dispatchEvent(new Event('fc:profile-changed'))
      toast.show(`Welcome, ${trimmed}! Your profile is live.`)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  if (dismissed) return null

  const nameState =
    avail.state === 'checking'
      ? 'checking…'
      : avail.state === 'ok'
        ? 'available ✓'
        : avail.state === 'bad'
          ? (avail.message ?? 'unavailable')
          : localErr && name.length > 0
            ? localErr
            : ''

  return (
    <Modal title="Pick your username" labelledBy="onboard-title">
      <p className="auth-note">
        Your public name and profile page — <b>/@username</b>. You can change it later (5 times a day).
      </p>

      <div className="onboard-avatar">
        <Avatar seed={seed} size={54} />
        <button
          className="btn btn-ghost"
          onClick={() => setSeed(uuid())}
          type="button"
          aria-label="Shuffle avatar"
        >
          Shuffle avatar
        </button>
      </div>

      <label className="field-label" htmlFor="onboard-name">
        Username
      </label>
      <input
        id="onboard-name"
        className="input"
        value={name}
        autoFocus
        maxLength={20}
        placeholder="e.g. KnightOwl42"
        onChange={(e) => setName(e.target.value)}
        aria-describedby="onboard-avail"
        aria-invalid={avail.state === 'bad'}
      />
      <p
        id="onboard-avail"
        className={`field-hint ${avail.state === 'ok' ? 'ok' : avail.state === 'bad' ? 'bad' : ''}`}
        aria-live="polite"
      >
        {nameState}
      </p>

      <label className="field-label" htmlFor="onboard-flag">
        Country flag <span className="field-optional">(optional)</span>
      </label>
      <select id="onboard-flag" className="input" value={flag} onChange={(e) => setFlag(e.target.value)}>
        {FLAGS.map((f) => (
          <option key={f} value={f}>
            {f ? `${f} ${flagEmoji(f)}` : 'No flag'}
          </option>
        ))}
      </select>

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => setDismissed(true)} type="button">
          Not now
        </button>
        <button
          className="btn btn-primary"
          onClick={() => void submit()}
          disabled={busy || !!localErr || avail.state !== 'ok'}
        >
          {busy ? 'Creating…' : 'Claim username'}
        </button>
      </div>
      <p className="auth-note" style={{ fontSize: 12 }}>
        Until you claim a name your account isn&apos;t listed on leaderboards.
      </p>
    </Modal>
  )
}

function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(
    ...code.split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  )
}
