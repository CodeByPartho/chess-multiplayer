import { Link } from '@/router'

export default function PuzzlesPage({ puzzleId }: { puzzleId?: string }) {
  return (
    <div className="center-page">
      <div className="spinner" />
      <h2 style={{ margin: 0 }}>Puzzles</h2>
      <p style={{ color: 'var(--text-dim)' }}>{puzzleId ? `Loading puzzle ${puzzleId}…` : 'Preparing your daily puzzle…'}</p>
      <Link to="/" className="btn">
        Back
      </Link>
    </div>
  )
}
