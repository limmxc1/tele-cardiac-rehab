import { notFound } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'
import NewExerciseClient, { type InitialValues } from '../../new/NewExerciseClient'
import type { TrackedJointSpec } from '@/app/actions/exercises'

export default async function EditExercisePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { data: ex } = await supabaseServer
    .from('exercises')
    .select('id, name, instructions_text, reference_gif_url, tracked_joints')
    .eq('id', id)
    .is('archived_at', null)
    .single()

  if (!ex) notFound()

  const trackedJoints = Array.isArray(ex.tracked_joints)
    ? (ex.tracked_joints as unknown as TrackedJointSpec[]).filter(
        (t) => t && typeof t.joint === 'string' && typeof t.side === 'string',
      )
    : []

  const initial: InitialValues = {
    name: ex.name,
    instructions: ex.instructions_text ?? '',
    trackedJoints,
    existingGifUrl: ex.reference_gif_url ?? null,
  }

  return <NewExerciseClient exerciseId={ex.id} initial={initial} />
}
