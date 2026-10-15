import { Component, Suspense, lazy, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
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
const JoinScreen = lazy(() => import('./pages/JoinScreen'))
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

/** desktop / mobile navigation entries */
const SIDE_LINKS: { to: string; label: string; icon: string }[] = [
  { to: '/play', label: 'Play', icon: '♟' },
  { to: '/puzzles', label: 'Puzzles', icon: '🧩' },
  { to: '/analysis', label: 'Analysis', icon: '📊' },
  { to: '/computer', label: 'Computer', icon: '🤖' },
  { to: '/passandplay', label: 'Pass & Play', icon: '🔁' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
  { to: '/credits', label: 'Credits', icon: '🏅' },
]

const TAB_LINKS: { to: string; label: string; icon: string }[] = [
  { to: '/play', label: 'Play', icon: '♟' },
  { to: '/computer', label: 'Computer', icon: '🤖' },
  { to: '/puzzles', label: 'Puzzles', icon: '🧩' },
  { to: '/analysis', label: 'Analysis', icon: '📊' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

/** desktop left navigation (collapsible) */
function SideNav() {
  const { path } = useRoute()
  const identity = useState(() => loadIdentity())[0]
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('fc.nav') === 'collapsed'
    } catch {
      return false
    }
  })

  useEffect(() => {
    document.documentElement.dataset.nav = collapsed ? 'collapsed' : 'open'
    try {
      localStorage.setItem('fc.nav', collapsed ? 'collapsed' : 'open')
    } catch {
      /* private mode */
    }
  }, [collapsed])

  const isActive = (to: string) => path === to || path.startsWith(to + '/')

  return (
    <aside className="sidenav" aria-label="Main">
      <Link to="/" className="sn-logo" title="FreeChess">
        <img src="/icons/icon.svg" alt="" width={26} height={26} />
        <span className="sn-label">FreeChess</span>
      </Link>
      {SIDE_LINKS.map((l) => (
        <Link key={l.to} to={l.to} className={`sn-item ${isActive(l.to) ? 'active' : ''}`}>
          <span className="sn-icon" aria-hidden="true">
            {l.icon}
          </span>
          <span className="sn-label">{l.label}</span>
        </Link>
      ))}
      <div className="sn-spacer" />
      <Link to="/settings" className="nav-chip" title="Edit your guest profile">
        <Avatar seed={identity.avatarSeed} size={22} />
        <span>{identity.username}</span>
        <span className="rating">{identity.ratings.rapid.rating}</span>
      </Link>
      <button
        className="sn-toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
      >
        {collapsed ? '»' : '«'}
      </button>
    </aside>
  )
}

/** mobile bottom tab bar */
function TabBar() {
  const { path } = useRoute()
  const isActive = (to: string) => path === to || path.startsWith(to + '/')
  return (
    <nav className="tabbar" aria-label="Sections">
      {TAB_LINKS.map((l) => (
        <Link key={l.to} to={l.to} className={isActive(l.to) ? 'active' : ''}>
          <span className="tb-icon" aria-hidden="true">
            {l.icon}
          </span>
          <span>{l.label}</span>
        </Link>
      ))}
    </nav>
  )
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

/** keeps a crashed route from blanking the whole app */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error:', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="center-page">
          <div style={{ fontSize: 40 }}>💥</div>
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-dim)', maxWidth: 440, textAlign: 'center' }}>
            {this.state.error.message || 'Unexpected error'} — reloading usually fixes it.
          </p>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Reload
          </button>
          <a className="btn btn-ghost" href="/">
            Back home
          </a>
        </div>
      )
    }
    return this.props.children
  }
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
  m = matchPath('/join/:gameId', path)
  if (m) return <JoinScreen key={m.gameId} gameId={m.gameId} onGo={(to) => navigate(to)} />
  m = matchPath('/invite/:code', path)
  if (m) return <JoinScreen key={m.code} code={m.code} onGo={(to) => navigate(to)} />
  m = matchPath('/puzzles/rush', path)
  if (m) return <PuzzleRushPage />
  m = matchPath('/review/:id', path)
  if (m) return <AnalysisPage reviewId={m.id} />
  m = matchPath('/puzzle/:id', path)
  if (m) return <PuzzlesPage puzzleId={m.id} />

  return <NotFound />
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
        <SideNav />
        <div className="shell">
          <TopNav />
          <main className="app-main">
            <Suspense
              fallback={
                <div className="center-page">
                  <div className="spinner" />
                </div>
              }
            >
              <ErrorBoundary>
                <RouteView />
              </ErrorBoundary>
            </Suspense>
          </main>
          <TabBar />
        </div>
      </ToastProvider>
    </RouterProvider>
  )
}

export default App
