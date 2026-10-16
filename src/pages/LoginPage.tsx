import { AuthPanel } from '@/components/AuthPanel'
import { Link } from '@/router'

/** dedicated sign-in / sign-up page (footer links, shared URLs, auth errors) */
export default function LoginPage() {
  return (
    <div className="center-page">
      <div className="card auth-card">
        <img src="/icons/icon.svg" alt="" width={44} height={44} />
        <h1 style={{ margin: '4px 0 2px' }}>Sign in</h1>
        <AuthPanel purpose="signin" />
        <p className="auth-note" style={{ marginTop: 14 }}>
          Just browsing? Keep playing as a guest — you can create an account anytime from the
          header, and your guest rating moves with you. <Link to="/play">Back to the lobby</Link>
        </p>
      </div>
    </div>
  )
}
