import { supabaseServer } from '@/lib/supabase/server'
import type { TrackedJointSpec } from '@/app/actions/exercises'

export type SparseLandmarks = Record<number, [number, number, number]>

export type PlaybackPose = {
  // ms relative to session start
  tMs: number
  lm: SparseLandmarks
}

export type PlaybackHR = {
  tMs: number
  bpm: number
}

export type PlaybackSet = {
  id: string
  setNumber: number
  exerciseName: string
  exerciseId: string
  trackedJoints: TrackedJointSpec[]
  startedTMs: number
  completedTMs: number | null
  endedReason: string | null
}

export type PlaybackBundle = {
  sessionId: string
  patientId: string
  patientName: string
  prescriptionId: string
  hrUpperLimitBpm: number
  startedAtIso: string
  startedAtMs: number
  durationMs: number
  status: string
  clinicianNotes: string | null
  poses: PlaybackPose[]
  hr: PlaybackHR[]
  sets: PlaybackSet[]
  /** Union of every tracked joint across the session's sets — drives the playback charts. */
  trackedJoints: TrackedJointSpec[]
}

type PackedFrameLegacy = { ts_ms: number; lm: [number, number, number][] }
type PackedFrameSparse = { ts_ms: number; lm: SparseLandmarks }

function isSparseLm(lm: unknown): lm is SparseLandmarks {
  if (!lm || typeof lm !== 'object') return false
  if (Array.isArray(lm)) return false
  return true
}

export async function loadPlaybackBundle(sessionId: string): Promise<PlaybackBundle | null> {
  const { data: session } = await supabaseServer
    .from('sessions')
    .select(
      'id, patient_id, prescription_id, started_at, completed_at, status, clinician_notes, users:patient_id ( display_name ), prescriptions:prescription_id ( hr_upper_limit_bpm )',
    )
    .eq('id', sessionId)
    .single()

  if (!session) return null

  const startedAtMs = new Date(session.started_at).getTime()
  const completedAtMs = session.completed_at ? new Date(session.completed_at).getTime() : null

  const [setsRes, hrRes, poseRes] = await Promise.all([
    supabaseServer
      .from('session_sets')
      .select(
        'id, set_number, exercise_id, started_at, completed_at, ended_reason, ' +
        'exercises:exercise_id ( name, tracked_joints )',
      )
      .eq('session_id', sessionId)
      .order('set_number', { ascending: true }),
    supabaseServer
      .from('session_hr_samples')
      .select('timestamp_ms, hr_bpm')
      .eq('session_id', sessionId)
      .order('timestamp_ms', { ascending: true }),
    supabaseServer
      .from('session_pose_frames')
      .select('second_offset, frames')
      .eq('session_id', sessionId)
      .order('second_offset', { ascending: true }),
  ])

  type ExerciseJoin = { name: string; tracked_joints: unknown }
  type SetRow = {
    id: string
    set_number: number
    exercise_id: string
    started_at: string
    completed_at: string | null
    ended_reason: string | null
    exercises: ExerciseJoin | ExerciseJoin[] | null
  }

  function parseTracked(raw: unknown): TrackedJointSpec[] {
    if (!Array.isArray(raw)) return []
    return (raw as TrackedJointSpec[]).filter(
      (t) => t && typeof t.joint === 'string' && (t.side === 'left' || t.side === 'right'),
    )
  }

  const sets: PlaybackSet[] = ((setsRes.data ?? []) as unknown as SetRow[]).map((s) => {
    const ex = Array.isArray(s.exercises) ? s.exercises[0] : s.exercises
    return {
      id: s.id,
      setNumber: s.set_number,
      exerciseName: ex?.name ?? 'Exercise',
      exerciseId: s.exercise_id,
      trackedJoints: parseTracked(ex?.tracked_joints),
      startedTMs: new Date(s.started_at).getTime() - startedAtMs,
      completedTMs: s.completed_at ? new Date(s.completed_at).getTime() - startedAtMs : null,
      endedReason: s.ended_reason,
    }
  })

  const hr: PlaybackHR[] = (hrRes.data ?? []).map((h) => ({
    tMs: Number(h.timestamp_ms) - startedAtMs,
    bpm: h.hr_bpm,
  }))

  // Pose frames: support both new sparse and legacy dense formats so old
  // sessions still play back.
  const poses: PlaybackPose[] = []
  for (const row of poseRes.data ?? []) {
    const arr = row.frames as unknown as (PackedFrameSparse | PackedFrameLegacy)[] | null
    if (!Array.isArray(arr)) continue
    for (const f of arr) {
      let lm: SparseLandmarks
      if (Array.isArray(f.lm)) {
        lm = {}
        for (let i = 0; i < f.lm.length; i++) {
          const p = f.lm[i]
          if (Array.isArray(p) && p.length >= 3) {
            lm[i] = [p[0], p[1], p[2]]
          }
        }
      } else if (isSparseLm(f.lm)) {
        lm = {}
        for (const [k, v] of Object.entries(f.lm as SparseLandmarks)) {
          const idx = Number(k)
          if (Number.isFinite(idx) && Array.isArray(v) && v.length >= 3) {
            lm[idx] = [v[0], v[1], v[2]]
          }
        }
      } else {
        continue
      }
      poses.push({ tMs: f.ts_ms - startedAtMs, lm })
    }
  }
  poses.sort((a, b) => a.tMs - b.tMs)

  // Union of tracked joints (deduped by side+joint).
  const trackedSet = new Map<string, TrackedJointSpec>()
  for (const s of sets) {
    for (const t of s.trackedJoints) {
      trackedSet.set(`${t.side}_${t.joint}`, t)
    }
  }
  const trackedJoints = Array.from(trackedSet.values())

  const lastPoseT = poses.length > 0 ? poses[poses.length - 1].tMs : 0
  const lastHrT = hr.length > 0 ? hr[hr.length - 1].tMs : 0
  const lastSetT = sets.reduce((m, s) => Math.max(m, s.completedTMs ?? s.startedTMs), 0)
  const fallbackEnd = Math.max(lastPoseT, lastHrT, lastSetT)
  const durationMs = completedAtMs !== null
    ? Math.max(completedAtMs - startedAtMs, fallbackEnd)
    : fallbackEnd

  type SessionRow = typeof session & {
    users: { display_name: string } | { display_name: string }[] | null
    prescriptions: { hr_upper_limit_bpm: number } | { hr_upper_limit_bpm: number }[] | null
  }
  const s = session as SessionRow
  const userJoin = Array.isArray(s.users) ? s.users[0] : s.users
  const rxJoin = Array.isArray(s.prescriptions) ? s.prescriptions[0] : s.prescriptions

  return {
    sessionId: session.id,
    patientId: session.patient_id,
    patientName: userJoin?.display_name ?? 'Patient',
    prescriptionId: session.prescription_id,
    hrUpperLimitBpm: rxJoin?.hr_upper_limit_bpm ?? 0,
    startedAtIso: session.started_at,
    startedAtMs,
    durationMs,
    status: session.status,
    clinicianNotes: session.clinician_notes,
    poses,
    hr,
    sets,
    trackedJoints,
  }
}
