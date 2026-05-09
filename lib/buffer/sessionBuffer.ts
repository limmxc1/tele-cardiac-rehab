import Dexie, { type Table } from 'dexie'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export type PauseReason = 'hr_breach' | 'h10_disconnect' | 'out_of_frame' | 'multiple_people'

export interface BufferedSession {
  sessionId: string
  prescriptionId: string
  patientId: string
  startedAtMs: number
  startedAtIso: string
  completedAtIso: string | null
  status: 'in_progress' | 'completed' | 'abandoned'
  uploaded: 0 | 1
}

export interface BufferedHRSample {
  id?: number
  sessionId: string
  timestampMs: number
  hrBpm: number
}

export interface BufferedPoseFrame {
  // Composite key: `${sessionId}|${secondOffset}` so we update the second-bucket as frames arrive.
  key: string
  sessionId: string
  secondOffset: number
  frames: PackedFrame[]
}

export interface PackedFrame {
  // Epoch ms (Date.now() domain) so pose, HR, and sessions.started_at share one clock.
  ts_ms: number
  lm: [number, number, number][] // 33 landmarks × [x,y,z]
}

export interface BufferedSet {
  setId: string
  sessionId: string
  prescriptionItemId: string
  exerciseId: string
  setNumber: number
  startedAtIso: string
  completedAtIso: string | null
  repsCompleted: number
  repsTarget: number
  endedReason: 'reps_complete' | 't_pose' | 'abandoned' | null
}

export interface BufferedRep {
  repId: string // client-minted UUID; mirrors session_reps.id so retries are idempotent
  sessionSetId: string
  sessionId: string
  repNumber: number
  startedAtIso: string
  completedAtIso: string
  peakAngleDegrees: number | null
  romAchievedDegrees: number | null
  hrBpmAtPeak: number | null
}

export interface BufferedPause {
  pauseId: string
  sessionId: string
  pausedAtIso: string
  resumedAtIso: string | null
  reason: PauseReason
}

class SessionBufferDB extends Dexie {
  sessions!: Table<BufferedSession, string>
  hrSamples!: Table<BufferedHRSample, number>
  poseFrames!: Table<BufferedPoseFrame, string>
  sets!: Table<BufferedSet, string>
  reps!: Table<BufferedRep, string>
  pauses!: Table<BufferedPause, string>

  constructor() {
    super('shf-session-buffer')
    this.version(1).stores({
      sessions: 'sessionId, uploaded, status',
      hrSamples: '++id, sessionId, [sessionId+timestampMs]',
      poseFrames: 'key, sessionId',
      sets: 'setId, sessionId',
      reps: '++id, sessionId, sessionSetId',
      pauses: 'pauseId, sessionId',
    })
    // v2: drop the old reps store. Dexie can't change a primary key in place,
    // so we delete the store…
    this.version(2).stores({ reps: null })
    // …and v3 re-creates it with the client-minted UUID as PK so retries
    // upsert deterministically. Any unflushed reps from v1 are lost; sessions
    // / sets / hr / pose data carry over.
    this.version(3).stores({
      reps: 'repId, sessionId, sessionSetId',
    })
  }
}

export const bufferDB = new SessionBufferDB()

// Pose downsampling: 5fps target → minimum 200ms gap between accepted frames per session.
// 5fps is plenty for stickman replay + slider scrubbing and halves storage vs 10fps.
const POSE_TARGET_INTERVAL_MS = 200
const lastAcceptedPoseTs = new Map<string, number>()

export function resetPoseDownsampler(sessionId: string): void {
  lastAcceptedPoseTs.delete(sessionId)
}

function packLandmarks(lm: NormalizedLandmark[]): [number, number, number][] {
  const out: [number, number, number][] = new Array(lm.length)
  for (let i = 0; i < lm.length; i++) {
    const p = lm[i]
    out[i] = [p.x, p.y, p.z ?? 0]
  }
  return out
}

export async function startSession(args: {
  sessionId: string
  prescriptionId: string
  patientId: string
  startedAtMs: number
}): Promise<void> {
  const startedAtIso = new Date(args.startedAtMs).toISOString()
  await bufferDB.sessions.put({
    sessionId: args.sessionId,
    prescriptionId: args.prescriptionId,
    patientId: args.patientId,
    startedAtMs: args.startedAtMs,
    startedAtIso,
    completedAtIso: null,
    status: 'in_progress',
    uploaded: 0,
  })
  resetPoseDownsampler(args.sessionId)
}

export async function recordHR(
  sessionId: string,
  timestampMs: number,
  hrBpm: number,
): Promise<void> {
  await bufferDB.hrSamples.add({ sessionId, timestampMs, hrBpm })
}

export async function recordPoseFrame(
  sessionId: string,
  timestampMs: number, // wall-clock epoch ms
  landmarks: NormalizedLandmark[],
  sessionStartMs: number, // wall-clock epoch ms of session start
): Promise<void> {
  const last = lastAcceptedPoseTs.get(sessionId)
  if (last !== undefined && timestampMs - last < POSE_TARGET_INTERVAL_MS) return
  lastAcceptedPoseTs.set(sessionId, timestampMs)

  const offsetMs = timestampMs - sessionStartMs
  if (offsetMs < 0) return
  const secondOffset = Math.floor(offsetMs / 1000)
  const key = `${sessionId}|${secondOffset}`
  // Inner ts_ms = epoch ms (same domain as session_hr_samples.timestamp_ms).
  const packed: PackedFrame = { ts_ms: timestampMs, lm: packLandmarks(landmarks) }

  // Atomic read-modify-write per (session, second).
  await bufferDB.transaction('rw', bufferDB.poseFrames, async () => {
    const existing = await bufferDB.poseFrames.get(key)
    if (existing) {
      existing.frames.push(packed)
      await bufferDB.poseFrames.put(existing)
    } else {
      await bufferDB.poseFrames.put({ key, sessionId, secondOffset, frames: [packed] })
    }
  })
}

export async function recordSetStart(args: {
  setId: string
  sessionId: string
  prescriptionItemId: string
  exerciseId: string
  setNumber: number
  repsTarget: number
  startedAtMs: number
}): Promise<void> {
  await bufferDB.sets.put({
    setId: args.setId,
    sessionId: args.sessionId,
    prescriptionItemId: args.prescriptionItemId,
    exerciseId: args.exerciseId,
    setNumber: args.setNumber,
    repsTarget: args.repsTarget,
    repsCompleted: 0,
    startedAtIso: new Date(args.startedAtMs).toISOString(),
    completedAtIso: null,
    endedReason: null,
  })
}

export async function recordSetComplete(args: {
  setId: string
  completedAtMs: number
  repsCompleted: number
  endedReason: 'reps_complete' | 't_pose' | 'abandoned'
}): Promise<void> {
  const existing = await bufferDB.sets.get(args.setId)
  if (!existing) return
  existing.completedAtIso = new Date(args.completedAtMs).toISOString()
  existing.repsCompleted = args.repsCompleted
  existing.endedReason = args.endedReason
  await bufferDB.sets.put(existing)
}

export async function recordRep(rep: BufferedRep): Promise<void> {
  await bufferDB.reps.put(rep)
}

export async function recordPauseStart(args: {
  pauseId: string
  sessionId: string
  pausedAtMs: number
  reason: PauseReason
}): Promise<void> {
  await bufferDB.pauses.put({
    pauseId: args.pauseId,
    sessionId: args.sessionId,
    pausedAtIso: new Date(args.pausedAtMs).toISOString(),
    resumedAtIso: null,
    reason: args.reason,
  })
}

export async function recordPauseEnd(args: {
  pauseId: string
  resumedAtMs: number
}): Promise<void> {
  const existing = await bufferDB.pauses.get(args.pauseId)
  if (!existing) return
  existing.resumedAtIso = new Date(args.resumedAtMs).toISOString()
  await bufferDB.pauses.put(existing)
}

export async function markSessionComplete(
  sessionId: string,
  completedAtMs: number,
  status: 'completed' | 'abandoned' = 'completed',
): Promise<void> {
  const existing = await bufferDB.sessions.get(sessionId)
  if (!existing) return
  existing.completedAtIso = new Date(completedAtMs).toISOString()
  existing.status = status
  await bufferDB.sessions.put(existing)
}

export async function markSessionUploaded(sessionId: string): Promise<void> {
  const existing = await bufferDB.sessions.get(sessionId)
  if (!existing) return
  existing.uploaded = 1
  await bufferDB.sessions.put(existing)
}

export async function getUnflushedSessions(): Promise<BufferedSession[]> {
  // Includes both 'completed' and 'abandoned'. Skips 'in_progress' — those need
  // markStaleInProgressAbandoned() first or are still running in another tab.
  const rows = await bufferDB.sessions.where('uploaded').equals(0).toArray()
  return rows.filter((s) => s.status !== 'in_progress')
}

/**
 * Mark any in_progress session whose buffer is older than `staleMs` as 'abandoned'
 * so the next flushPending() picks it up. Catches tab-closes / browser crashes.
 */
export async function markStaleInProgressAbandoned(staleMs = 60 * 60 * 1000): Promise<number> {
  const now = Date.now()
  const rows = await bufferDB.sessions.where('uploaded').equals(0).toArray()
  let n = 0
  for (const s of rows) {
    if (s.status !== 'in_progress') continue
    if (now - s.startedAtMs < staleMs) continue
    s.status = 'abandoned'
    s.completedAtIso = new Date(now).toISOString()
    await bufferDB.sessions.put(s)
    n++
  }
  return n
}

/**
 * Force-abandon all in_progress sessions for a given patient+prescription
 * (used when a fresh session is starting — the stale one can't be resumed).
 */
export async function abandonStaleSessionsFor(
  patientId: string,
  prescriptionId: string,
): Promise<void> {
  const rows = await bufferDB.sessions.where('uploaded').equals(0).toArray()
  for (const s of rows) {
    if (s.status !== 'in_progress') continue
    if (s.patientId !== patientId || s.prescriptionId !== prescriptionId) continue
    s.status = 'abandoned'
    s.completedAtIso = new Date().toISOString()
    await bufferDB.sessions.put(s)
  }
}

export async function loadSessionBundle(sessionId: string) {
  const [session, hrSamples, poseFrames, sets, reps, pauses] = await Promise.all([
    bufferDB.sessions.get(sessionId),
    bufferDB.hrSamples.where('sessionId').equals(sessionId).toArray(),
    bufferDB.poseFrames.where('sessionId').equals(sessionId).toArray(),
    bufferDB.sets.where('sessionId').equals(sessionId).toArray(),
    bufferDB.reps.where('sessionId').equals(sessionId).toArray(),
    bufferDB.pauses.where('sessionId').equals(sessionId).toArray(),
  ])
  return { session, hrSamples, poseFrames, sets, reps, pauses }
}

export async function clearSession(sessionId: string): Promise<void> {
  await bufferDB.transaction(
    'rw',
    [bufferDB.sessions, bufferDB.hrSamples, bufferDB.poseFrames, bufferDB.sets, bufferDB.reps, bufferDB.pauses],
    async () => {
      await bufferDB.sessions.delete(sessionId)
      await bufferDB.hrSamples.where('sessionId').equals(sessionId).delete()
      await bufferDB.poseFrames.where('sessionId').equals(sessionId).delete()
      await bufferDB.sets.where('sessionId').equals(sessionId).delete()
      await bufferDB.reps.where('sessionId').equals(sessionId).delete()
      await bufferDB.pauses.where('sessionId').equals(sessionId).delete()
    },
  )
  resetPoseDownsampler(sessionId)
}

/** Latest in-progress session for a given patient/prescription, if any. */
export async function findResumableSession(
  patientId: string,
  prescriptionId: string,
): Promise<BufferedSession | null> {
  const rows = await bufferDB.sessions
    .where('uploaded')
    .equals(0)
    .filter((s) => s.patientId === patientId && s.prescriptionId === prescriptionId && s.status === 'in_progress')
    .toArray()
  rows.sort((a, b) => b.startedAtMs - a.startedAtMs)
  return rows[0] ?? null
}
