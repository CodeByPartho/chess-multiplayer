import { Suspense, lazy, useEffect, useState } from 'react'
import { RouterProvider, Link, matchPath, useRoute } from './router'
import { ToastProvider } from './components/Toast'
import { getSettings, subscribeSettings } from './lib/settings'
import { loadIdentity } from './lib/identity'
import { sounds } from './lib/sounds'
import { Avatar } from './components/Avatar'
import './styles/base.css'
import './styles/board.css'

const Home = lazy(() => import('./pages/Home'))
const PlayPage = lazy(() => import('./pages/PlayPage'))
const GamePage = lazy(() => import('./pages/GamePage'))
const ComputerPage = lazy(() => import('./pages/ComputerPage'))
const PassPlayPage = lazy(() => import('./pages/PassPlayPage'))
const PuzzlesPage = lazy(() => import('./pages/PuzzlesPage'))
const PuzzleRushPage = lazy(() => import('./pages/PuzzleRushPage'))
const AnalysisPage = lazy(() => import('./pages/AnalysisPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const CreditsPage = lazy(() => import('./pages/CreditsPage'))

function applyDocumentSettings() {
  const s = getSettings()
  const dark =
    s.appearance === 'dark' ||
    (s.appearance === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.appearance = dark ? 'dark' : 'light'
  document.documentElement.dataset.board = s.boardTheme
}

function TopNav() {
  const { path } = useRoute()
  const identity = useState(() => loadIdentity())[0]

  const links: { to: string; label: string }[] = [
    { to: '/play', label: 'Play' },
    { to: '/computer', label: 'Computer' },
    { to: '/passandplay', label: 'Pass & Play' },
    { to: '/puzzles', label: 'Puzzles' },
    { to: '/analysis', label: 'Analysis' },
  ]

  const isActive = (to: string) => path === to || path.startsWith(to + '/')

  return (
    <header className="topnav">
      <Link to="/" className="logo">
        <img src="/icons/icon.svg" alt="" width={26} height={26} />
        <span>FreeChess</span>
      </Link>
      <nav aria-label="Main">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className={isActive(l.to) ? 'active' : ''}>
            {l.label}
          </Link>
        ))}
      </nav>
      <Link to="/settings" className="nav-chip" title="Edit your guest profile">
        <Avatar seed={identity.avatarSeed} size={22} />
        <span>{identity.username}</span>
        <span className="rating">{identity.ratings.rapid.rating}</span>
      </Link>
    </header>
  )
}

function NotFound() {
  return (
    <div className="center-page">
      <div style={{ fontSize: 44 }}>♞</div>
      <h1 style={{ margin: 0 }}>Page not found</h1>
      <p style={{ color: 'var(--text-dim)' }}>That square doesn&apos;t exist.</p>
      <Link to="/" className="btn btn-primary">
        Back home
      </Link>
    </div>
  )
}

function RouteView() {
  const { path, navigate } = useRoute()

  if (path === '/' || path === '') return <Home />
  if (path === '/play') return <PlayPage />
  if (path === '/computer') return <ComputerPage />
  if (path === '/passandplay') return <PassPlayPage />
  if (path === '/puzzles') return <PuzzlesPage />
  if (path === '/analysis') return <AnalysisPage />
  if (path === '/settings') return <SettingsPage />
  if (path === '/credits') return <CreditsPage />

  let m = matchPath('/play/:gameId', path)
  if (m) return <GamePage key={m.gameId} gameId={m.gameId} />
  m = matchPath('/invite/:gameId', path)
  if (m) return <InviteRedirect gameId={m.gameId} onGo={(to) => navigate(to)} />
  m = matchPath('/puzzles/rush', path)
  if (m) return <PuzzleRushPage />
  m = matchPath('/review/:id', path)
  if (m) return <AnalysisPage reviewId={m.id} />
  m = matchPath('/puzzle/:id', path)
  if (m) return <PuzzlesPage puzzleId={m.id} />

  return <NotFound />
}

function InviteRedirect({ gameId, onGo }: { gameId: string; onGo: (to: string) => void }) {
  useEffect(() => {
    onGo(`/play/${gameId}`)
  }, [gameId, onGo])
  return (
    <div className="center-page">
      <div className="spinner" />
      <p>Joining game…</p>
    </div>
  )
}

function App() {
  useEffect(() => {
    applyDocumentSettings()
    const unsub = subscribeSettings(() => applyDocumentSettings())
    const s = getSettings()
    sounds.preload()
    sounds.setVolume(s.volume)
    sounds.setMuted(!s.sound)

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMQ = () => applyDocumentSettings()
    mq.addEventListener('change', onMQ)

    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    return () => {
      unsub()
      mq.removeEventListener('change', onMQ)
    }
  }, [])

  return (
    <RouterProvider>
      <ToastProvider>
        <TopNav />
        <main className="app-main">
          <Suspense
            fallback={
              <div className="center-page">
                <div className="spinner" />
              </div>
            }
          >
            <RouteView />
          </Suspense>
        </main>
      </ToastProvider>
    </RouterProvider>
  )
}

export default App
