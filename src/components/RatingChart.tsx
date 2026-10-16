import { useMemo, useState } from 'react'

export interface ChartPoint {
  t: number
  rating: number
}

/**
 * Dependency-free SVG rating chart: smooth line + gradient area, min/max
 * guides, hoverable points with a value tooltip. Responsive via viewBox.
 */
export function RatingChart({
  points,
  height = 170,
  label = 'Rating history',
}: {
  points: ChartPoint[]
  height?: number
  label?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = height
  const PAD = { l: 40, r: 12, t: 12, b: 22 }

  const geom = useMemo(() => {
    if (points.length === 0) return null
    const ratings = points.map((p) => p.rating)
    let min = Math.min(...ratings)
    let max = Math.max(...ratings)
    if (min === max) {
      min -= 10
      max += 10
    }
    const pad = Math.max(4, (max - min) * 0.12)
    min -= pad
    max += pad

    const t0 = points[0].t
    const t1 = points[points.length - 1].t || t0 + 1
    const spanT = Math.max(1, t1 - t0)
    const x = (t: number) => PAD.l + ((t - t0) / spanT) * (W - PAD.l - PAD.r)
    const y = (r: number) => PAD.t + (1 - (r - min) / (max - min)) * (H - PAD.t - PAD.b)

    const coords = points.map((p) => ({ x: x(p.t), y: y(p.rating), ...p }))
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
    const area =
      points.length > 1
        ? `${line} L${coords[coords.length - 1].x.toFixed(1)},${H - PAD.b} L${coords[0].x.toFixed(1)},${H - PAD.b} Z`
        : null

    return { coords, line, area, min, max, y }
  }, [points, H])

  if (!geom) {
    return (
      <div className="chart-empty" role="status">
        No rated games yet — play one to start your curve.
      </div>
    )
  }

  const { coords, line, area, min, max, y } = geom
  const gridRatings = [max - (max - min) * 0.15, (max + min) / 2, min + (max - min) * 0.15]
  const hovered = hover !== null ? coords[hover] : null

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="rating-chart"
        role="img"
        aria-label={`${label}: ${points.length} points, from ${points[0].rating} to ${points[points.length - 1].rating}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="rc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent, #6cc04a)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent, #6cc04a)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {gridRatings.map((r, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(r)} y2={y(r)} className="chart-grid" />
            <text x={PAD.l - 6} y={y(r) + 3.5} textAnchor="end" className="chart-axis">
              {Math.round(r)}
            </text>
          </g>
        ))}

        {area && <path d={area} fill="url(#rc-fill)" />}
        <path d={line} className="chart-line" fill="none" />

        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={hover === i ? 4.5 : 2.2}
            className="chart-dot"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {hovered && (
          <g>
            <line x1={hovered.x} x2={hovered.x} y1={PAD.t} y2={H - PAD.b} className="chart-cursor" />
            <g
              transform={`translate(${Math.min(Math.max(hovered.x - 46, PAD.l), W - 110)}, ${Math.max(hovered.y - 40, 4)})`}
            >
              <rect width="104" height="30" rx="6" className="chart-tip-bg" />
              <text x="52" y="19.5" textAnchor="middle" className="chart-tip-text">
                {hovered.rating} · {new Date(hovered.t).toLocaleDateString()}
              </text>
            </g>
          </g>
        )}
      </svg>
      <div className="chart-foot">
        <span>{new Date(coords[0].t).toLocaleDateString()}</span>
        <span>
          {points.length} rated game{points.length === 1 ? '' : 's'}
        </span>
        <span>{new Date(coords[coords.length - 1].t).toLocaleDateString()}</span>
      </div>
    </div>
  )
}
