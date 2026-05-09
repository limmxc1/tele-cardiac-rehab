import { notFound } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'
import EditPrescriptionClient from './EditPrescriptionClient'

export default async function EditPrescriptionPage({
  params,
}: {
  params: Promise<{ id: string; prescriptionId: string }>
}) {
  const { id: patientId, prescriptionId } = await params

  const [
    { data: prescription },
    { data: itemRows, error: itemsError },
    { data: exercises },
    { count: sessionCount },
  ] = await Promise.all([
    supabaseServer
      .from('prescriptions')
      .select('id, scheduled_date, hr_upper_limit_bpm, status')
      .eq('id', prescriptionId)
      .eq('patient_id', patientId)
      .single(),
    supabaseServer
      .from('prescription_items')
      .select('*, exercises(*)')
      .eq('prescription_id', prescriptionId)
      .order('sequence_order'),
    supabaseServer
      .from('exercises')
      .select('id, name, primary_joint, primary_side, start_angle_min, start_angle_max, end_angle_min, end_angle_max')
      .is('archived_at', null)
      .order('name'),
    supabaseServer
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('prescription_id', prescriptionId),
  ])

  if (!prescription) notFound()

  return (
    <EditPrescriptionClient
      patientId={patientId}
      prescription={prescription}
      initialItems={(itemRows ?? []).map((r) => {
        const ex = r.exercises as {
          name: string
          primary_joint: string
          primary_side: string
          start_angle_min: number
          start_angle_max: number
          end_angle_min: number
          end_angle_max: number
        } | null
        return {
          key: r.id,
          exerciseId: r.exercise_id,
          exerciseName: ex?.name ?? 'Unknown',
          exerciseJoint: ex?.primary_joint ?? '',
          exerciseSide: ex?.primary_side ?? '',
          defaultStartMin: ex?.start_angle_min ?? 0,
          defaultStartMax: ex?.start_angle_max ?? 180,
          defaultEndMin: ex?.end_angle_min ?? 0,
          defaultEndMax: ex?.end_angle_max ?? 180,
          numSets: r.num_sets,
          repsPerSet: r.reps_per_set,
          restSeconds: r.rest_seconds,
          showOverrides: r.override_start_angle_min !== null,
          overrideStartMin: r.override_start_angle_min !== null ? String(r.override_start_angle_min) : '',
          overrideStartMax: r.override_start_angle_max !== null ? String(r.override_start_angle_max) : '',
          overrideEndMin: r.override_end_angle_min !== null ? String(r.override_end_angle_min) : '',
          overrideEndMax: r.override_end_angle_max !== null ? String(r.override_end_angle_max) : '',
        }
      })}
      exercises={exercises ?? []}
      hasSessionHistory={(sessionCount ?? 0) > 0}
    />
  )
}
