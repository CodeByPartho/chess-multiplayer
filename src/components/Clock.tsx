import { useEffect, useState } from 'react'

export function fmtClock(ms: number): string {
  if (ms < 0) ms = 0
  const s = ms / 1000
  if (s < 10) return s.toFixed(1)
  const total = Math.floor(s)
  const m = Math.floor(total / 60)
  const rs = total % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(rs).padStart(2, '0')}`
  }
  return `${m}:${String(rs).padStart(2, '0')}`
}

export interface GameClockProps {
  /** ms remaining right now */
  getMs: () => number
  /** clock is running for this side */
  running: boolean
  /** below this many ms the clock turns red */
  lowMs?: number
  untimed?: boolean
  label?: string
}

export function GameClock({ getMs, running, lowMs = 15_000, untimed, label }: GameClockProps) {
  const [ms, setMs] = useState(() => getMs())

  useEffect(() => {
    if (untimed) return
    const id = setInterval(() => setMs(getMs()), 90)
    return () => clearInterval(id)
  }, [getMs, untimed])

  if (untimed) {
    return <div className="clock untimed">{label ?? 'No limit'}</div>
  }

  const low = running && ms <= lowMs
  return (
    <div
      className={`clock ${running ? 'active' : ''} ${low ? 'low' : ''}`}
      aria-label={`Time remaining ${fmtClock(ms)}`}
    >
      {fmtClock(ms)}
    </div>
  )
}
