import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadIdentity } from '@/lib/identity'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

/** online play is available when the project is configured */
export const onlineEnabled = !!url && !!anon

export const supabase: SupabaseClient = createClient(url || 'http://localhost', anon || 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // PKCE for OAuth + email links: the code verifier stays on the device
    flowType: 'pkce',
  },
})

let authPromise: Promise<void> | null = null

/** anonymous sign-in once per browser (guest = supabase auth user) */
export function ensureAuth(): Promise<void> {
  if (!onlineEnabled) return Promise.reject(new Error('Online play is not configured'))
  if (authPromise) return authPromise
  authPromise = (async () => {
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      const { error } = await supabase.auth.signInAnonymously()
      if (error) throw new Error(`Could not start a guest session (${error.message})`)
    }
    // the guests row must exist before any game row can reference it (FK)
    await syncGuestProfile()
  })()
  return authPromise
}

export async function myUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/** push local guest profile (username/avatar/flag) to the server */
export async function syncGuestProfile(): Promise<void> {
  const id = loadIdentity()
  const { error } = await supabase.rpc('sync_guest', {
    p_username: id.username,
    p_avatar_seed: id.avatarSeed,
    p_flag: id.flag,
  })
  if (error) throw new Error(`Profile sync failed: ${error.message}`)
}

/** heartbeat so disconnect-claims know when a player is present */
export function touchGuest(): void {
  void supabase.rpc('touch_guest').then(
    () => {},
    () => {},
  )
}

/** fetch server-side ratings and merge them into the local identity */
export async function pullRatings(): Promise<Record<string, { rating: number; rd: number }> | null> {
  const uid = await myUserId()
  if (!uid) return null
  const { data, error } = await supabase.from('guests').select('ratings').eq('id', uid).maybeSingle()
  if (error || !data) return null
  return (data.ratings as Record<string, { rating: number; rd: number }>) ?? null
}
