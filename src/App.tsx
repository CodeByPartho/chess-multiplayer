import { Component, Suspense, lazy, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { RouterProvider, Link, matchPath, useRoute } from './router'
import { ToastProvider, useToast } from './components/Toast'
import { getSettings, subscribeSettings } from './lib/settings'
import { loadIdentity } from './lib/identity'
import { sounds } from './lib/sounds'
import { Avatar } from './components/Avatar'
import { AuthModal } from './components/AuthModal'
import { OnboardingModal } from './components/OnboardingModal'
import { useAuth, signOutEverywhere } from './net/auth'
import { fetchMyProfile, type ProfileRow } from './net/profileClient'
import { fetchRatingFor } from './net/ratingsClient'
import { takeUpgradeNotice } from './net/auth'
import { onlineEnabled } from './net/supabase'
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
const LoginPage = lazy(() => import('./pages/LoginPage'))
const AuthCallback = lazy(() => import('./pages/AuthCallback'))
const AccountPage = lazy(() => import('./pages/AccountPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const TermsPage = lazy(() => import('./pages/TermsPage'))

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
  { to: '/leaderboard', label: 'Leaderboards', icon: '🏆' },
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
      <div className="sn-account">
        <AccountChip />
      </div>
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

  const links: { to: string; label: string }[] = [
    { to: '/play', label: 'Play' },
    { to: '/computer', label: 'Computer' },
    { to: '/passandplay', label: 'Pass & Play' },
    { to: '/puzzles', label: 'Puzzles' },
    { to: '/analysis', label: 'Analysis' },
    { to: '/leaderboard', label: 'Leaderboards' },
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
      <AccountChip />
    </header>
  )
}

/** auth-aware account control: guest chip + sign in, or account menu */
function AccountChip() {
  const auth = useAuth()
  const [identity, setIdentity] = useState(() => loadIdentity())
  const [modal, setModal] = useState(false)
  const [menu, setMenu] = useState(false)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [rapid, setRapid] = useState<number | null>(null)

  // the guest profile lives in localStorage — re-read it whenever it is
  // written (post-game rating sync, name/avatar edits) so the chip shows
  // the current values without a reload
  useEffect(() => {
    const onIdentity = () => setIdentity(loadIdentity())
    window.addEventListener('fc:identity-changed', onIdentity)
    return () => window.removeEventListener('fc:identity-changed', onIdentity)
  }, [])

  useEffect(() => {
    if (!auth.user || auth.isGuest || auth.loading || !onlineEnabled) {
      setProfile(null)
      setRapid(null)
      return
    }
    let dead = false
    const uid = auth.user.id
    void fetchMyProfile(uid).then((p) => !dead && setProfile(p))
    void fetchRatingFor(uid, 'rapid').then(
      (r) => !dead && setRapid(Math.round(r.rating)),
      () => {},
    )
    const onProfile = () => {
      void fetchMyProfile(uid).then((p) => !dead && setProfile(p))
    }
    window.addEventListener('fc:profile-changed', onProfile)
    return () => {
      dead = true
      window.removeEventListener('fc:profile-changed', onProfile)
    }
  }, [auth.user?.id, auth.isGuest, auth.loading])

  const signedIn = !!auth.user && !auth.isGuest && onlineEnabled

  if (auth.loading || !onlineEnabled) {
    return <span className="nav-chip skel skel-chip" aria-hidden="true" />
  }

  if (!signedIn) {
    // the chip is the guest's headline rating: show the pool of their last
    // finished game (quick pair defaults to blitz), falling back to rapid
    const headlinePool =
      identity.lastPool && identity.ratings[identity.lastPool] ? identity.lastPool : 'rapid'
    return (
      <>
        <Link to="/settings" className="nav-chip" title={`Your guest profile — ${headlinePool} rating`}>
          <Avatar seed={identity.avatarSeed} size={22} />
          <span>{identity.username}</span>
          <span className="rating">{identity.ratings[headlinePool].rating}</span>
        </Link>
        <button className="btn btn-primary btn-sm nav-signin" onClick={() => setModal(true)} aria-label="Sign in">
          <span className="ns-icon" aria-hidden="true">
            🔑
          </span>
          <span className="ns-label">Sign in</span>
        </button>
        {modal && <AuthModal purpose="upgrade" onClose={() => setModal(false)} />}
      </>
    )
  }

  return (
    <div className="acct">
      <button
        className="nav-chip acct-btn"
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
        title="Account menu"
      >
        <Avatar seed={profile?.avatar_seed ?? identity.avatarSeed} size={22} />
        <span>{profile?.username ?? 'Set username'}</span>
        {rapid !== null && <span className="rating">{rapid}</span>}
      </button>
      {menu && (
        <>
          <div className="menu-overlay" onClick={() => setMenu(false)} aria-hidden="true" />
          <nav className="acct-menu" aria-label="Account menu">
            {profile && (
              <Link to={`/@${profile.username}`} onClick={() => setMenu(false)}>
                Public profile
              </Link>
            )}
            <Link to="/account" onClick={() => setMenu(false)}>
              Account settings
            </Link>
            <Link to="/leaderboard" onClick={() => setMenu(false)}>
              Leaderboards
            </Link>
            <button
              onClick={() => {
                setMenu(false)
                void signOutEverywhere().then(() => window.location.assign('/'))
              }}
            >
              Sign out
            </button>
          </nav>
        </>
      )}
    </div>
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
  if (path === '/login') return <LoginPage />
  if (path === '/auth/callback') return <AuthCallback />
  if (path === '/account') return <AccountPage />
  if (path === '/leaderboard') return <LeaderboardPage />
  if (path === '/privacy') return <PrivacyPage />
  if (path === '/terms') return <TermsPage />
  if (path.startsWith('/@')) {
    const handle = decodeURIComponent(path.slice(2))
    return handle ? <ProfilePage key={path} /> : <NotFound />
  }

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

/**
 * Session-aware shell bits: one-time upgrade notice and first sign-up
 * onboarding (username pick) for accounts without a profile.
 */
function AccountGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const toast = useToast()
  const [onboard, setOnboard] = useState(false)

  useEffect(() => {
    const n = takeUpgradeNotice()
    if (n) toast.show(n)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user || auth.isGuest) {
      setOnboard(false)
      return
    }
    let dead = false
    void fetchMyProfile(auth.user.id).then((p) => {
      if (!dead && !p) setOnboard(true)
    })
    return () => {
      dead = true
    }
  }, [auth.user?.id, auth.isGuest, auth.loading])

  return (
    <>
      {children}
      {onboard && auth.user && !auth.isGuest && <OnboardingModal onDone={() => setOnboard(false)} />}
    </>
  )
}

/** site-wide footer (hidden inside active games to keep the board tall) */
function Footer() {
  const { path } = useRoute()
  if (path.startsWith('/play/') || path === '/auth/callback') return null
  return (
    <footer className="site-footer">
      <span className="sf-copy">© 2026 FreeChess</span>
      <nav aria-label="Footer">
        <Link to="/leaderboard">Leaderboards</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/credits">Credits</Link>
        <a href="https://github.com/CodeByPartho/chess-multiplayer" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
    </footer>
  )
}

/** per-route document title (SEO hygiene + share previews) */
function useDocumentTitle(path: string) {
  useEffect(() => {
    let title = 'FreeChess — play chess online, free, no signup'
    if (path.startsWith('/@')) title = `${decodeURIComponent(path.slice(2))} · FreeChess`
    else if (path === '/leaderboard') title = 'Leaderboards · FreeChess'
    else if (path === '/login') title = 'Sign in · FreeChess'
    else if (path === '/account') title = 'Account settings · FreeChess'
    else if (path === '/privacy') title = 'Privacy Policy · FreeChess'
    else if (path === '/terms') title = 'Terms of Service · FreeChess'
    else if (path === '/play') title = 'Lobby · FreeChess'
    else if (path === '/computer') title = 'Play the Computer · FreeChess'
    else if (path === '/puzzles') title = 'Chess Puzzles · FreeChess'
    else if (path === '/analysis') title = 'Analysis · FreeChess'
    document.title = title
  }, [path])
}

function Shell() {
  const { path } = useRoute()
  useDocumentTitle(path)
  return (
    <AccountGate>
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
        <Footer />
        <TabBar />
      </div>
    </AccountGate>
  )
}

function App() {
  useEffect(() => {
    applyDocumentSettings()
    const unsub = subscribeSettings(() => applyDocumentSettings())
    const s = getSettings()
    sounds.setVolume(s.volume)
    sounds.setMuted(!s.sound)
    // warm the ~30 audio pools on the first user gesture — sounds can only
    // matter after interaction, so this stays off the boot/measurement path
    let warmed = false
    const warm = () => {
      if (warmed) return
      warmed = true
      sounds.preload()
      window.removeEventListener('pointerdown', warm)
      window.removeEventListener('keydown', warm)
    }
    window.addEventListener('pointerdown', warm, { once: true })
    window.addEventListener('keydown', warm, { once: true })

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMQ = () => applyDocumentSettings()
    mq.addEventListener('change', onMQ)

    if ('serviceWorker' in navigator && import.meta.env.PROD && location.hostname !== 'localhost' && !location.hostname.startsWith('127.')) {
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
        <Shell />
      </ToastProvider>
    </RouterProvider>
  )
}

export default App
