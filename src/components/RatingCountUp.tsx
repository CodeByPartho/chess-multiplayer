import { useEffect, useRef, useState } from 'react'

/**
 * Animated rating count-up for the result card: starts at the pre-game
 * rating and eases to the final one (instant under reduced motion).
 */
export function RatingCountUp({
  from,
  to,
  provisional,
  duration = 900,
}: {
  from: number
  to: number
  provisional?: boolean
  duration?: number
}) {
  const [value, setValue] = useState(from)
  const raf = useRef(0)

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || from === to) {
      setValue(to)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(from + (to - from) * eased))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [from, to, duration])

  const delta = to - from
  return (
    <span className="rating-countup" aria-live="polite">
      <b>
        {value}
        {provisional ? '?' : ''}
      </b>
      <span className={`rc-delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? `+${delta}` : delta}</span>
    </span>
  )
}
