import { Link } from '@/router'

export default function AnalysisPage({ reviewId }: { reviewId?: string }) {
  return (
    <div className="center-page">
      <div className="spinner" />
      <h2 style={{ margin: 0 }}>Analysis</h2>
      <p style={{ color: 'var(--text-dim)' }}>{reviewId ? 'Loading game review…' : 'Loading analysis board…'}</p>
      <Link to="/" className="btn">
        Back
      </Link>
    </div>
  )
}
