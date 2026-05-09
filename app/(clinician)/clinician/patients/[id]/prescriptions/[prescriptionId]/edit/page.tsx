import { notFound } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'
import EditPrescriptionClient from './EditPrescriptionClient'
import type { TrackedJointSpec } from '@/app/actions/exercises'

function describeTracked(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return '—'
  const list = (raw as TrackedJointSpec[]).filter(
    (t) => t && typeof t.joint === 'string' && typeof t.side === 'string',
  )
  if (list.length === 0) return '—'
  return list.map((t) => `${t.side} ${t.joint}`).join(', ')
}

export default async function EditPrescriptionPage({
  params,
}: {
  params: Promise<{ id: string; prescriptionId: string }>
}) {
  const { id: patientId, prescriptionId } = await params

  const [
    { data: prescription },
    { data: itemRows },
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
      .select('id, exercise_id, num_sets, reps_per_set, rest_seconds, exercises(name, tracked_joints)')
      .eq('prescription_id', prescriptionId)
      .order('sequence_order'),
    supabaseServer
      .from('exercises')
      .select('id, name, tracked_joints')
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
        const ex = r.exercises as { name: string; tracked_joints: unknown } | null
        return {
          key: r.id,
          exerciseId: r.exercise_id,
          exerciseName: ex?.name ?? 'Unknown',
          exerciseTracked: describeTracked(ex?.tracked_joints),
          numSets: r.num_sets,
          repsPerSet: r.reps_per_set,
          restSeconds: r.rest_seconds,
        }
      })}
      exercises={(exercises ?? []).map((ex) => ({
        id: ex.id,
        name: ex.name,
        trackedDescription: describeTracked(ex.tracked_joints),
      }))}
      hasSessionHistory={(sessionCount ?? 0) > 0}
    />
  )
}
