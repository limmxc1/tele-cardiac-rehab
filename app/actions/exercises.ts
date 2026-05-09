'use server'

import { redirect } from 'next/navigation'
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
    created_by: data.created_by,
  })

  if (error) return { error: error.message }

  redirect('/clinician/exercises')
}
