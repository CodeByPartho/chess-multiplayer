import { Link } from '@/router'

export default function GamePage({ gameId }: { gameId: string }) {
  return (
    <div className="center-page">
      <div className="spinner" />
      <h2 style={{ margin: 0 }}>Online game</h2>
      <p style={{ color: 'var(--text-dim)' }}>Connecting to game {gameId}…</p>
      <Link to="/play" className="btn">
        Back to lobby
      </Link>
    </div>
  )
}
