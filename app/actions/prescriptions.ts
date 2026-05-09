'use server'

import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'

export interface PrescriptionItemInput {
  exercise_id: string
  num_sets: number
  reps_per_set: number
  rest_seconds: number
  override_start_angle_min: number | null
  override_start_angle_max: number | null
  override_end_angle_min: number | null
  override_end_angle_max: number | null
}

export interface PrescriptionPayload {
  patient_id: string
  prescribed_by: string
  hr_upper_limit_bpm: number
  scheduled_dates: string[]
  items: PrescriptionItemInput[]
}

export async function createPrescriptionAction(
  data: PrescriptionPayload
): Promise<{ error: string } | null> {
  for (const date of data.scheduled_dates) {
    const { data: prescription, error: prescErr } = await supabaseServer
      .from('prescriptions')
      .insert({
        patient_id: data.patient_id,
        prescribed_by: data.prescribed_by,
        hr_upper_limit_bpm: data.hr_upper_limit_bpm,
        scheduled_date: date,
        status: 'scheduled',
      })
      .select('id')
      .single()

    if (prescErr) return { error: prescErr.message }

    const itemRows = data.items.map((item, i) => ({
      prescription_id: prescription.id,
      exercise_id: item.exercise_id,
      sequence_order: i + 1,
      num_sets: item.num_sets,
      reps_per_set: item.reps_per_set,
      rest_seconds: item.rest_seconds,
      override_start_angle_min: item.override_start_angle_min,
      override_start_angle_max: item.override_start_angle_max,
      override_end_angle_min: item.override_end_angle_min,
      override_end_angle_max: item.override_end_angle_max,
    }))

    const { error: itemsErr } = await supabaseServer
      .from('prescription_items')
      .insert(itemRows)

    if (itemsErr) return { error: itemsErr.message }
  }

  redirect(`/clinician/patients/${data.patient_id}`)
}
