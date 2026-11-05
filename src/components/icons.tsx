import type { ReactNode } from 'react'

/**
 * Small hand-drawn stroke icon set (24x24 grid, currentColor).
 * One consistent line weight everywhere; no emoji in chrome or headings.
 */
function I({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none', verticalAlign: '-0.18em' }}
    >
      {children}
    </svg>
  )
}

export const IconBlocks = ({ size }: { size?: number }) => (
  <I size={size}>
    <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" />
    <rect x="13" y="3.5" width="7.5" height="7.5" rx="2" />
    <rect x="3.5" y="13" width="7.5" height="7.5" rx="2" />
    <rect x="13" y="13" width="7.5" height="7.5" rx="2" />
  </I>
)

export const IconChart = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M4 20h16" />
    <path d="M7 20v-8" />
    <path d="M12 20V5" />
    <path d="M17 20v-11" />
  </I>
)

export const IconBot = ({ size }: { size?: number }) => (
  <I size={size}>
    <rect x="4" y="9" width="16" height="10" rx="3" />
    <path d="M12 9V5" />
    <circle cx="12" cy="3.4" r="1.3" />
    <circle cx="9" cy="14" r="0.4" fill="currentColor" />
    <circle cx="15" cy="14" r="0.4" fill="currentColor" />
    <path d="M9.5 16.8h5" />
  </I>
)

export const IconRepeat = ({ size }: { size?: number }) => (
  <I size={size}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </I>
)

export const IconTrophy = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M8 21h8" />
    <path d="M12 17v4" />
    <path d="M7 4h10v6a5 5 0 0 1-10 0V4z" />
    <path d="M7 6H4.5C4.5 9 6 10.5 7.6 10.6" />
    <path d="M17 6h2.5c0 3-1.5 4.5-3.1 4.6" />
  </I>
)

export const IconGear = ({ size }: { size?: number }) => (
  <I size={size}>
    <circle cx="12" cy="12" r="5.4" />
    <circle cx="12" cy="12" r="1.9" />
    <path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6M5.8 5.8l1.8 1.8M16.4 16.4l1.8 1.8M18.2 5.8l-1.8 1.8M7.6 16.4l-1.8 1.8" strokeWidth={2.2} />
  </I>
)

export const IconMedal = ({ size }: { size?: number }) => (
  <I size={size}>
    <circle cx="12" cy="14.5" r="5" />
    <path d="M8.8 10.4L6 3h4l2 4.4M15.2 10.4L18 3h-4l-2 4.4" />
  </I>
)

export const IconUsers = ({ size }: { size?: number }) => (
  <I size={size}>
    <circle cx="9" cy="8" r="3.4" />
    <path d="M3 20c.7-3.4 3-5 6-5s5.3 1.6 6 5" />
    <path d="M15.6 5.3a3.4 3.4 0 0 1-.1 5.9" />
    <path d="M17.6 15.4c1.9.7 3 2.1 3.4 4.6" />
  </I>
)

export const IconUser = ({ size }: { size?: number }) => (
  <I size={size}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20c.9-3.8 3.8-5.5 7.5-5.5s6.6 1.7 7.5 5.5" />
  </I>
)

export const IconBolt = ({ size }: { size?: number }) => (
  <I size={size}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </I>
)

export const IconFlame = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M12 3.5c.8 2.8-1.8 4.3-2.8 6C8.4 11 8 12 8 13.5a4.5 4.5 0 0 0 9 0c0-1.6-.6-2.8-1.4-4-.6 1-1.3 1.6-2.1 1.9.3-2.3-.7-4.9-1.5-6.6z" />
  </I>
)

export const IconTarget = ({ size }: { size?: number }) => (
  <I size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </I>
)

export const IconClock = ({ size }: { size?: number }) => (
  <I size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5l3.5 2" />
  </I>
)

export const IconBulb = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M9.5 18h5" />
    <path d="M10.5 21h3" />
    <path d="M12 3a6 6 0 0 1 3.5 10.9c-.7.5-1 1-1 2.1h-5c0-1.1-.3-1.6-1-2.1A6 6 0 0 1 12 3z" />
  </I>
)

export const IconDice = ({ size }: { size?: number }) => (
  <I size={size}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <circle cx="9" cy="9" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="15" cy="9" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="9" cy="15" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="15" cy="15" r="1.15" fill="currentColor" stroke="none" />
  </I>
)

export const IconCamera = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.4" />
  </I>
)

export const IconBellOff = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M18.6 15.9c-.6-.8-.9-1.8-.9-3.3 0-3.3-1.5-5.5-3.9-6.4M6.4 6.5C5.5 7.9 5.2 9.7 5.2 12.6c0 1.5-.3 2.5-.9 3.3L3.5 17h17l-1.9-1.1" />
    <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    <path d="M4 4l16 16" />
  </I>
)

export const IconFlag = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M5 21V4" />
    <path d="M5 4.5c3.5-1.8 6 1.6 10 .2v8.6c-4 1.4-6.5-2-10-.2" />
  </I>
)

export const IconKey = ({ size }: { size?: number }) => (
  <I size={size}>
    <circle cx="8.5" cy="14.5" r="4.5" />
    <path d="M11.7 11.3L20 3" />
    <path d="M16.5 6.5l3 3" />
  </I>
)

export const IconCalendar = ({ size }: { size?: number }) => (
  <I size={size}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M3.5 10h17" />
    <path d="M8 3v4M16 3v4" />
  </I>
)

export const IconCheck = ({ size }: { size?: number }) => (
  <I size={size}>
    <polyline points="4.5 12.5 10 18 19.5 6.5" />
  </I>
)

export const IconCross = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </I>
)

export const IconEraser = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M5.5 14.5L14 6a2.12 2.12 0 0 1 3 0l1.5 1.5a2.12 2.12 0 0 1 0 3L13 16H8.5l-3-1.5z" />
    <path d="M4 20h16" />
  </I>
)
