import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/net/auth'
import { onlineEnabled } from '@/net/supabase'
import {
  createPost,
  createThread,
  fetchPosts,
  fetchThreads,
  type ForumPost,
  type ForumThread,
} from '@/net/socialClient'

const CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'news', label: 'News' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'site', label: 'Site & feedback' },
]

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ForumsPage() {
  const toast = useToast()
  const auth = useAuth()
  const [threads, setThreads] = useState<ForumThread[]>([])
  const [category, setCategory] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [posts, setPosts] = useState<ForumPost[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [newCategory, setNewCategory] = useState('general')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setThreads(await fetchThreads())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!openId) return
    void fetchPosts(openId).then(setPosts)
  }, [openId])

  const signedIn = !!auth.user && !auth.isGuest && onlineEnabled
  const visible = category ? threads.filter((t) => t.category === category) : threads
  const open = threads.find((t) => t.id === openId) ?? null

  const post = async () => {
    if (!title.trim() || !body.trim()) return
    setBusy(true)
    try {
      await createThread(newCategory, title.trim(), body.trim())
      setTitle('')
      setBody('')
      toast.show('Thread posted')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
  }

  const sendReply = async () => {
    if (!openId || !reply.trim()) return
    setBusy(true)
    try {
      await createPost(openId, reply.trim())
      setReply('')
      setPosts(await fetchPosts(openId))
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
  }

  if (open) {
    return (
      <div className="page-narrow">
        <button className="btn btn-ghost btn-sm" onClick={() => setOpenId(null)}>
          ← All threads
        </button>
        <h1 className="page-title" style={{ marginTop: 8 }}>
          {open.title}
        </h1>
        <p className="hint" style={{ marginBottom: 12 }}>
          started by {open.authorName} · {when(open.created_at)} · {CATEGORIES.find((c) => c.id === open.category)?.label ?? open.category}
        </p>
        <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
          {posts.map((p) => (
            <div key={p.id} className="card" style={{ padding: 12 }}>
              <div className="hint" style={{ marginBottom: 4 }}>
                <b style={{ color: 'var(--text)' }}>{p.authorName}</b> · {when(p.created_at)}
              </div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{p.body}</p>
            </div>
          ))}
          {posts.length === 0 && <p className="hint">No posts yet.</p>}
        </div>
        {signedIn ? (
          <div className="card" style={{ padding: 12 }}>
            <textarea
              className="input"
              rows={3}
              placeholder="Write a reply…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <button className="btn btn-primary" disabled={busy || !reply.trim()} onClick={() => void sendReply()}>
              Reply
            </button>
          </div>
        ) : (
          <p className="hint">Sign in to reply.</p>
        )}
      </div>
    )
  }

  return (
    <div className="page-narrow">
      <h1 className="page-title">Forums</h1>
      <p className="hint" style={{ marginBottom: 12 }}>
        Talk chess: openings, endgames, site news and feedback. Be decent; moderators remove spam.
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${category === null ? 'btn-primary' : ''}`} onClick={() => setCategory(null)}>
          All
        </button>
        {CATEGORIES.map((c) => (
          <button key={c.id} className={`btn btn-sm ${category === c.id ? 'btn-primary' : ''}`} onClick={() => setCategory(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {visible.map((t) => (
          <button key={t.id} className="action-card" onClick={() => setOpenId(t.id)}>
            <span>
              <span className="ac-title">{t.title}</span>
              <span className="ac-sub">
                {t.authorName} · {when(t.created_at)} · {t.posts} repl{t.posts === 1 ? 'y' : 'ies'} ·{' '}
                {CATEGORIES.find((c) => c.id === t.category)?.label ?? t.category}
              </span>
            </span>
          </button>
        ))}
        {visible.length === 0 && <p className="hint">No threads here yet. Start the first one below.</p>}
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>New thread</h3>
        {!signedIn && <p className="hint">Sign in to post.</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: '1 1 220px' }} />
            <select className="input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} aria-label="Category">
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <textarea className="input" rows={4} placeholder="Say it plainly…" value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn btn-primary" disabled={!signedIn || busy || !title.trim() || !body.trim()} onClick={() => void post()} style={{ justifySelf: 'start' }}>
            Post thread
          </button>
        </div>
      </div>
    </div>
  )
}
