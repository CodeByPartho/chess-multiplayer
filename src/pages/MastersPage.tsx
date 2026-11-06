import { useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import { Board } from '@/board/Board'
import { useSettings } from '@/lib/settings'
import { Link } from '@/router'
import { MASTERS, type MasterLine, type MasterProfile } from '@/assets/masters'

interface Selected {
  master: MasterProfile
  line: MasterLine
}

/** masters who also exist as playable champion bots */
const BOT_IDS = new Set(['magnus', 'hikaru', 'kasparov', 'karpov', 'fischer'])

export default function MastersPage() {
  const [selected, setSelected] = useState<Selected | null>(null)

  if (selected) {
    return <LineStepper master={selected.master} line={selected.line} onBack={() => setSelected(null)} />
  }

  return (
    <div className="page-narrow" style={{ maxWidth: 860 }}>
      <h1 className="page-title">The masters&apos; lines</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        Every great player owns a few routes: lines he played for decades until they became his
        signature. Step through them, read the idea behind each one, then go make a line your own
        — your <Link to="/insights">opening mastery</Link> tracks the routes you play most. You can
        also <Link to="/computer">face five of them</Link> as bots that play in their style.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {MASTERS.map((m) => (
          <div key={m.id} className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 16 }}>{m.name}</b>
              <span className="hint">{m.years}</span>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: 14, margin: '6px 0 10px' }}>{m.style}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {m.lines.map((l) => (
                <button
                  key={l.name}
                  className="chip"
                  style={{ justifyContent: 'space-between', width: '100%', cursor: 'pointer' }}
                  onClick={() => setSelected({ master: m, line: l })}
                >
                  <span>{l.name}</span>
                  <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                    as {l.asColor === 'w' ? 'White' : 'Black'} · {l.sans.length} moves
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function LineStepper({ master, line, onBack }: { master: MasterProfile; line: MasterLine; onBack: () => void }) {
  const settings = useSettings()
  const [ply, setPly] = useState(0)

  const frames = useMemo(() => {
    const chess = new Chess()
    const out: { fen: string; lastMove: { from: string; to: string } | null }[] = [
      { fen: chess.fen(), lastMove: null },
    ]
    for (const san of line.sans) {
      const mv = chess.move(san)
      out.push({ fen: chess.fen(), lastMove: { from: mv.from, to: mv.to } })
    }
    return out
  }, [line])

  const pairs: { n: number; w: string; b?: string }[] = []
  for (let i = 0; i < line.sans.length; i += 2) {
    pairs.push({ n: i / 2 + 1, w: line.sans[i], b: line.sans[i + 1] })
  }

  return (
    <div className="page-narrow" style={{ maxWidth: 860 }}>
      <button className="btn btn-sm" onClick={onBack} style={{ marginBottom: 12 }}>
        ← All masters
      </button>
      <h1 className="page-title" style={{ marginBottom: 2 }}>{line.name}</h1>
      <p className="hint" style={{ marginBottom: 12 }}>
        {master.name} · as {line.asColor === 'w' ? 'White' : 'Black'} · move {ply} of {line.sans.length}
      </p>

      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <Board
          fen={frames[ply].fen}
          orientation={line.asColor}
          movable={[]}
          lastMove={frames[ply].lastMove ?? undefined}
          pieceSet={settings.pieceSet}
          coords={settings.coords}
          ariaLabel={`${line.name} board`}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
          <button className="btn btn-sm" disabled={ply === 0} onClick={() => setPly(0)}>|◀</button>
          <button className="btn btn-sm" disabled={ply === 0} onClick={() => setPly((p) => Math.max(0, p - 1))}>◀ Prev</button>
          <button className="btn btn-sm" disabled={ply >= line.sans.length} onClick={() => setPly((p) => Math.min(line.sans.length, p + 1))}>Next ▶</button>
          <button className="btn btn-sm" disabled={ply >= line.sans.length} onClick={() => setPly(line.sans.length)}>▶|</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, justifyContent: 'center' }}>
        {pairs.map((pr) => (
          <span key={pr.n} className="hint" style={{ fontSize: 13.5 }}>
            {pr.n}.{' '}
            <button
              onClick={() => setPly(pr.n * 2 - 1)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: ply === pr.n * 2 - 1 ? 'var(--accent)' : 'inherit', fontWeight: ply === pr.n * 2 - 1 ? 700 : 400, padding: 0 }}
            >
              {pr.w}
            </button>{' '}
            {pr.b && (
              <button
                onClick={() => setPly(pr.n * 2)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: ply === pr.n * 2 ? 'var(--accent)' : 'inherit', fontWeight: ply === pr.n * 2 ? 700 : 400, padding: 0 }}
              >
                {pr.b}
              </button>
            )}
          </span>
        ))}
      </div>

      <div className="card" style={{ padding: 14, marginTop: 14 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>The idea</h3>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--text-dim)' }}>{line.note}</p>
        <p style={{ margin: '10px 0 0', fontSize: 14 }}>
          {BOT_IDS.has(master.id) ? (
            <Link to="/computer">Play against {master.name.split(' ').slice(-1)[0]}&apos;s style</Link>
          ) : (
            <span className="hint">Capablanca is here to study. The playable champion bots are Magnus, Hikaru, Kasparov, Karpov and Fischer.</span>
          )}
        </p>
      </div>
    </div>
  )
}
