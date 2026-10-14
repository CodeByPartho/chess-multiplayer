import { useEffect } from 'react'

export type NavAction = 'first' | 'prev' | 'next' | 'last'

/** keyboard move-list navigation (arrows / Home / End), ignores form fields */
export function useNavKeys(onSeek: (action: NavAction) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onSeek('prev')
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onSeek('next')
      } else if (e.key === 'Home') {
        e.preventDefault()
        onSeek('first')
      } else if (e.key === 'End') {
        e.preventDefault()
        onSeek('last')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSeek, enabled])
}
