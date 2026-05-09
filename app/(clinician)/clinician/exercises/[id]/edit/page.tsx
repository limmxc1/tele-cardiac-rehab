import { notFound } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'
import NewExerciseClient from '../../new/NewExerciseClient'

export default async function EditExercisePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { data: ex } = await supabaseServer
    .from('exercises')
    .select('*')
    .eq('id', id)
    .is('archived_at', null)
    .single()

  if (!ex) notFound()

  return (
    <NewExerciseClient
      exerciseId={ex.id}
      initial={{
        name: ex.name,
        instructions: ex.instructions_text ?? '',
        joint: ex.primary_joint as 'knee' | 'hip' | 'shoulder' | 'elbow' | 'ankle',
        side: ex.primary_side as 'left' | 'right' | 'both',
        direction: ex.direction as 'flexion_first' | 'extension_first',
        viewOrientation: ex.view_orientation as 'front' | 'side',
        startMin: ex.start_angle_min,
        startMax: ex.start_angle_max,
        endMin: ex.end_angle_min,
        endMax: ex.end_angle_max,
        secondaryEnabled: ex.secondary_joint !== null,
        secondaryJoint: (ex.secondary_joint ?? 'hip') as 'knee' | 'hip' | 'shoulder' | 'elbow' | 'ankle',
        secondaryStartMin: ex.secondary_start_min ?? 80,
        secondaryStartMax: ex.secondary_start_max ?? 100,
        secondaryEndMin: ex.secondary_end_min ?? 150,
        secondaryEndMax: ex.secondary_end_max ?? 180,
        existingGifUrl: ex.reference_gif_url ?? null,
      }}
    />
  )
}
