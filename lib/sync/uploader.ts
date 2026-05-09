import { supabase } from '@/lib/supabase/client'
import {
  bufferDB,
  clearSession,
  loadSessionBundle,
  markSessionUploaded,
  type BufferedSession,
} from '@/lib/buffer/sessionBuffer'
import type { Database, Json } from '@/lib/supabase/types'
import type { PostgrestError } from '@supabase/supabase-js'

const HR_BATCH = 500
const POSE_BATCH = 200
const SET_BATCH = 200

export type UploadResult =
  | { ok: true; sessionId: string }
  | { ok: false; sessionId: string; error: string; abandoned?: boolean }

type TableName = keyof Database['public']['Tables']

/**
 * Errors that won't get better by retrying — e.g. the parent prescription was
 * deleted while this recording sat unflushed in the buffer. We surface these
 * once and drop the buffered session so it doesn't loop forever on every
 * calendar mount.
 */
class NonRetryableUploadError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'NonRetryableUploadError'
  }
}

function classifyError(table: string, err: PostgrestError): Error {
  const msg = `${table}: ${err.message}`
  // Postgres FK violation. The parent row (prescription, exercise, etc.) is
  // gone — retrying won't bring it back.
  if (err.code === '23503') return new NonRetryableUploadError(msg, err.code)
  return new Error(msg)
}

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
    if (error) throw classifyError(table, error)
  }
}

async function uploadOnce(sessionId: string): Promise<void> {
  const bundle = await loadSessionBundle(sessionId)
  const session = bundle.session
  if (!session) throw new Error(`Session ${sessionId} not found in buffer`)

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
    if (error) throw classifyError('sessions', error)
  }

  if (bundle.sets.length > 0) {
    const setRows = bundle.sets.map((s) => ({
      id: s.setId,
      session_id: s.sessionId,
      prescription_item_id: s.prescriptionItemId,
      exercise_id: s.exerciseId,
      set_number: s.setNumber,
      started_at: s.startedAtIso,
      completed_at: s.completedAtIso,
      ended_reason: s.endedReason,
    }))
    await batchUpsert('session_sets', setRows, SET_BATCH, 'id')
  }

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

  if (bundle.poseFrames.length > 0) {
    const sorted = [...bundle.poseFrames].sort((a, b) => a.secondOffset - b.secondOffset)
    const frameRows = sorted.map((f) => ({
      session_id: f.sessionId,
      second_offset: f.secondOffset,
      frames: f.frames as unknown as Json,
    }))
    await batchUpsert('session_pose_frames', frameRows, POSE_BATCH, 'session_id,second_offset')
  }

  if (session.status === 'completed') {
    const { error } = await supabase
      .from('prescriptions')
      .update({ status: 'completed' })
      .eq('id', session.prescriptionId)
    if (error) throw classifyError('prescriptions', error)
  }

  await markSessionUploaded(session.sessionId)
  await clearSession(session.sessionId)
}

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
        if (err instanceof NonRetryableUploadError) {
          // Parent row is gone. Surface once and drop the buffered session so
          // we don't keep retrying on every page load.
          console.warn(`[uploader] dropping orphan session ${sessionId}: ${err.message}`)
          try { await clearSession(sessionId) } catch (clearErr) {
            console.warn(`[uploader] failed to clear orphan session ${sessionId}`, clearErr)
          }
          return { ok: false, sessionId, error: err.message, abandoned: true }
        }
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
