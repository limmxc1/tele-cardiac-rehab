import Dexie, { type Table } from 'dexie'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

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

/**
 * Sparse pose frame: only the landmark indices the clinician asked to track
 * are saved. `lm` is keyed by landmark index (0–32).
 */
export interface PackedFrame {
  ts_ms: number
  lm: Record<number, [number, number, number]>
}

export interface BufferedSet {
  setId: string
  sessionId: string
  prescriptionItemId: string
  exerciseId: string
  setNumber: number
  startedAtIso: string
  completedAtIso: string | null
  endedReason: 't_pose' | 'abandoned' | null
}

class SessionBufferDB extends Dexie {
  sessions!: Table<BufferedSession, string>
  hrSamples!: Table<BufferedHRSample, number>
  poseFrames!: Table<BufferedPoseFrame, string>
  sets!: Table<BufferedSet, string>

  constructor() {
    super('shf-session-buffer')
    // History note: v1 had a `reps` store with autoincrement PK; v2 deleted it
    // and v3 recreated it with a UUID PK. v4 (this version) drops `reps` and
    // `pauses` entirely — automatic rep/pause tracking was removed.
    this.version(1).stores({
      sessions: 'sessionId, uploaded, status',
      hrSamples: '++id, sessionId, [sessionId+timestampMs]',
      poseFrames: 'key, sessionId',
      sets: 'setId, sessionId',
      reps: '++id, sessionId, sessionSetId',
      pauses: 'pauseId, sessionId',
    })
    this.version(2).stores({ reps: null })
    this.version(3).stores({
      reps: 'repId, sessionId, sessionSetId',
    })
    this.version(4).stores({
      reps: null,
      pauses: null,
    })
  }
}

export const bufferDB = new SessionBufferDB()

const POSE_TARGET_INTERVAL_MS = 200
const lastAcceptedPoseTs = new Map<string, number>()

export function resetPoseDownsampler(sessionId: string): void {
  lastAcceptedPoseTs.delete(sessionId)
}

function packLandmarksSparse(
  lm: NormalizedLandmark[],
  trackedIndices: readonly number[],
): Record<number, [number, number, number]> {
  const out: Record<number, [number, number, number]> = {}
  for (const i of trackedIndices) {
    const p = lm[i]
    if (!p) continue
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
  timestampMs: number,
  landmarks: NormalizedLandmark[],
  sessionStartMs: number,
  trackedIndices: readonly number[],
): Promise<void> {
  if (trackedIndices.length === 0) return
  const last = lastAcceptedPoseTs.get(sessionId)
  if (last !== undefined && timestampMs - last < POSE_TARGET_INTERVAL_MS) return
  lastAcceptedPoseTs.set(sessionId, timestampMs)

  const offsetMs = timestampMs - sessionStartMs
  if (offsetMs < 0) return
  const secondOffset = Math.floor(offsetMs / 1000)
  const key = `${sessionId}|${secondOffset}`
  const packed: PackedFrame = {
    ts_ms: timestampMs,
    lm: packLandmarksSparse(landmarks, trackedIndices),
  }

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
  startedAtMs: number
}): Promise<void> {
  await bufferDB.sets.put({
    setId: args.setId,
    sessionId: args.sessionId,
    prescriptionItemId: args.prescriptionItemId,
    exerciseId: args.exerciseId,
    setNumber: args.setNumber,
    startedAtIso: new Date(args.startedAtMs).toISOString(),
    completedAtIso: null,
    endedReason: null,
  })
}

export async function recordSetComplete(args: {
  setId: string
  completedAtMs: number
  endedReason: 't_pose' | 'abandoned'
}): Promise<void> {
  const existing = await bufferDB.sets.get(args.setId)
  if (!existing) return
  existing.completedAtIso = new Date(args.completedAtMs).toISOString()
  existing.endedReason = args.endedReason
  await bufferDB.sets.put(existing)
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
  const rows = await bufferDB.sessions.where('uploaded').equals(0).toArray()
  return rows.filter((s) => s.status !== 'in_progress')
}

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
  const [session, hrSamples, poseFrames, sets] = await Promise.all([
    bufferDB.sessions.get(sessionId),
    bufferDB.hrSamples.where('sessionId').equals(sessionId).toArray(),
    bufferDB.poseFrames.where('sessionId').equals(sessionId).toArray(),
    bufferDB.sets.where('sessionId').equals(sessionId).toArray(),
  ])
  return { session, hrSamples, poseFrames, sets }
}

export async function clearSession(sessionId: string): Promise<void> {
  await bufferDB.transaction(
    'rw',
    [bufferDB.sessions, bufferDB.hrSamples, bufferDB.poseFrames, bufferDB.sets],
    async () => {
      await bufferDB.sessions.delete(sessionId)
      await bufferDB.hrSamples.where('sessionId').equals(sessionId).delete()
      await bufferDB.poseFrames.where('sessionId').equals(sessionId).delete()
      await bufferDB.sets.where('sessionId').equals(sessionId).delete()
    },
  )
  resetPoseDownsampler(sessionId)
}

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
