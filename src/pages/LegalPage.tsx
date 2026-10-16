import { Link } from '@/router'

type Doc = { title: string; updated: string; intro: string; sections: { h: string; p: string[] }[] }

const PRIVACY: Doc = {
  title: 'Privacy Policy',
  updated: 'October 2026',
  intro:
    'FreeChess is a free chess platform. This policy explains what we store, why, and how to remove it. The short version: we keep only what the product needs, we never sell data, and you can delete everything from your account page.',
  sections: [
    {
      h: 'What we store',
      p: [
        'Accounts: your email address (when you sign up or upgrade a guest), your username, avatar and optional country flag.',
        'Game data: moves, results, time controls and timestamps of games you play, so boards can be replayed and archives shown. Finished games are kept even after account deletion, but with your seat anonymized (no link back to you).',
        'Ratings: your rating history per category (Bullet, Blitz, Rapid, Classical, Puzzle), which is derived from your games and shown on your public profile.',
        'Guests: if you play without an account, a random guest id, display name and ratings are stored so your session survives reloads.',
        'Logs: standard server logs (IP, user agent) retained briefly by our infrastructure providers for security and abuse prevention.',
      ],
    },
    {
      h: 'What is public',
      p: [
        'Your profile page (/@username), your ratings, records, rating chart and finished games are public — that is what leaderboards and sharing are built on.',
        'Email addresses are never shown publicly.',
        'You can pick a username at any time in account settings; until you do, your account is not listed on leaderboards.',
      ],
    },
    {
      h: 'Sign-in options and third parties',
      p: [
        'You can sign in with Google, Discord or GitHub (OAuth) or with a one-time email code. The providers only share your basic identity (email, avatar) with us.',
        'Supabase hosts our database and authentication. Cloudflare Turnstile may be used to prevent automated sign-ups (it checks browser signals without cross-site tracking cookies). Netlify hosts the site. These providers process data on our behalf under their own policies.',
        'We do not use advertising trackers and we do not sell or share personal data with third parties for marketing.',
      ],
    },
    {
      h: 'Your rights',
      p: [
        'Delete everything: Account settings → Delete account. This removes your profile, ratings, history and personal data immediately; remaining game archives are anonymized.',
        'Download your data: Account settings → Download my data (JSON of your profile, ratings and games).',
        'Questions or requests: open an issue on github.com/CodeByPartho/chess-multiplayer.',
      ],
    },
  ],
}

const TERMS: Doc = {
  title: 'Terms of Service',
  updated: 'October 2026',
  intro:
    'By using FreeChess you agree to these terms. They are written to keep play fair and the community healthy — nothing surprising.',
  sections: [
    {
      h: 'Fair play',
      p: [
        'No cheating: using engines, opening books, tablebases, or receiving outside help during human-vs-human rated games is forbidden. Computer assistance in a rated game is grounds for account removal and rating reset.',
        'No account manipulation: boosting ratings by coordinating results with the same opponent is limited automatically (repeat pairings turn casual beyond a cap), and abusive patterns may lead to bans.',
        'Play your own games: one account per person; don’t share accounts.',
      ],
    },
    {
      h: 'Usernames and content',
      p: [
        'Usernames must not impersonate others, contain slurs or offensive content, or use reserved names (site, admin, stockfish, and similar). We may rename or remove accounts that break this.',
        'Chat messages must stay civil. Use the report button for abuse — reports are reviewed.',
        'Your username and games appear on public profiles and leaderboards.',
      ],
    },
    {
      h: 'Ratings',
      p: [
        'Ratings use the Glicko-2 system on a 200-point start scale, computed only by the server at game end. Rated games require at least two moves from each player; timeout counts as a loss.',
        'Ratings are a game metric, not property, and have no monetary value. We may adjust or reset ratings to preserve fairness (for example after detected abuse).',
      ],
    },
    {
      h: 'Availability and termination',
      p: [
        'The service is provided as-is; games may be interrupted by downtime and we can’t guarantee availability.',
        'You can delete your account at any time. We may suspend accounts that violate these terms, remove content, or discontinue the service with reasonable notice where possible.',
        'Questions: open an issue on github.com/CodeByPartho/chess-multiplayer.',
      ],
    },
  ],
}

function LegalPage({ doc }: { doc: Doc }) {
  return (
    <div className="page narrow legal">
      <h1 style={{ marginBottom: 4 }}>{doc.title}</h1>
      <p className="auth-note" style={{ marginTop: 0 }}>
        Last updated {doc.updated}
      </p>
      <p className="legal-intro">{doc.intro}</p>
      {doc.sections.map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          {s.p.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </section>
      ))}
      <p className="auth-note">
        <Link to="/">← Back to FreeChess</Link>
      </p>
    </div>
  )
}

export function PrivacyPage() {
  return <LegalPage doc={PRIVACY} />
}

export function TermsPage() {
  return <LegalPage doc={TERMS} />
}
