import { avatarDataUrl } from '@/lib/identity'

export function Avatar({ seed, size = 34, alt = '' }: { seed: string; size?: number; alt?: string }) {
  return (
    <img
      src={avatarDataUrl(seed, size * 2)}
      width={size}
      height={size}
      alt={alt}
      style={{ borderRadius: 6, flex: 'none', display: 'block' }}
    />
  )
}
