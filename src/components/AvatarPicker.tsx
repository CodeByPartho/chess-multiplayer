import { useRef } from 'react'
import { Avatar } from '@/components/Avatar'
import { HISTORICAL_AVATARS, historicalAvatarUrl } from '@/assets/avatars'
import { uuid } from '@/lib/identity'

/**
 * Avatar chooser shared by guest settings and account settings: an
 * uploaded photo (accounts only), one of the curated public-domain
 * portraits from chess history, or a freshly generated identicon.
 * Controlled — the parent owns the state and persists whatever this
 * component proposes.
 */
export function AvatarPicker({
  seed,
  path = null,
  name,
  canUpload = false,
  uploadBusy = false,
  onSeed,
  onUpload,
}: {
  seed: string
  path?: string | null
  name?: string
  canUpload?: boolean
  uploadBusy?: boolean
  onSeed: (seed: string) => void
  onUpload?: (file: File) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const current = HISTORICAL_AVATARS.find((a) => `hist:${a.id}` === seed)
  return (
    <div className="avatar-picker">
      <div className="onboard-avatar">
        <Avatar seed={seed} path={path} name={name} size={54} />
        <div className="avatar-actions">
          {canUpload && onUpload && (
            <>
              <button
                className="btn btn-sm"
                type="button"
                disabled={uploadBusy}
                onClick={() => fileRef.current?.click()}
                aria-label="Upload avatar"
              >
                {uploadBusy ? 'Uploading…' : '📷 Upload a photo'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) onUpload(f)
                }}
              />
            </>
          )}
          <button className="btn btn-sm" type="button" onClick={() => onSeed(uuid())} aria-label="Shuffle avatar">
            🎲 Generate
          </button>
        </div>
      </div>
      <p className="hint avatar-hist-title">
        Or play as a face from history — public-domain portraits from Wikimedia Commons
        {current ? ` · currently ${current.name}` : ''}
      </p>
      <div className="avatar-grid" role="listbox" aria-label="Historical avatars">
        {HISTORICAL_AVATARS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="option"
            aria-selected={seed === `hist:${a.id}`}
            data-hist={a.id}
            className={seed === `hist:${a.id}` ? 'av-cell sel' : 'av-cell'}
            title={`${a.name} (${a.years})`}
            onClick={() => onSeed(`hist:${a.id}`)}
          >
            <img src={historicalAvatarUrl(a.id) ?? ''} width={44} height={44} alt={a.name} loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  )
}
