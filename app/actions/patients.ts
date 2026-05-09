'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabaseServer } from '@/lib/supabase/server'

export async function createPatientAction(args: {
  displayName: string
  username: string
}): Promise<{ ok: false; error: string } | { ok: true }> {
  const displayName = args.displayName.trim()
  const username = args.username.trim().toLowerCase()

  if (!displayName) return { ok: false, error: 'Display name is required.' }
  if (!username) return { ok: false, error: 'Username is required.' }
  if (!/^[a-z0-9_.-]+$/.test(username))
    return { ok: false, error: 'Username may only contain lowercase letters, numbers, _, . or -' }

  // Check uniqueness
  const { count } = await supabaseServer
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('username', username)
  if ((count ?? 0) > 0) return { ok: false, error: 'Username is already taken.' }

  const { error } = await supabaseServer.from('users').insert({
    display_name: displayName,
    username,
    role: 'patient',
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/clinician/patients')
  redirect('/clinician/patients')
}
