import { getMatchPrefs } from '@/lib/matchPrefs'
import { Link } from '@/router'

export default function PlayPage() {
  const prefs = getMatchPrefs()
  return (
    <div className="center-page">
      <div className="spinner" />
      <h2 style={{ margin: 0 }}>Online play</h2>
      <p style={{ color: 'var(--text-dim)' }}>
        {prefs ? `Looking for an opponent for ${prefs.tc.label} ${prefs.rated ? '(rated)' : '(casual)'}…` : 'Connecting…'}
      </p>
      <Link to="/" className="btn">
        Cancel
      </Link>
    </div>
  )
}
