'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabaseServer } from '@/lib/supabase/server'

export interface ExercisePayload {
  name: string
  instructions_text: string | null
  reference_gif_url: string | null
  primary_joint: string
  primary_side: string
  start_angle_min: number
  start_angle_max: number
  end_angle_min: number
  end_angle_max: number
  direction: string
  secondary_joint: string | null
  secondary_start_min: number | null
  secondary_start_max: number | null
  secondary_end_min: number | null
  secondary_end_max: number | null
  view_orientation: 'front' | 'side'
  created_by: string | null
}

export async function createExerciseAction(
  data: ExercisePayload
): Promise<{ error: string } | null> {
  const { error } = await supabaseServer.from('exercises').insert({
    name: data.name,
    instructions_text: data.instructions_text,
    reference_gif_url: data.reference_gif_url,
    primary_joint: data.primary_joint,
    primary_side: data.primary_side,
    start_angle_min: data.start_angle_min,
    start_angle_max: data.start_angle_max,
    end_angle_min: data.end_angle_min,
    end_angle_max: data.end_angle_max,
    direction: data.direction,
    secondary_joint: data.secondary_joint,
    secondary_start_min: data.secondary_start_min,
    secondary_start_max: data.secondary_start_max,
    secondary_end_min: data.secondary_end_min,
    secondary_end_max: data.secondary_end_max,
    view_orientation: data.view_orientation,
    created_by: data.created_by,
  })

  if (error) return { error: error.message }

  redirect('/clinician/exercises')
}

/**
 * Soft-delete an exercise AND remove it from every patient's prescriptions.
 *
 * - `exercises.archived_at` is set so historic `session_sets` keep resolving
 *   the exercise name during playback.
 * - `prescription_items` rows pointing at this exercise are hard-deleted, so
 *   the exercise disappears from upcoming patient calendars and the prescription
 *   builder. Items already referenced by `session_sets` (i.e. a session was
 *   actually run against them) are preserved — deleting them would break the
 *   session FK.
 * - Prescriptions that end up empty after the item purge are also deleted, but
 *   only when no `sessions` row points at them (avoids a dangling
 *   `sessions.prescription_id` FK).
 */
export async function archiveExerciseAction(
  id: string,
): Promise<{ error: string } | null> {
  // 1. Find prescription_items that have already been "used" — a session_set
  //    points at them. These must stay so playback resolves.
  const { data: protectedRows, error: protectedErr } = await supabaseServer
    .from('session_sets')
    .select('prescription_item_id')
    .eq('exercise_id', id)
  if (protectedErr) return { error: protectedErr.message }
  const protectedItemIds = new Set(
    (protectedRows ?? []).map((r) => r.prescription_item_id),
  )

  // 2. Find every prescription_item referencing this exercise.
  const { data: items, error: itemsErr } = await supabaseServer
    .from('prescription_items')
    .select('id, prescription_id')
    .eq('exercise_id', id)
  if (itemsErr) return { error: itemsErr.message }

  const deletableItemIds: string[] = []
  const affectedPrescriptionIds = new Set<string>()
  for (const item of items ?? []) {
    if (protectedItemIds.has(item.id)) continue
    deletableItemIds.push(item.id)
    affectedPrescriptionIds.add(item.prescription_id)
  }

  if (deletableItemIds.length > 0) {
    const { error: delItemsErr } = await supabaseServer
      .from('prescription_items')
      .delete()
      .in('id', deletableItemIds)
    if (delItemsErr) return { error: delItemsErr.message }
  }

  // 3. For each affected prescription, drop it if it now has zero items AND
  //    no session has ever been started against it.
  for (const prescId of affectedPrescriptionIds) {
    const { count: itemCount, error: countErr } = await supabaseServer
      .from('prescription_items')
      .select('*', { count: 'exact', head: true })
      .eq('prescription_id', prescId)
    if (countErr) return { error: countErr.message }
    if ((itemCount ?? 0) > 0) continue

    const { count: sessionCount, error: sessCountErr } = await supabaseServer
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('prescription_id', prescId)
    if (sessCountErr) return { error: sessCountErr.message }
    if ((sessionCount ?? 0) > 0) continue

    const { error: delPrescErr } = await supabaseServer
      .from('prescriptions')
      .delete()
      .eq('id', prescId)
    if (delPrescErr) return { error: delPrescErr.message }
  }

  // 4. Soft-delete the exercise itself.
  const { error: archiveErr } = await supabaseServer
    .from('exercises')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
  if (archiveErr) return { error: archiveErr.message }

  revalidatePath('/clinician/exercises')
  revalidatePath('/clinician/patients')
  return null
}
