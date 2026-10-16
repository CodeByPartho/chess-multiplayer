/**
 * Avatar uploads: everything between a picked File and
 * `profiles.avatar_path`. Images are center-cropped square (biased a
 * little above the middle, where faces sit) and scaled to 256×256
 * WebP/JPEG well under 200 KB before they touch the network. The storage
 * path is always `avatars/<uid>/<file>` — the bucket's policies only
 * accept writes inside the caller's own folder.
 */
import { supabase } from '@/net/supabase'

const SIDE = 256
const MAX_BYTES = 200 * 1024
const MAX_SOURCE = 8 * 1024 * 1024

/** the public URL of an uploaded avatar, derived from the storage path */
export function avatarPublicUrl(path: string | null | undefined): string | null {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
  if (!path || !base) return null
  return `${base}/storage/v1/object/public/avatars/${path.split('/').map(encodeURIComponent).join('/')}`
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That file could not be read as an image'))
    img.src = src
  })
}

/** square 256×256 WebP (JPEG where WebP is unsupported), at most 200 KB */
export async function prepareAvatarImage(file: File): Promise<Blob> {
  if (file.size > MAX_SOURCE) throw new Error('That image is larger than 8 MB — pick a smaller one')
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    if (!side) throw new Error('That file could not be read as an image')
    const sx = Math.floor((img.naturalWidth - side) / 2)
    const sy = Math.floor((img.naturalHeight - side) * 0.18)
    const canvas = document.createElement('canvas')
    canvas.width = SIDE
    canvas.height = SIDE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable in this browser')
    ctx.drawImage(img, sx, sy, side, side, 0, 0, SIDE, SIDE)
    const webp = canvas.toDataURL('image/webp').startsWith('data:image/webp')
    for (const quality of [0.86, 0.78, 0.7, 0.6, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, webp ? 'image/webp' : 'image/jpeg', quality),
      )
      if (blob && blob.size <= MAX_BYTES) return blob
    }
    throw new Error('That image could not be compressed below 200 KB')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** uploads under the caller's own folder; returns the stored path */
export async function uploadAvatar(userId: string, blob: Blob): Promise<string> {
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${userId}/avatar-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('avatars').upload(path, blob, {
    contentType: blob.type,
    cacheControl: '31536000',
  })
  if (error) throw new Error(error.message)
  return path
}

/** best-effort cleanup of a replaced upload */
export async function removeAvatarObject(path: string | null | undefined): Promise<void> {
  if (!path) return
  try {
    await supabase.storage.from('avatars').remove([path])
  } catch {
    // the profile no longer points at it — an orphaned object is harmless
  }
}
