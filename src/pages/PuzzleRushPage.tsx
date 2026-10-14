import { Link } from '@/router'

export default function PuzzleRushPage() {
  return (
    <div className="center-page">
      <h2 style={{ margin: 0 }}>Puzzle Rush</h2>
      <p style={{ color: 'var(--text-dim)' }}>Loading…</p>
      <Link to="/puzzles" className="btn">
        Back to puzzles
      </Link>
    </div>
  )
}
