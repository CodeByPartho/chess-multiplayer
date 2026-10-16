import { avatarDataUrl, initialsDataUrl } from '@/lib/identity'
import { historicalAvatarUrl } from '@/assets/avatars'
import { avatarPublicUrl } from '@/lib/avatarUpload'

/**
 * A player's picture, best source first:
 *   1. an uploaded avatar (profiles.avatar_path in the public avatars bucket)
 *   2. a curated historical portrait (seed of the form `hist:<id>`)
 *   3. the deterministic generated identicon (any other seed)
 *   4. initials, when there is no seed at all
 * Every branch is a plain <img>, so callers render it identically.
 */
export function Avatar({
  seed,
  path,
  name,
  size = 34,
  alt = '',
}: {
  seed?: string
  path?: string | null
  name?: string
  size?: number
  alt?: string
}) {
  const src =
    avatarPublicUrl(path) ??
    (seed?.startsWith('hist:') ? historicalAvatarUrl(seed.slice(5)) : null) ??
    (seed ? avatarDataUrl(seed, size * 2) : null) ??
    initialsDataUrl(name ?? '?', size * 2)
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={alt}
      style={{ borderRadius: 6, flex: 'none', display: 'block' }}
    />
  )
}
