import { useState } from 'react'
import { useSettings, updateSettings } from '@/lib/settings'
import { loadIdentity, saveIdentity, validateUsername, flagOptions, avatarDataUrl, type GuestIdentity } from '@/lib/identity'
import { boardThemes } from '@/board/themes'
import { pieceSets, pieceUrl } from '@/board/pieces'
import { Confirm } from '@/components/Modal'
import { useToast } from '@/components/Toast'
import { Link } from '@/router'
import { sounds } from '@/lib/sounds'

export default function SettingsPage() {
  const settings = useSettings()
  const toast = useToast()
  const [identity, setIdentity] = useState<GuestIdentity>(() => loadIdentity())
  const [nameDraft, setNameDraft] = useState(identity.username)
  const [nameError, setNameError] = useState<string | null>(null)
  const [flagOpen, setFlagOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  const commitIdentity = (patch: Partial<GuestIdentity>) => {
    const next = { ...identity, ...patch }
    setIdentity(next)
    saveIdentity(next)
  }

  const saveName = () => {
    const err = validateUsername(nameDraft)
    setNameError(err)
    if (err) return
    commitIdentity({ username: nameDraft.trim() })
    toast.show('Username saved')
  }

  return (
    <div className="settings-grid">
      <section className="card">
        <h2>Your guest profile</h2>
        <p className="hint" style={{ marginTop: -6 }}>
          Stored only on this device — no account, no email, no tracking.
        </p>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
          <img src={avatarDataUrl(identity.avatarSeed, 96)} width={64} height={64} alt="Your avatar" style={{ borderRadius: 8 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              className="btn btn-sm"
              onClick={() => {
                commitIdentity({ avatarSeed: crypto.randomUUID() })
                toast.show('New avatar generated')
              }}
            >
              🎲 New avatar
            </button>
            <button className="btn btn-sm" onClick={() => setFlagOpen((v) => !v)}>
              {identity.flag ? `${identity.flag} Change flag` : '🏳 Add flag'}
            </button>
          </div>
        </div>

        {flagOpen && (
          <div className="field">
            <label>Choose your flag</label>
            <div style={{ maxHeight: 150, overflow: 'auto', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {flagOptions().map((f) => (
                <button
                  key={f}
                  className="btn btn-sm btn-ghost"
                  style={{ fontSize: 19, padding: '4px 7px' }}
                  onClick={() => {
                    commitIdentity({ flag: f })
                    setFlagOpen(false)
                  }}
                >
                  {f}
                </button>
              ))}
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  commitIdentity({ flag: null })
                  setFlagOpen(false)
                }}
              >
                ✕ None
              </button>
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="uname">Username</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="uname"
              className="input"
              value={nameDraft}
              maxLength={20}
              onChange={(e) => {
                setNameDraft(e.target.value)
                setNameError(null)
              }}
              onBlur={saveName}
            />
            <button className="btn" onClick={saveName}>
              Save
            </button>
          </div>
          {nameError && <span className="error-text">{nameError}</span>}
        </div>

        <div className="divider" />
        <h3 style={{ fontSize: 14.5 }}>Ratings (Glicko-2)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '4px 12px', fontSize: 14 }}>
          {(['bullet', 'blitz', 'rapid', 'classical', 'puzzle'] as const).map((p) => (
            <span key={p} style={{ display: 'contents' }}>
              <span style={{ color: 'var(--text-dim)', textTransform: 'capitalize' }}>{p}</span>
              <b>{identity.ratings[p].rating}</b>
              <span className="hint">±{identity.ratings[p].rd}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Board</h2>
        <div className="field">
          <label>Board theme</label>
          <div className="swatch-grid">
            {boardThemes.map((t) => (
              <button
                key={t.id}
                className={`swatch ${settings.boardTheme === t.id ? 'selected' : ''}`}
                onClick={() => updateSettings({ boardTheme: t.id })}
              >
                <span className="sw-preview">
                  <span style={{ background: t.light }} />
                  <span style={{ background: t.dark }} />
                  <span style={{ background: t.dark }} />
                  <span style={{ background: t.light }} />
                </span>
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Piece set</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {pieceSets.map((set) => (
              <button
                key={set.id}
                className={`swatch ${settings.pieceSet === set.id ? 'selected' : ''}`}
                onClick={() => updateSettings({ pieceSet: set.id })}
                title={`${set.name} — ${set.license}`}
              >
                <span className="piece-preview">
                  <img src={pieceUrl(set.id, 'w', 'n')} alt="" />
                  <img src={pieceUrl(set.id, 'b', 'n')} alt="" />
                </span>
                {set.name}
                <span className="hint">{set.license}</span>
              </button>
            ))}
          </div>
          <Link to="/credits" className="hint">
            Licenses &amp; credits →
          </Link>
        </div>

        <Toggle label="Show coordinates" on={settings.coords} onChange={(v) => updateSettings({ coords: v })} />
        <Toggle label="Animate piece movement" on={settings.pieceAnimation} onChange={(v) => updateSettings({ pieceAnimation: v })} />
      </section>

      <section className="card">
        <h2>Gameplay</h2>
        <Toggle label="Premoves (play on opponent's turn)" on={settings.premoves} onChange={(v) => updateSettings({ premoves: v })} />
        <Toggle label="Auto-queen on promotion" on={settings.autoQueen} onChange={(v) => updateSettings({ autoQueen: v })} />
        <Toggle label="Show evaluation bar" on={settings.showEval} onChange={(v) => updateSettings({ showEval: v })} />
        <Toggle label="Confirm resign / abort" on={settings.confirmActions} onChange={(v) => updateSettings({ confirmActions: v })} />

        <div className="divider" />
        <h2>Sound</h2>
        <Toggle
          label="Sound effects"
          on={settings.sound}
          onChange={(v) => {
            updateSettings({ sound: v })
            sounds.setMuted(!v)
            if (v) sounds.play('move')
          }}
        />
        <div className="field">
          <label htmlFor="vol">Volume</label>
          <input
            id="vol"
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.volume * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100
              updateSettings({ volume: v })
              sounds.setVolume(v)
            }}
            style={{ width: '100%' }}
          />
        </div>
      </section>

      <section className="card">
        <h2>Appearance</h2>
        <div className="seg" role="group" aria-label="Appearance">
          {(['dark', 'light', 'system'] as const).map((m) => (
            <button key={m} className={settings.appearance === m ? 'active' : ''} onClick={() => updateSettings({ appearance: m })} style={{ textTransform: 'capitalize' }}>
              {m}
            </button>
          ))}
        </div>

        <div className="divider" />
        <h2 style={{ color: 'var(--danger-2)' }}>Danger zone</h2>
        <p className="hint">Erase your guest profile, ratings, settings and game history from this device.</p>
        <button className="btn btn-danger" onClick={() => setResetOpen(true)}>
          Reset all local data
        </button>
      </section>

      {resetOpen && (
        <Confirm
          title="Reset everything?"
          message="This deletes your guest identity, all ratings, settings and saved games from this device. It cannot be undone."
          confirmLabel="Delete all data"
          danger
          onCancel={() => setResetOpen(false)}
          onConfirm={() => {
            localStorage.clear()
            location.href = '/'
          }}
        />
      )}
    </div>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle">
      <span style={{ fontSize: 14.5 }}>{label}</span>
      <span
        className={`switch ${on ? 'on' : ''}`}
        role="switch"
        aria-checked={on}
        aria-label={label}
        tabIndex={0}
        onClick={() => onChange(!on)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onChange(!on)
          }
        }}
      />
    </div>
  )
}
