import { useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import { Board } from '@/board/Board'
import { Link } from '@/router'
import { useSettings } from '@/lib/settings'
import { useToast } from '@/components/Toast'
import { load, save } from '@/lib/storage'
import { copyText } from '@/lib/clipboard'
import { syncStudyUp, fetchMyStudies } from '@/net/studiesClient'
import { useAuth } from '@/net/auth'
import type { PieceColor } from '@/board/pieces'

export interface StudyChapter {
  title: string
  startFen: string
  ucis: string[]
  comments: Record<number, string>
}

export interface Study {
  id: string
  title: string
  chapters: StudyChapter[]
  updatedAt: number
}

const KEY = 'fc.studies'
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function loadStudies(): Study[] {
  return load<Study[]>(KEY, [])
}

function encodeShare(study: Study): string {
  const json = JSON.stringify(study)
  return `${window.location.origin}/studies#s=${btoa(unescape(encodeURIComponent(json)))}`
}

function decodeShare(hash: string): Study | null {
  try {
    const m = hash.match(/#s=([A-Za-z0-9+/=]+)/)
    if (!m) return null
    const study = JSON.parse(decodeURIComponent(escape(atob(m[1])))) as Study
    if (!study || !Array.isArray(study.chapters)) return null
    return { ...study, id: `imported-${Date.now()}`, title: `${study.title} (shared)` }
  } catch {
    return null
  }
}

function ChapterEditor({ study, chapterIdx, onChange, onBack }: { study: Study; chapterIdx: number; onChange: (s: Study) => void; onBack: () => void }) {
  const settings = useSettings()
  const chapter = study.chapters[chapterIdx]
  const [ply, setPly] = useState(0)
  const [fenInput, setFenInput] = useState('')

  const chess = useMemo(() => {
    const c = new Chess(chapter.startFen)
    for (let i = 0; i < ply && i < chapter.ucis.length; i++) {
      const u = chapter.ucis[i]
      try {
        c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined })
      } catch {
        break
      }
    }
    return c
  }, [chapter, ply])

  const patch = (ch: StudyChapter) => {
    const next = { ...study, chapters: study.chapters.map((c, i) => (i === chapterIdx ? ch : c)), updatedAt: Date.now() }
    onChange(next)
  }

  const onMove = (uci: string) => {
    const kept = chapter.ucis.slice(0, ply)
    const comments: Record<number, string> = {}
    for (const [k, v] of Object.entries(chapter.comments)) if (Number(k) <= kept.length) comments[Number(k)] = v
    patch({ ...chapter, ucis: [...kept, uci], comments })
    setPly(kept.length + 1)
  }

  const side = chess.turn() as PieceColor
  const comment = chapter.comments[ply] ?? ''

  return (
    <div className="game-layout" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="game-main">
        <div className="board-slot">
          <Board
            fen={chess.fen()}
            orientation="w"
            movable={[side]}
            onMove={onMove}
            legalTargets={(sq) => chess.moves({ square: sq as never, verbose: true }).map((m) => m.to)}
            pieceSet={settings.pieceSet}
            coords={settings.coords}
            ariaLabel={`Study chapter: ${chapter.title}`}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
          <button className="btn btn-sm" disabled={ply === 0} onClick={() => setPly(0)}>
            |←
          </button>
          <button className="btn btn-sm" disabled={ply === 0} onClick={() => setPly(ply - 1)}>
            ←
          </button>
          <span className="hint" style={{ alignSelf: 'center' }}>
            move {ply}/{chapter.ucis.length}
          </span>
          <button className="btn btn-sm" disabled={ply >= chapter.ucis.length} onClick={() => setPly(ply + 1)}>
            →
          </button>
          <button className="btn btn-sm" disabled={ply >= chapter.ucis.length} onClick={() => setPly(chapter.ucis.length)}>
            →|
          </button>
        </div>
      </div>
      <div className="game-side" data-tab="moves">
        <div className="pane" data-pane="moves">
          <div className="side-head">
            <b>{study.title}</b>
            <span>study</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {study.chapters.map((c, i) => (
              <button key={i} className={`btn btn-sm ${i === chapterIdx ? 'btn-primary' : ''}`} onClick={onBack}>
                {c.title}
              </button>
            ))}
          </div>
          <label className="hint">Chapter title</label>
          <input
            className="input"
            value={chapter.title}
            onChange={(e) => patch({ ...chapter, title: e.target.value })}
            style={{ width: '100%', marginBottom: 10 }}
          />
          <label className="hint">Note on this move</label>
          <textarea
            className="input"
            rows={3}
            value={comment}
            placeholder="Why this move? What is the idea?"
            onChange={(e) => patch({ ...chapter, comments: { ...chapter.comments, [ply]: e.target.value } })}
            style={{ width: '100%', marginBottom: 10 }}
          />
          <label className="hint">Set start position (FEN)</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input className="input" value={fenInput} placeholder={START_FEN} onChange={(e) => setFenInput(e.target.value)} style={{ flex: 1 }} />
            <button
              className="btn btn-sm"
              onClick={() => {
                try {
                  new Chess(fenInput)
                  patch({ ...chapter, startFen: fenInput, ucis: [], comments: {} })
                  setPly(0)
                } catch {
                  /* invalid FEN: ignore */
                }
              }}
            >
              Set
            </button>
          </div>
          <p className="hint">Play moves on the board to build the line. Step back and play a different move to replace what follows.</p>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            ← Study overview
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StudiesPage() {
  const toast = useToast()
  const auth = useAuth()
  const [studies, setStudies] = useState<Study[]>(() => loadStudies())
  const [openId, setOpenId] = useState<string | null>(null)
  const [chapterIdx, setChapterIdx] = useState<number | null>(null)

  // import from a share link
  useEffect(() => {
    const shared = decodeShare(window.location.hash)
    if (shared) {
      setStudies((prev) => {
        const next = [shared, ...prev]
        save(KEY, next)
        return next
      })
      toast.show('Shared study imported')
      window.history.replaceState(null, '', '/studies')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // merge cloud studies for signed-in users (best effort)
  useEffect(() => {
    if (!auth.user || auth.isGuest) return
    let dead = false
    void fetchMyStudies(auth.user.id).then((remote) => {
      if (dead || remote.length === 0) return
      setStudies((prev) => {
        const ids = new Set(prev.map((s) => s.id))
        const merged = [...prev, ...remote.filter((r) => !ids.has(r.id))]
        save(KEY, merged)
        return merged
      })
    })
    return () => {
      dead = true
    }
  }, [auth.user?.id, auth.isGuest])

  const persist = (next: Study[]) => {
    setStudies(next)
    save(KEY, next)
  }

  const upsert = (study: Study) => {
    persist(studies.map((s) => (s.id === study.id ? study : s)))
    if (auth.user && !auth.isGuest) void syncStudyUp(auth.user.id, study)
  }

  const create = () => {
    const study: Study = {
      id: `study-${Date.now()}`,
      title: 'Untitled study',
      chapters: [{ title: 'Chapter 1', startFen: START_FEN, ucis: [], comments: {} }],
      updatedAt: Date.now(),
    }
    persist([study, ...studies])
    if (auth.user && !auth.isGuest) void syncStudyUp(auth.user.id, study)
    setOpenId(study.id)
  }

  const open = studies.find((s) => s.id === openId) ?? null

  if (open && chapterIdx !== null && open.chapters[chapterIdx]) {
    return <ChapterEditor study={open} chapterIdx={chapterIdx} onChange={upsert} onBack={() => setChapterIdx(null)} />
  }

  if (open) {
    return (
      <div className="page-narrow">
        <button className="btn btn-ghost btn-sm" onClick={() => setOpenId(null)}>
          ← All studies
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
          <input
            className="input"
            value={open.title}
            onChange={(e) => upsert({ ...open, title: e.target.value, updatedAt: Date.now() })}
            style={{ fontSize: 18, fontWeight: 700, flex: 1 }}
            aria-label="Study title"
          />
          <button
            className="btn btn-sm"
            onClick={() => {
              void copyText(encodeShare(open)).then(() => toast.show('Share link copied'))
            }}
          >
            Copy share link
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => {
              persist(studies.filter((s) => s.id !== open.id))
              setOpenId(null)
            }}
          >
            Delete
          </button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {open.chapters.map((c, i) => (
            <button key={i} className="action-card" onClick={() => setChapterIdx(i)}>
              <span>
                <span className="ac-title">{c.title}</span>
                <span className="ac-sub">{c.ucis.length} moves annotated</span>
              </span>
            </button>
          ))}
          <button
            className="btn"
            onClick={() =>
              upsert({ ...open, chapters: [...open.chapters, { title: `Chapter ${open.chapters.length + 1}`, startFen: START_FEN, ucis: [], comments: {} }] })
            }
          >
            + Add chapter
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-narrow">
      <h1 className="page-title">Studies</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        Your own annotated boards: build lines move by move, note the ideas, share with a link. Saved on this device
        {auth.user && !auth.isGuest ? ' and synced to your account' : ''}.
      </p>
      <button className="btn btn-primary" onClick={create} style={{ marginBottom: 14 }}>
        New study
      </button>
      <div style={{ display: 'grid', gap: 10 }}>
        {studies.map((s) => (
          <button key={s.id} className="action-card" onClick={() => setOpenId(s.id)}>
            <span>
              <span className="ac-title">{s.title}</span>
              <span className="ac-sub">
                {s.chapters.length} chapter{s.chapters.length === 1 ? '' : 's'} · updated {new Date(s.updatedAt).toLocaleDateString()}
              </span>
            </span>
          </button>
        ))}
        {studies.length === 0 && <p className="hint">No studies yet. Create one to save the lines you care about.</p>}
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        <Link to="/analysis">Open the analysis board</Link> to explore a position first.
      </p>
    </div>
  )
}
