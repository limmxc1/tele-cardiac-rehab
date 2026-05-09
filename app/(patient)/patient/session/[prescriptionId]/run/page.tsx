import { notFound } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'
import SessionRunClient from './SessionRunClient'
import type { ExerciseEntry, TrackedJoint } from '@/lib/pose/sessionStateMachine'

export default async function SessionRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ prescriptionId: string }>
  searchParams: Promise<{ item?: string; set?: string }>
}) {
  const { prescriptionId } = await params
  const { item: itemIdParam, set: setNumParam } = await searchParams

  const { data: presc } = await supabaseServer
    .from('prescriptions')
    .select('id, hr_upper_limit_bpm, patient_id')
    .eq('id', prescriptionId)
    .single()

  if (!presc) notFound()

  const { data: itemRows } = await supabaseServer
    .from('prescription_items')
    .select(`
      id, sequence_order, num_sets, reps_per_set, rest_seconds, exercise_id,
      exercises (
        name, instructions_text, reference_gif_url, tracked_joints
      )
    `)
    .eq('prescription_id', prescriptionId)
    .order('sequence_order')

  if (!itemRows || itemRows.length === 0) notFound()

  type ExRow = {
    name: string
    instructions_text: string | null
    reference_gif_url: string | null
    tracked_joints: unknown
  }

  // Default to the first item; if URL points at a specific item id, jump there.
  let itemIdx = 0
  if (itemIdParam) {
    const found = itemRows.findIndex((r) => r.id === itemIdParam)
    if (found >= 0) itemIdx = found
  }
  const item = itemRows[itemIdx]
  const ex = item.exercises as ExRow | null
  if (!ex) notFound()

  const trackedJoints: TrackedJoint[] = Array.isArray(ex.tracked_joints)
    ? (ex.tracked_joints as TrackedJoint[]).filter(
        (t) => t && typeof t.joint === 'string' && (t.side === 'left' || t.side === 'right'),
      )
    : []

  const setNum = setNumParam ? Math.max(1, Number(setNumParam) || 1) : 1
  const guidance = `Set ${setNum} of ${item.num_sets} · target ${item.reps_per_set} reps`

  const exercise: ExerciseEntry = {
    prescriptionItemId: item.id,
    exerciseId: item.exercise_id,
    exerciseName: ex.name,
    trackedJoints,
    guidance,
    referenceGifUrl: ex.reference_gif_url,
    instructionsText: ex.instructions_text,
    itemIndex: itemIdx,
  }

  return (
    <SessionRunClient
      prescriptionId={prescriptionId}
      patientId={presc.patient_id}
      hrLimit={presc.hr_upper_limit_bpm}
      exercise={exercise}
      setNumber={setNum}
    />
  )
}
