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
