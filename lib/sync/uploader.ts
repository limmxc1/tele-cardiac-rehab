import { supabase } from '@/lib/supabase/client'
import {
  bufferDB,
  clearSession,
  loadSessionBundle,
  markSessionUploaded,
  type BufferedSession,
} from '@/lib/buffer/sessionBuffer'
import type { Database, Json } from '@/lib/supabase/types'

const HR_BATCH = 500
const POSE_BATCH = 200
const REPS_BATCH = 200

export type UploadResult =
  | { ok: true; sessionId: string }
  | { ok: false; sessionId: string; error: string }

type TableName = keyof Database['public']['Tables']

async function batchInsert<T extends TableName>(
  table: T,
  rows: Database['public']['Tables'][T]['Insert'][],
  size: number,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size)
    const { error } = await supabase.from(table).insert(chunk as never)
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

async function uploadOnce(sessionId: string): Promise<void> {
  const bundle = await loadSessionBundle(sessionId)
  const session = bundle.session
  if (!session) throw new Error(`Session ${sessionId} not found in buffer`)

  // 1. Insert sessions row first (parent FK).
  {
    const { error } = await supabase.from('sessions').insert({
      id: session.sessionId,
      prescription_id: session.prescriptionId,
      patient_id: session.patientId,
      started_at: session.startedAtIso,
      completed_at: session.completedAtIso,
      status: session.status,
    })
    if (error) throw new Error(`sessions: ${error.message}`)
  }

  // 2. session_sets — parent of session_reps.
  if (bundle.sets.length > 0) {
    const setRows = bundle.sets.map((s) => ({
      id: s.setId,
      session_id: s.sessionId,
      prescription_item_id: s.prescriptionItemId,
      exercise_id: s.exerciseId,
      set_number: s.setNumber,
      started_at: s.startedAtIso,
      completed_at: s.completedAtIso,
      reps_completed: s.repsCompleted,
      reps_target: s.repsTarget,
      ended_reason: s.endedReason,
    }))
    await batchInsert('session_sets', setRows, REPS_BATCH)
  }

  // 3. session_reps.
  if (bundle.reps.length > 0) {
    const repRows = bundle.reps.map((r) => ({
      session_set_id: r.sessionSetId,
      rep_number: r.repNumber,
      started_at: r.startedAtIso,
      completed_at: r.completedAtIso,
      peak_angle_degrees: r.peakAngleDegrees,
      rom_achieved_degrees: r.romAchievedDegrees,
      hr_bpm_at_peak: r.hrBpmAtPeak,
    }))
    await batchInsert('session_reps', repRows, REPS_BATCH)
  }

  // 4. session_pauses.
  if (bundle.pauses.length > 0) {
    const pauseRows = bundle.pauses.map((p) => ({
      id: p.pauseId,
      session_id: p.sessionId,
      paused_at: p.pausedAtIso,
      resumed_at: p.resumedAtIso,
      reason: p.reason,
    }))
    await batchInsert('session_pauses', pauseRows, REPS_BATCH)
  }

  // 5. session_hr_samples (PK is composite session_id+timestamp_ms — dedupe defensively).
  if (bundle.hrSamples.length > 0) {
    const seen = new Set<number>()
    const hrRows = []
    for (const h of bundle.hrSamples) {
      if (seen.has(h.timestampMs)) continue
      seen.add(h.timestampMs)
      hrRows.push({
        session_id: h.sessionId,
        timestamp_ms: h.timestampMs,
        hr_bpm: h.hrBpm,
      })
    }
    await batchInsert('session_hr_samples', hrRows, HR_BATCH)
  }

  // 6. session_pose_frames.
  if (bundle.poseFrames.length > 0) {
    const frameRows = bundle.poseFrames.map((f) => ({
      session_id: f.sessionId,
      second_offset: f.secondOffset,
      frames: f.frames as unknown as Json,
    }))
    await batchInsert('session_pose_frames', frameRows, POSE_BATCH)
  }

  // 7. Mark prescription completed (only when buffer recorded a clean completion).
  if (session.status === 'completed') {
    const { error } = await supabase
      .from('prescriptions')
      .update({ status: 'completed' })
      .eq('id', session.prescriptionId)
    if (error) throw new Error(`prescriptions: ${error.message}`)
  }

  await markSessionUploaded(session.sessionId)
  await clearSession(session.sessionId)
}

export async function uploadSession(
  sessionId: string,
  opts: { maxAttempts?: number } = {},
): Promise<UploadResult> {
  const maxAttempts = opts.maxAttempts ?? 5
  let lastErr: unknown = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await uploadOnce(sessionId)
      return { ok: true, sessionId }
    } catch (err) {
      lastErr = err
      const delay = Math.min(30_000, 1000 * 2 ** attempt)
      console.warn(`[uploader] attempt ${attempt + 1}/${maxAttempts} failed, retrying in ${delay}ms`, err)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr)
  return { ok: false, sessionId, error: message }
}

export async function flushPending(): Promise<UploadResult[]> {
  const rows = await bufferDB.sessions.where('uploaded').equals(0).toArray()
  const flushable = rows.filter((s: BufferedSession) => s.status !== 'in_progress')
  const results: UploadResult[] = []
  for (const s of flushable) {
    results.push(await uploadSession(s.sessionId))
  }
  return results
}
