import { notFound } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'
import SessionRunClient from './SessionRunClient'
import type { SetEntry } from '@/lib/pose/sessionStateMachine'
import type { RepConfig } from '@/lib/pose/repDetector'

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
      override_start_angle_min, override_start_angle_max,
      override_end_angle_min, override_end_angle_max,
      exercises (
        name, primary_joint, primary_side, direction,
        start_angle_min, start_angle_max, end_angle_min, end_angle_max,
        secondary_joint, secondary_start_min, secondary_start_max,
        secondary_end_min, secondary_end_max, reference_gif_url,
        view_orientation
      )
    `)
    .eq('prescription_id', prescriptionId)
    .order('sequence_order')

  if (!itemRows || itemRows.length === 0) notFound()

  type ExRow = {
    name: string; primary_joint: string; primary_side: string; direction: string
    start_angle_min: number; start_angle_max: number; end_angle_min: number; end_angle_max: number
    secondary_joint: string | null
    secondary_start_min: number | null; secondary_start_max: number | null
    secondary_end_min: number | null; secondary_end_max: number | null
    reference_gif_url: string | null
    view_orientation: string
  }

  const sets: SetEntry[] = []
  const totalItems = itemRows.length

  for (let ii = 0; ii < totalItems; ii++) {
    const item = itemRows[ii]
    const ex = item.exercises as ExRow | null
    if (!ex) continue

    const nextExName =
      ii + 1 < totalItems
        ? ((itemRows[ii + 1].exercises as { name: string } | null)?.name ?? null)
        : null

    const repConfig: RepConfig = {
      primaryJoint: ex.primary_joint,
      primarySide: ex.primary_side as 'left' | 'right' | 'both',
      startAngleMin: item.override_start_angle_min ?? ex.start_angle_min,
      startAngleMax: item.override_start_angle_max ?? ex.start_angle_max,
      endAngleMin: item.override_end_angle_min ?? ex.end_angle_min,
      endAngleMax: item.override_end_angle_max ?? ex.end_angle_max,
      direction: ex.direction as 'flexion_first' | 'extension_first',
      ...(ex.secondary_joint
        ? {
            secondaryJoint: ex.secondary_joint,
            secondaryStartMin: ex.secondary_start_min ?? undefined,
            secondaryStartMax: ex.secondary_start_max ?? undefined,
            secondaryEndMin: ex.secondary_end_min ?? undefined,
            secondaryEndMax: ex.secondary_end_max ?? undefined,
          }
        : {}),
    }

    for (let sn = 1; sn <= item.num_sets; sn++) {
      const isLastSetOfItem = sn === item.num_sets
      const isLastSet = ii === totalItems - 1 && isLastSetOfItem
      sets.push({
        prescriptionItemId: item.id,
        exerciseId: item.exercise_id,
        itemIndex: ii,
        setNumber: sn,
        totalSets: item.num_sets,
        exerciseName: ex.name,
        repConfig,
        repsTarget: item.reps_per_set,
        restSeconds: item.rest_seconds,
        referenceGifUrl: ex.reference_gif_url,
        isLastSetOfItem,
        isLastSet,
        nextExerciseName: isLastSetOfItem ? nextExName : null,
        viewOrientation: ex.view_orientation === 'side' ? 'side' : 'front',
      })
    }
  }

  if (sets.length === 0) notFound()

  // Locate starting set from URL params (item=<prescriptionItemId>&set=<1-based>)
  let startSetIdx = 0
  if (itemIdParam && setNumParam) {
    const n = parseInt(setNumParam)
    const found = sets.findIndex(
      (s) => s.prescriptionItemId === itemIdParam && s.setNumber === n,
    )
    if (found >= 0) startSetIdx = found
  }

  return (
    <SessionRunClient
      prescriptionId={prescriptionId}
      patientId={presc.patient_id}
      hrLimit={presc.hr_upper_limit_bpm}
      sets={sets}
      startSetIdx={startSetIdx}
    />
  )
}
