import { useState } from 'react'
import { AuthPanel, type AuthPurpose } from '@/components/AuthPanel'
import { Link } from '@/router'

/** dedicated sign-in / sign-up page (footer links, shared URLs, auth errors) */
export default function LoginPage() {
  const [mode, setMode] = useState<AuthPurpose>('signin')
  return (
    <div className="center-page">
      <div className="card auth-card">
        <img src="/icons/icon.svg" alt="" width={44} height={44} />
        <h1 style={{ margin: '4px 0 2px' }}>{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
        <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
          <button
            role="tab"
            aria-selected={mode === 'signin'}
            className={mode === 'signin' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => setMode('signin')}
          >
            Sign in
          </button>
          <button
            role="tab"
            aria-selected={mode === 'upgrade'}
            className={mode === 'upgrade' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => setMode('upgrade')}
          >
            Create account
          </button>
        </div>
        <AuthPanel key={mode} purpose={mode} />
        <p className="auth-note" style={{ marginTop: 14 }}>
          {mode === 'signin'
            ? 'Just browsing? Keep playing as a guest — create an account whenever you like, and your guest rating moves with you. '
            : 'Been playing as a guest? Creating an account keeps the same player, so your rating and games stay. '}
          <Link to="/play">Back to the lobby</Link>
        </p>
      </div>
    </div>
  )
}
