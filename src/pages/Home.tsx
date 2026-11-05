import { useState, type ReactNode } from 'react'
import { Link, useRoute } from '@/router'
import { QUICK_TIME_CONTROLS, type TimeControl, type TCType } from '@/lib/chess/types'
import { setMatchPrefs } from '@/lib/matchPrefs'
import { loadHistory, resultForMe } from '@/lib/history'
import { load, save } from '@/lib/storage'
import { Modal } from '@/components/Modal'
import { IconBlocks, IconBolt, IconChart, IconClock, IconCpu, IconFlame, IconTarget, IconUsers } from '@/components/icons'

const SECTIONS: { type: TCType; label: string; icon: ReactNode }[] = [
  { type: 'bullet', label: 'Bullet', icon: <IconBolt size={14} /> },
  { type: 'blitz', label: 'Blitz', icon: <IconFlame size={14} /> },
  { type: 'rapid', label: 'Rapid', icon: <IconTarget size={14} /> },
  { type: 'classical', label: 'Classical', icon: <IconClock size={14} /> },
]

export default function Home() {
  const { navigate } = useRoute()
  const [rated, setRated] = useState(() => load('cm.ratedPref', true))
  const [showCustom, setShowCustom] = useState(false)
  const [customMin, setCustomMin] = useState(10)
  const [customInc, setCustomInc] = useState(0)
  const history = loadHistory().slice(0, 5)

  const startPairing = (tc: TimeControl, isRated: boolean) => {
    setMatchPrefs({ tc, rated: isRated })
    save('cm.ratedPref', isRated)
    navigate('/play')
  }

  return (
    <div className="home-grid">
      <section className="card" aria-label="Quick pairing">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 20 }}>
          Play online
          <span className="seg" role="group" aria-label="Rated or casual" style={{ marginLeft: 'auto', fontSize: 13 }}>
            <button className={!rated ? 'active' : ''} onClick={() => setRated(false)}>
              Casual
            </button>
            <button className={rated ? 'active' : ''} onClick={() => setRated(true)}>
              Rated
            </button>
          </span>
        </h2>
        {SECTIONS.map((sec) => (
          <div className="tc-section" key={sec.type}>
            <div className="tc-label">
              <span>{sec.icon}</span> {sec.label}
            </div>
            <div className="tc-row">
              {QUICK_TIME_CONTROLS.filter((t) => t.type === sec.type).map((tc) => (
                <button key={tc.label} className="tc-btn" onClick={() => startPairing(tc, rated)}>
                  <span className="tc-time">{tc.label}</span>
                  <span className="tc-name">
                    {tc.inc > 0 ? `${tc.inc}s increment` : 'no increment'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="tc-section">
          <div className="tc-label"><IconClock size={14} /> Custom</div>
          <div className="tc-row">
            <button className="tc-btn" onClick={() => setShowCustom(true)}>
              <span className="tc-time">⏱</span>
              <span className="tc-name">Set your own</span>
            </button>
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          No account needed — you play as a guest with a local rating. Rated games update your Glicko-2 rating.
        </p>
      </section>

      <div className="home-actions">
        <Link to="/computer" className="action-card">
          <span className="ac-icon"><IconCpu size={22} /></span>
          <span>
            <span className="ac-title">Play vs computer</span>
            <span className="ac-sub">20 levels, personalities, hints & takebacks</span>
          </span>
        </Link>
        <Link to="/puzzles" className="action-card">
          <span className="ac-icon"><IconBlocks size={22} /></span>
          <span>
            <span className="ac-title">Puzzles</span>
            <span className="ac-sub">Daily puzzle, puzzle rush, themes</span>
          </span>
        </Link>
        <Link to="/analysis" className="action-card">
          <span className="ac-icon"><IconChart size={22} /></span>
          <span>
            <span className="ac-title">Analysis board</span>
            <span className="ac-sub">Engine, opening explorer, FEN & PGN editor</span>
          </span>
        </Link>
        <Link to="/passandplay" className="action-card">
          <span className="ac-icon"><IconUsers size={22} /></span>
          <span>
            <span className="ac-title">Pass &amp; play</span>
            <span className="ac-sub">Two players, one device</span>
          </span>
        </Link>

        {history.length > 0 && (
          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Recent games</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map((g) => {
                const me = resultForMe(g)
                const opp = g.myColor === 'w' ? g.black : g.white
                return (
                  <Link key={g.id} to={`/review/${g.id}`} className="chip" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                      <span>{me === 'win' ? '✓' : me === 'loss' ? '✕' : g.result.winner ? '½' : '…'}</span>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opp.name}</span>
                    </span>
                    <span className="rating" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                      {g.tc?.label ?? '—'} · {new Date(g.date).toLocaleDateString()}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        <section className="card compare" aria-label="How FreeChess compares">
          <h3 style={{ fontSize: 16, marginBottom: 4 }}>FreeChess vs Chess.com vs Lichess</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: 13.5, marginTop: 0 }}>
            What the free plans actually include. The review and puzzle features Chess.com charges for are free here.
          </p>
          <div className="compare-grid" role="table">
            <div className="cg-row cg-head" role="row">
              <span role="columnheader"></span>
              <span role="columnheader" className="cg-us">FreeChess</span>
              <span role="columnheader">Chess.com</span>
              <span role="columnheader">Lichess</span>
            </div>
            {[
              ['Full engine game review', 'Free', 'Limited free', 'Free'],
              ['Ads', 'None', 'Yes', 'None'],
              ['Play with no account', 'Yes', 'Yes', 'Yes'],
              ['Takebacks (casual games)', 'Yes', 'Daily only', 'Yes'],
              ['Premoves', 'Yes', 'Yes', 'Yes'],
              ['Puzzles and Puzzle Rush', 'Free', 'Limited free', 'Free'],
            ].map(([label, us, cc, li]) => (
              <div className="cg-row" role="row" key={label}>
                <span className="cg-label" role="rowheader">{label}</span>
                <span className="cg-us" role="cell">{us}</span>
                <span role="cell">{cc}</span>
                <span role="cell">{li}</span>
              </div>
            ))}
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>Checked against each site's public free tier, November 2026.</p>
        </section>

        <Link to="/credits" className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }}>
          Credits & licenses
        </Link>
      </div>

      {showCustom && (
        <Modal
          title="Custom game"
          onClose={() => setShowCustom(false)}
          actions={
            <>
              <button className="btn" onClick={() => setShowCustom(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const tc: TimeControl = {
                    base: Math.max(10, Math.min(180, customMin)) * 60_000,
                    inc: Math.max(0, Math.min(60, customInc)) * 1_000,
                    type: 'custom',
                    label: `${customMin}+${customInc}`,
                  }
                  setShowCustom(false)
                  startPairing(tc, rated)
                }}
              >
                Find opponent
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="cmin">Base time (minutes)</label>
            <input
              id="cmin"
              className="input"
              type="number"
              min={1}
              max={180}
              value={customMin}
              onChange={(e) => setCustomMin(Number(e.target.value) || 1)}
            />
          </div>
          <div className="field">
            <label htmlFor="cinc">Increment (seconds per move)</label>
            <input
              id="cinc"
              className="input"
              type="number"
              min={0}
              max={60}
              value={customInc}
              onChange={(e) => setCustomInc(Number(e.target.value) || 0)}
            />
          </div>
          <p className="hint">Opponents are matched by rating within the same time control family.</p>
        </Modal>
      )}
    </div>
  )
}
