import { useCallback, useEffect, useState } from 'react'
import { Link } from '@/router'
import { useToast } from '@/components/Toast'
import { Avatar } from '@/components/Avatar'
import { useAuth } from '@/net/auth'
import { onlineEnabled } from '@/net/supabase'
import {
  createClub,
  fetchClubMembers,
  fetchClubs,
  setClubMembership,
  type Club,
} from '@/net/socialClient'
import type { ProfileRow } from '@/net/profileClient'

export default function ClubsPage() {
  const toast = useToast()
  const auth = useAuth()
  const [clubs, setClubs] = useState<Club[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [members, setMembers] = useState<ProfileRow[]>([])
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setClubs(await fetchClubs())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!openId) return
    void fetchClubMembers(openId).then(setMembers)
  }, [openId])

  const signedIn = !!auth.user && !auth.isGuest && onlineEnabled

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await createClub(name.trim(), desc.trim())
      setName('')
      setDesc('')
      toast.show('Club created')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
  }

  const toggle = async (club: Club) => {
    setBusy(true)
    try {
      await setClubMembership(club.id, !club.mine)
      await load()
      if (openId === club.id) setMembers(await fetchClubMembers(club.id))
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="page-narrow">
      <h1 className="page-title">Clubs</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        Player-run clubs: a home for your school, your city, your team. Join as many as you like.
      </p>

      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {clubs.map((c) => (
          <div key={c.id} className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <b style={{ fontSize: 16 }}>{c.name}</b>
              <span className="hint">
                {c.members} member{c.members === 1 ? '' : 's'}
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                  {openId === c.id ? 'Hide members' : 'Members'}
                </button>
                <button
                  className={`btn btn-sm ${c.mine ? '' : 'btn-primary'}`}
                  disabled={!signedIn || busy}
                  onClick={() => void toggle(c)}
                >
                  {c.mine ? 'Leave' : 'Join'}
                </button>
              </span>
            </div>
            {c.description && <p style={{ margin: '6px 0 0', fontSize: 14 }}>{c.description}</p>}
            {openId === c.id && (
              <div style={{ marginTop: 10 }}>
                {members.length === 0 && <p className="hint">No members to show yet.</p>}
                {members.map((m) => (
                  <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                    <Avatar seed={m.avatar_seed} path={m.avatar_path} name={m.username} size={22} />
                    <Link to={`/@${m.username}`}>{m.username}</Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {clubs.length === 0 && <p className="hint">No clubs yet. Found the first one below.</p>}
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Found a club</h3>
        {!signedIn && <p className="hint">Sign in to found or join a club.</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          <input className="input" placeholder="Club name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="What is this club about? (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <button className="btn btn-primary" disabled={!signedIn || busy || !name.trim()} onClick={() => void create()} style={{ justifySelf: 'start' }}>
            Create club
          </button>
        </div>
      </div>
    </div>
  )
}
