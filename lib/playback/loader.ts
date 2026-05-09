import { supabaseServer } from '@/lib/supabase/server'

export type PlaybackPose = {
  // ms relative to session start
  tMs: number
  // 33 landmarks × [x, y, z] (normalized)
  lm: [number, number, number][]
}

export type PlaybackHR = {
  tMs: number
  bpm: number
}

export type PlaybackRep = {
  id: string
  setNumber: number
  exerciseName: string
  repNumber: number
  startedTMs: number
  completedTMs: number
  peakAngleDegrees: number | null
  romAchievedDegrees: number | null
  hrBpmAtPeak: number | null
}

export type PlaybackPause = {
  id: string
  pausedTMs: number
  resumedTMs: number | null
  reason: string
}

export type PlaybackSet = {
  id: string
  setNumber: number
  exerciseName: string
  exerciseId: string
  startedTMs: number
  completedTMs: number | null
  repsCompleted: number
  repsTarget: number
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
  reps: PlaybackRep[]
  pauses: PlaybackPause[]
  sets: PlaybackSet[]
}

type PackedFrame = { ts_ms: number; lm: [number, number, number][] }

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

  const [setsRes, repsRes, pausesRes, hrRes, poseRes] = await Promise.all([
    supabaseServer
      .from('session_sets')
      .select('id, set_number, exercise_id, started_at, completed_at, reps_completed, reps_target, ended_reason, exercises:exercise_id ( name )')
      .eq('session_id', sessionId)
      .order('set_number', { ascending: true }),
    supabaseServer
      .from('session_reps')
      .select('id, session_set_id, rep_number, started_at, completed_at, peak_angle_degrees, rom_achieved_degrees, hr_bpm_at_peak')
      .order('rep_number', { ascending: true })
      .limit(2000), // generous cap; one session won't realistically exceed
    supabaseServer
      .from('session_pauses')
      .select('id, paused_at, resumed_at, reason')
      .eq('session_id', sessionId)
      .order('paused_at', { ascending: true }),
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

  type SetRow = {
    id: string
    set_number: number
    exercise_id: string
    started_at: string
    completed_at: string | null
    reps_completed: number
    reps_target: number
    ended_reason: string | null
    exercises: { name: string } | { name: string }[] | null
  }
  const sets: PlaybackSet[] = ((setsRes.data ?? []) as SetRow[]).map((s) => {
    const ex = Array.isArray(s.exercises) ? s.exercises[0] : s.exercises
    return {
      id: s.id,
      setNumber: s.set_number,
      exerciseName: ex?.name ?? 'Exercise',
      exerciseId: s.exercise_id,
      startedTMs: new Date(s.started_at).getTime() - startedAtMs,
      completedTMs: s.completed_at ? new Date(s.completed_at).getTime() - startedAtMs : null,
      repsCompleted: s.reps_completed,
      repsTarget: s.reps_target,
      endedReason: s.ended_reason,
    }
  })

  // Filter reps to ones whose set belongs to this session.
  const setIdMap = new Map(sets.map((s) => [s.id, s]))
  const reps: PlaybackRep[] = (repsRes.data ?? [])
    .filter((r) => setIdMap.has(r.session_set_id))
    .map((r) => {
      const set = setIdMap.get(r.session_set_id)!
      return {
        id: r.id,
        setNumber: set.setNumber,
        exerciseName: set.exerciseName,
        repNumber: r.rep_number,
        startedTMs: new Date(r.started_at).getTime() - startedAtMs,
        completedTMs: new Date(r.completed_at).getTime() - startedAtMs,
        peakAngleDegrees: r.peak_angle_degrees,
        romAchievedDegrees: r.rom_achieved_degrees,
        hrBpmAtPeak: r.hr_bpm_at_peak,
      }
    })
    .sort((a, b) => a.startedTMs - b.startedTMs)

  const pauses: PlaybackPause[] = (pausesRes.data ?? []).map((p) => ({
    id: p.id,
    pausedTMs: new Date(p.paused_at).getTime() - startedAtMs,
    resumedTMs: p.resumed_at ? new Date(p.resumed_at).getTime() - startedAtMs : null,
    reason: p.reason,
  }))

  const hr: PlaybackHR[] = (hrRes.data ?? []).map((h) => ({
    tMs: Number(h.timestamp_ms) - startedAtMs,
    bpm: h.hr_bpm,
  }))

  // Flatten pose frames; inner ts_ms is epoch ms (per Phase 7.1 alignment).
  const poses: PlaybackPose[] = []
  for (const row of poseRes.data ?? []) {
    const arr = row.frames as unknown as PackedFrame[] | null
    if (!Array.isArray(arr)) continue
    for (const f of arr) {
      poses.push({ tMs: f.ts_ms - startedAtMs, lm: f.lm })
    }
  }
  poses.sort((a, b) => a.tMs - b.tMs)

  // Duration: prefer completed_at; otherwise fall back to last sample we have.
  const lastPoseT = poses.length > 0 ? poses[poses.length - 1].tMs : 0
  const lastHrT = hr.length > 0 ? hr[hr.length - 1].tMs : 0
  const lastRepT = reps.length > 0 ? reps[reps.length - 1].completedTMs : 0
  const fallbackEnd = Math.max(lastPoseT, lastHrT, lastRepT)
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
    reps,
    pauses,
    sets,
  }
}
