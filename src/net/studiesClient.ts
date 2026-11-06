/**
 * Studies cloud sync. The local copy in localStorage is the source of
 * truth for the UI; this mirrors studies to the `studies` table for
 * signed-in users so they follow the account. Every call fails soft:
 * offline, signed out, or the table missing all just skip the sync.
 */
import { supabase, onlineEnabled } from './supabase'
import type { Study } from '@/pages/StudiesPage'

interface StudyRow {
  id: string
  title: string
  data: Study
  updated_at: string
}

export async function fetchMyStudies(userId: string): Promise<Study[]> {
  if (!onlineEnabled) return []
  try {
    const { data, error } = await supabase.from('studies').select('id, title, data, updated_at').eq('owner', userId)
    if (error || !data) return []
    return (data as StudyRow[]).map((r) => r.data)
  } catch {
    return []
  }
}

export async function syncStudyUp(userId: string, study: Study): Promise<void> {
  if (!onlineEnabled) return
  try {
    await supabase.from('studies').upsert({
      id: study.id,
      owner: userId,
      title: study.title,
      data: study,
      updated_at: new Date(study.updatedAt).toISOString(),
    })
  } catch {
    /* best effort */
  }
}

export async function syncStudyDelete(userId: string, studyId: string): Promise<void> {
  if (!onlineEnabled) return
  try {
    await supabase.from('studies').delete().eq('id', studyId).eq('owner', userId)
  } catch {
    /* best effort */
  }
}
