'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabaseServer } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/types'

export type Joint = 'knee' | 'hip' | 'shoulder' | 'elbow' | 'ankle'
export type Side = 'left' | 'right' | 'both'

export interface TrackedJointSpec {
  joint: Joint
  /**
   * 'left' / 'right' track a single side. 'both' records the triplet on each
   * side and averages the angle on playback (single trace per joint).
   */
  side: Side
}

export interface ExercisePayload {
  name: string
  instructions_text: string | null
  reference_gif_url: string | null
  /** Required for legacy DB compatibility — used as the headline joint in lists. */
  primary_joint: Joint
  primary_side: 'left' | 'right' | 'both'
  tracked_joints: TrackedJointSpec[]
  created_by: string | null
}

export async function updateExerciseAction(
  id: string,
  data: Omit<ExercisePayload, 'created_by'>
): Promise<{ error: string } | null> {
  const { error } = await supabaseServer.from('exercises').update({
    name: data.name,
    instructions_text: data.instructions_text,
    reference_gif_url: data.reference_gif_url,
    primary_joint: data.primary_joint,
    primary_side: data.primary_side,
    tracked_joints: data.tracked_joints as unknown as Json,
  }).eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/clinician/exercises')
  redirect('/clinician/exercises')
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
    tracked_joints: data.tracked_joints as unknown as Json,
    created_by: data.created_by,
  })

  if (error) return { error: error.message }

  redirect('/clinician/exercises')
}

/**
 * Soft-delete an exercise AND remove it from every patient's prescriptions.
 * Behaviour matches the previous implementation: prescription_items the
 * exercise has been used in (a session_set references them) are kept so
 * historic playback resolves; everything else is hard-deleted, and any
 * prescription left empty is dropped if no session points at it.
 */
export async function archiveExerciseAction(
  id: string,
): Promise<{ error: string } | null> {
  const { data: protectedRows, error: protectedErr } = await supabaseServer
    .from('session_sets')
    .select('prescription_item_id')
    .eq('exercise_id', id)
  if (protectedErr) return { error: protectedErr.message }
  const protectedItemIds = new Set(
    (protectedRows ?? []).map((r) => r.prescription_item_id),
  )

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

  const { error: archiveErr } = await supabaseServer
    .from('exercises')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
  if (archiveErr) return { error: archiveErr.message }

  revalidatePath('/clinician/exercises')
  revalidatePath('/clinician/patients')
  return null
}
