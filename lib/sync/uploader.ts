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

async function batchUpsert<T extends TableName>(
  table: T,
  rows: Database['public']['Tables'][T]['Insert'][],
  size: number,
  onConflict: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size)
    const { error } = await supabase
      .from(table)
      .upsert(chunk as never, { onConflict, ignoreDuplicates: false })
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

async function uploadOnce(sessionId: string): Promise<void> {
  const bundle = await loadSessionBundle(sessionId)
  const session = bundle.session
  if (!session) throw new Error(`Session ${sessionId} not found in buffer`)

  // Every step uses upsert so a partial-success retry converges instead of
  // duplicate-PK-throwing on rows the previous attempt already wrote.

  // 1. sessions (parent of everything).
  {
    const { error } = await supabase
      .from('sessions')
      .upsert(
        {
          id: session.sessionId,
          prescription_id: session.prescriptionId,
          patient_id: session.patientId,
          started_at: session.startedAtIso,
          completed_at: session.completedAtIso,
          status: session.status,
        },
        { onConflict: 'id' },
      )
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
    await batchUpsert('session_sets', setRows, REPS_BATCH, 'id')
  }

  // 3. session_reps — id is now client-minted so retries are idempotent.
  if (bundle.reps.length > 0) {
    const repRows = bundle.reps.map((r) => ({
      id: r.repId,
      session_set_id: r.sessionSetId,
      rep_number: r.repNumber,
      started_at: r.startedAtIso,
      completed_at: r.completedAtIso,
      peak_angle_degrees: r.peakAngleDegrees,
      rom_achieved_degrees: r.romAchievedDegrees,
      hr_bpm_at_peak: r.hrBpmAtPeak,
    }))
    await batchUpsert('session_reps', repRows, REPS_BATCH, 'id')
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
    await batchUpsert('session_pauses', pauseRows, REPS_BATCH, 'id')
  }

  // 5. session_hr_samples — PK is (session_id, timestamp_ms). Dedupe across
  // the entire bundle (not just per-batch) before sending.
  if (bundle.hrSamples.length > 0) {
    const seen = new Set<number>()
    const hrRows: Database['public']['Tables']['session_hr_samples']['Insert'][] = []
    for (const h of bundle.hrSamples) {
      if (seen.has(h.timestampMs)) continue
      seen.add(h.timestampMs)
      hrRows.push({
        session_id: h.sessionId,
        timestamp_ms: h.timestampMs,
        hr_bpm: h.hrBpm,
      })
    }
    await batchUpsert('session_hr_samples', hrRows, HR_BATCH, 'session_id,timestamp_ms')
  }

  // 6. session_pose_frames — PK is (session_id, second_offset). Sort for
  // friendlier dashboard inspection.
  if (bundle.poseFrames.length > 0) {
    const sorted = [...bundle.poseFrames].sort((a, b) => a.secondOffset - b.secondOffset)
    const frameRows = sorted.map((f) => ({
      session_id: f.sessionId,
      second_offset: f.secondOffset,
      frames: f.frames as unknown as Json,
    }))
    await batchUpsert('session_pose_frames', frameRows, POSE_BATCH, 'session_id,second_offset')
  }

  // 7. Mark prescription completed only on a clean completion. Idempotent update.
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

// Per-session mutex so two callers (e.g., post-completion path + calendar
// flusher mounted in another tab) don't race on the same session.
const inflight = new Map<string, Promise<UploadResult>>()

export async function uploadSession(
  sessionId: string,
  opts: { maxAttempts?: number } = {},
): Promise<UploadResult> {
  const existing = inflight.get(sessionId)
  if (existing) return existing

  const run = (async (): Promise<UploadResult> => {
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
  })()

  inflight.set(sessionId, run)
  try {
    return await run
  } finally {
    inflight.delete(sessionId)
  }
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
