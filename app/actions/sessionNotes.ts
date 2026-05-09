'use server'

import { revalidatePath } from 'next/cache'
import { supabaseServer } from '@/lib/supabase/server'

export async function saveClinicianNotes(args: {
  sessionId: string
  patientId: string
  notes: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseServer
    .from('sessions')
    .update({ clinician_notes: args.notes })
    .eq('id', args.sessionId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/clinician/patients/${args.patientId}/sessions/${args.sessionId}/playback`)
  return { ok: true }
}

/**
 * Permanently delete a session and all its time-series data. ON DELETE CASCADE
 * on session_sets / session_reps / session_pauses / session_hr_samples /
 * session_pose_frames takes care of the rest.
 */
export async function deleteSessionAction(args: {
  sessionId: string
  patientId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseServer
    .from('sessions')
    .delete()
    .eq('id', args.sessionId)
    .eq('patient_id', args.patientId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/clinician/patients/${args.patientId}`)
  return { ok: true }
}
