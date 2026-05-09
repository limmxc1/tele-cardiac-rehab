'use server'

import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'

export type MonthPrescription = {
  id: string
  scheduled_date: string
  hr_upper_limit_bpm: number
  status: string
  item_count: number
}

export type PrescriptionItemDetail = {
  id: string
  sequence_order: number
  num_sets: number
  reps_per_set: number
  rest_seconds: number
  exercise_name: string
  exercise_joint: string
  exercise_side: string
}

export async function markMissedAction(patientId: string): Promise<void> {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })
  await supabaseServer
    .from('prescriptions')
    .update({ status: 'missed' })
    .eq('patient_id', patientId)
    .eq('status', 'scheduled')
    .lt('scheduled_date', todayStr)
}

export async function getMonthPrescriptionsAction(
  patientId: string,
  year: number,
  month: number // 0-indexed
): Promise<MonthPrescription[]> {
  const mm = String(month + 1).padStart(2, '0')
  const startDate = `${year}-${mm}-01`
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const endDate = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`

  const { data } = await supabaseServer
    .from('prescriptions')
    .select('id, scheduled_date, hr_upper_limit_bpm, status, prescription_items(id)')
    .eq('patient_id', patientId)
    .gte('scheduled_date', startDate)
    .lte('scheduled_date', endDate)
    .order('scheduled_date')

  return (data ?? []).map((p) => ({
    id: p.id,
    scheduled_date: p.scheduled_date,
    hr_upper_limit_bpm: p.hr_upper_limit_bpm,
    status: p.status,
    item_count: Array.isArray(p.prescription_items) ? p.prescription_items.length : 0,
  }))
}

export async function getPrescriptionItemsAction(
  prescriptionId: string
): Promise<PrescriptionItemDetail[]> {
  const { data } = await supabaseServer
    .from('prescription_items')
    .select(
      'id, sequence_order, num_sets, reps_per_set, rest_seconds, exercises(name, primary_joint, primary_side)'
    )
    .eq('prescription_id', prescriptionId)
    .order('sequence_order')

  return (data ?? []).map((item) => {
    const ex = item.exercises as { name: string; primary_joint: string; primary_side: string } | null
    return {
      id: item.id,
      sequence_order: item.sequence_order,
      num_sets: item.num_sets,
      reps_per_set: item.reps_per_set,
      rest_seconds: item.rest_seconds,
      exercise_name: ex?.name ?? 'Unknown',
      exercise_joint: ex?.primary_joint ?? '',
      exercise_side: ex?.primary_side ?? '',
    }
  })
}

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
