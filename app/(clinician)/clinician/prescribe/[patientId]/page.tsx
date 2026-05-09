import { notFound } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'
import PrescribeClient from './PrescribeClient'

export default async function PrescribePage({
  params,
}: {
  params: Promise<{ patientId: string }>
}) {
  const { patientId } = await params

  const [{ data: patient }, { data: exercises }] = await Promise.all([
    supabaseServer
      .from('users')
      .select('id, username, display_name')
      .eq('id', patientId)
      .eq('role', 'patient')
      .single(),
    supabaseServer
      .from('exercises')
      .select('id, name, tracked_joints')
      .is('archived_at', null)
      .order('name'),
  ])

  if (!patient) notFound()

  return <PrescribeClient patient={patient} exercises={exercises ?? []} />
}
