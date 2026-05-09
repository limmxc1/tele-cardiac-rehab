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
  id?: number
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
  reps!: Table<BufferedRep, number>
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
  }
}

export const bufferDB = new SessionBufferDB()

// Pose downsampling: 10fps target → minimum 100ms gap between accepted frames per session.
const POSE_TARGET_INTERVAL_MS = 100
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
  timestampMs: number,
  landmarks: NormalizedLandmark[],
  sessionStartMs: number,
): Promise<void> {
  const last = lastAcceptedPoseTs.get(sessionId)
  if (last !== undefined && timestampMs - last < POSE_TARGET_INTERVAL_MS) return
  lastAcceptedPoseTs.set(sessionId, timestampMs)

  const offsetMs = timestampMs - sessionStartMs
  if (offsetMs < 0) return
  const secondOffset = Math.floor(offsetMs / 1000)
  const key = `${sessionId}|${secondOffset}`
  const packed: PackedFrame = { ts_ms: offsetMs, lm: packLandmarks(landmarks) }

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

export async function recordRep(rep: Omit<BufferedRep, 'id'>): Promise<void> {
  await bufferDB.reps.add(rep)
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
  // Filter in JS to avoid IDBKeyRange complications with status+uploaded compound.
  const rows = await bufferDB.sessions.where('uploaded').equals(0).toArray()
  return rows.filter((s) => s.status !== 'in_progress')
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
