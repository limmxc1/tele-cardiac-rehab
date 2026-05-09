'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'

export type LoginState = { error: string } | null

// NOT real auth — username routing only for MVP
export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const username = (formData.get('username') as string | null)?.trim() ?? ''
  if (!username) return { error: 'Please enter a username' }

  const { data: user, error } = await supabaseServer
    .from('users')
    .select('id, role, display_name')
    .eq('username', username)
    .single()

  if (error || !user) return { error: 'Unknown username' }

  const encoded = Buffer.from(
    JSON.stringify({ id: user.id, role: user.role, display_name: user.display_name })
  ).toString('base64')

  const cookieStore = await cookies()
  cookieStore.set('shf_session', encoded, {
    httpOnly: false, // client reads this to hydrate Zustand
    sameSite: 'lax',
    path: '/',
  })

  redirect(user.role === 'clinician' ? '/clinician' : '/patient')
}

export async function logoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete('shf_session')
  redirect('/login')
}
