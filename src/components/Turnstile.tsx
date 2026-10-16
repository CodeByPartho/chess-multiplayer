import { useEffect, useRef, type MutableRefObject } from 'react'

/**
 * Cloudflare Turnstile — rendered only when a site key is configured
 * (VITE_TURNSTILE_SITE_KEY). Without a key the app simply runs without the
 * widget, so local dev and offline setups are unaffected.
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (token: string) => void
  reset: (token?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
    __fcTurnstileLoad?: Promise<void>
  }
}

let scriptPromise: Promise<void> | null = null

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (window.__fcTurnstileLoad) return window.__fcTurnstileLoad
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Turnstile failed to load'))
    document.head.appendChild(s)
  })
  window.__fcTurnstileLoad = scriptPromise
  return scriptPromise
}

export function TurnstileWidget({
  sitekey,
  onToken,
  refCb,
}: {
  sitekey: string
  onToken: (token: string) => void
  refCb?: MutableRefObject<{ reset: () => void } | null>
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const widgetId = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    if (!sitekey) return
    let dead = false
    void loadTurnstile()
      .then(() => {
        if (dead || !hostRef.current || !window.turnstile) return
        widgetId.current = window.turnstile.render(hostRef.current, {
          sitekey,
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => onTokenRef.current(''),
        })
        if (refCb) {
          refCb.current = {
            reset: () => {
              if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current)
            },
          }
        }
      })
      .catch(() => {
        /* offline / blocked — form still works without a token */
      })
    return () => {
      dead = true
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current)
        } catch {
          /* already gone */
        }
      }
      if (refCb) refCb.current = null
    }
  }, [sitekey, refCb])

  if (!sitekey) return null
  return (
    <div className="turnstile" aria-label="Security check">
      <div ref={hostRef} />
    </div>
  )
}
