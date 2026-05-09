'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { PolarH10, type H10Status } from '@/lib/hr/polarH10'
import {
  SessionStateMachine,
  type SetEntry,
  type SessionSnapshot,
  type SessionEvents,
} from '@/lib/pose/sessionStateMachine'
import { isMuted, setMuted } from '@/lib/audio/cues'
import HRRing from '@/components/hr/HRRing'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import {
  startSession,
  recordHR,
  recordPoseFrame,
  recordSetStart,
  recordSetComplete,
  recordRep,
  recordPauseStart,
  recordPauseEnd,
  markSessionComplete,
  abandonStaleSessionsFor,
} from '@/lib/buffer/sessionBuffer'
import { uploadSession } from '@/lib/sync/uploader'

const CameraStickman = dynamic(() => import('@/components/pose/CameraStickman'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 bg-black flex items-center justify-center">
      <p className="text-slate-400 text-sm">Starting camera…</p>
    </div>
  ),
})

interface Props {
  prescriptionId: string
  patientId: string
  hrLimit: number
  sets: SetEntry[]
  startSetIdx: number
}

type UploadState = 'idle' | 'uploading' | 'uploaded' | 'failed'

export default function SessionRunClient({
  prescriptionId,
  patientId,
  hrLimit,
  sets,
  startSetIdx,
}: Props) {
  const router = useRouter()
  const smRef = useRef<SessionStateMachine | null>(null)
  const h10Ref = useRef<PolarH10 | null>(null)

  // Session/persistence refs.
  const sessionIdRef = useRef<string | null>(null)
  const sessionStartPerfRef = useRef<number>(0)
  const sessionStartWallRef = useRef<number>(0)
  const setIdsRef = useRef<Map<number, string>>(new Map())
  const activePauseIdRef = useRef<string | null>(null)
  const sessionEndedRef = useRef(false)
  const uploadKickedRef = useRef(false)

  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const snapPhaseRef = useRef<SessionSnapshot['phase']>('IDLE')

  /** Convert performance.now()-style ms to wall-clock ms using the captured offset. */
  const toWall = useCallback((perfMs: number) => {
    return sessionStartWallRef.current + (perfMs - sessionStartPerfRef.current)
  }, [])

  const [snap, setSnap] = useState<SessionSnapshot>(() => ({
    phase: 'IDLE',
    set: sets[startSetIdx] ?? sets[0],
    repsCompleted: 0,
    pauseReason: null,
    tposeProgress: 0,
    restSecondsLeft: 0,
    hrBpm: null,
    countdownSecondsLeft: 0,
    completedReps: [],
  }))
  const [h10Status, setH10Status] = useState<H10Status>('idle')
  // Lazy init reads localStorage on the client. On the server `window` is
  // undefined and we default to false; React re-renders on hydration if the
  // persisted value differs (benign for a small UI flag).
  const [mutedUI, setMutedUI] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : isMuted(),
  )

  useEffect(() => { snapPhaseRef.current = snap.phase }, [snap.phase])

  useEffect(() => {
    const events: SessionEvents = {
      onSetStart: ({ setIdx, set, ts_ms }) => {
        const sessionId = sessionIdRef.current
        if (!sessionId) return
        // Resuming from PAUSED also re-fires onSetStart (state machine goes
        // PAUSED → READY → ACTIVE). Reuse the existing setId so reps from
        // before the pause and reps after both anchor to one row.
        const existing = setIdsRef.current.get(setIdx)
        if (existing) return
        const setId = crypto.randomUUID()
        setIdsRef.current.set(setIdx, setId)
        void recordSetStart({
          setId,
          sessionId,
          prescriptionItemId: set.prescriptionItemId,
          exerciseId: set.exerciseId,
          setNumber: set.setNumber,
          repsTarget: set.repsTarget,
          startedAtMs: toWall(ts_ms),
        })
      },
      onRepComplete: ({ setIdx, repNumber, rep }) => {
        const sessionId = sessionIdRef.current
        const setId = setIdsRef.current.get(setIdx)
        if (!sessionId || !setId) return
        void recordRep({
          repId: crypto.randomUUID(),
          sessionId,
          sessionSetId: setId,
          repNumber,
          startedAtIso: new Date(toWall(rep.startedAt)).toISOString(),
          completedAtIso: new Date(toWall(rep.completedAt)).toISOString(),
          peakAngleDegrees: rep.peakAngleDegrees,
          romAchievedDegrees: rep.romDegrees,
          hrBpmAtPeak: rep.hrBpmAtPeak,
        })
      },
      onSetEnd: ({ setIdx, ts_ms, reason, repsCompleted }) => {
        const setId = setIdsRef.current.get(setIdx)
        if (!setId) return
        void recordSetComplete({
          setId,
          completedAtMs: toWall(ts_ms),
          repsCompleted,
          endedReason: reason,
        })
      },
      onPauseStart: ({ reason, ts_ms }) => {
        const sessionId = sessionIdRef.current
        if (!sessionId) return
        const pauseId = crypto.randomUUID()
        activePauseIdRef.current = pauseId
        void recordPauseStart({ pauseId, sessionId, pausedAtMs: toWall(ts_ms), reason })
      },
      onPauseEnd: ({ ts_ms }) => {
        const pauseId = activePauseIdRef.current
        if (!pauseId) return
        activePauseIdRef.current = null
        void recordPauseEnd({ pauseId, resumedAtMs: toWall(ts_ms) })
      },
      onSessionEnd: ({ ts_ms }) => {
        const sessionId = sessionIdRef.current
        if (!sessionId || sessionEndedRef.current) return
        sessionEndedRef.current = true
        void markSessionComplete(sessionId, toWall(ts_ms), 'completed')
      },
    }
    const sm = new SessionStateMachine(sets, startSetIdx, hrLimit, setSnap, events)
    smRef.current = sm
    return () => { sm.destroy(); smRef.current = null }
  }, [sets, startSetIdx, hrLimit, toWall])

  // Kick off upload when SESSION_COMPLETE fires; navigate after it finishes (or fails).
  useEffect(() => {
    if (snap.phase !== 'SESSION_COMPLETE') return
    if (uploadKickedRef.current) return
    uploadKickedRef.current = true

    const sessionId = sessionIdRef.current
    if (!sessionId) {
      const t = setTimeout(() => router.push('/patient/calendar'), 3000)
      return () => clearTimeout(t)
    }

    setUploadState('uploading')
    let cancelled = false
    void (async () => {
      const result = await uploadSession(sessionId)
      if (cancelled) return
      if (result.ok) {
        setUploadState('uploaded')
        setTimeout(() => router.push('/patient/calendar'), 1500)
      } else {
        setUploadState('failed')
        setUploadError(result.error)
        // Buffer keeps the session for next-load orphan flush.
      }
    })()
    return () => { cancelled = true }
  }, [snap.phase, router])

  const handlePose = useCallback((poses: NormalizedLandmark[][], timestamp_ms: number) => {
    const sm = smRef.current
    if (!sm) return
    sm.setPersonCount(poses.length, timestamp_ms)
    const first = poses[0]
    if (first) {
      sm.feedPose(first, timestamp_ms)
      const sessionId = sessionIdRef.current
      // Only record while ACTIVE — wasted bytes during overlays/idle add up fast.
      if (sessionId && smRef.current && snapPhaseRef.current === 'ACTIVE') {
        const wallMs = toWall(timestamp_ms)
        void recordPoseFrame(sessionId, wallMs, first, sessionStartWallRef.current)
      }
    }
  }, [toWall])

  const handleConnectH10 = useCallback(async () => {
    const h10 = new PolarH10()
    h10Ref.current = h10
    h10.onStatus((status) => {
      setH10Status(status)
      smRef.current?.setH10Connected(status === 'connected')
    })
    h10.onHR((s) => {
      smRef.current?.feedHR(s.hr_bpm, s.timestamp_ms)
      const sessionId = sessionIdRef.current
      // s.timestamp_ms is wall-clock from PolarH10 (Date.now()); record verbatim.
      if (sessionId && Number.isFinite(s.hr_bpm)) {
        void recordHR(sessionId, s.timestamp_ms, s.hr_bpm)
      }
    })
    try { await h10.connect() } catch (err) {
      console.error('[H10]', err)
      h10Ref.current = null
    }
  }, [])

  const handleStart = useCallback(() => {
    if (sessionIdRef.current) {
      smRef.current?.start()
      return
    }
    const sessionId = crypto.randomUUID()
    const wall = Date.now()
    const perf = performance.now()
    sessionIdRef.current = sessionId
    sessionStartWallRef.current = wall
    sessionStartPerfRef.current = perf
    // Mark any prior in_progress buffer entries for this patient+prescription
    // as abandoned so the calendar flusher uploads them next pass.
    void abandonStaleSessionsFor(patientId, prescriptionId)
      .then(() => startSession({ sessionId, prescriptionId, patientId, startedAtMs: wall }))
      .then(() => smRef.current?.start())
  }, [prescriptionId, patientId])

  // If the patient closes the tab mid-session, mark abandoned so the data
  // doesn't sit in IndexedDB forever as 'in_progress'.
  useEffect(() => {
    const handler = () => {
      const sessionId = sessionIdRef.current
      if (!sessionId || sessionEndedRef.current) return
      // Synchronous Dexie write isn't possible; best-effort fire-and-forget.
      void markSessionComplete(sessionId, Date.now(), 'abandoned')
    }
    window.addEventListener('beforeunload', handler)
    window.addEventListener('pagehide', handler)
    return () => {
      window.removeEventListener('beforeunload', handler)
      window.removeEventListener('pagehide', handler)
    }
  }, [])

  const handleMuteToggle = useCallback(() => {
    const next = !isMuted()
    setMuted(next)
    setMutedUI(next)
  }, [])

  const { phase } = snap
  const isActive = phase === 'ACTIVE' || phase === 'READY'

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none">
      {/* Camera — always in background */}
      <CameraStickman className="absolute inset-0" onPose={handlePose} />

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-3 px-4 py-3 bg-gradient-to-b from-black/80 to-transparent">
        <HRRing hrBpm={snap.hrBpm} hrLimit={hrLimit} size={68} />
        <div className="flex-1 min-w-0 text-center">
          <p className="text-white font-semibold text-base leading-tight truncate">
            {snap.set.exerciseName}
          </p>
          <p className="text-slate-300 text-sm">
            Set {snap.set.setNumber} of {snap.set.totalSets}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={handleMuteToggle}
            className="text-xs px-2.5 py-1 rounded-lg bg-slate-700/80 text-slate-200"
          >
            {mutedUI ? '🔇' : '🔊'}
          </button>
          <span className={`text-xs font-medium ${h10Status === 'connected' ? 'text-green-400' : 'text-slate-500'}`}>
            {h10Status === 'connected' ? 'H10 ●' : 'H10 ○'}
          </span>
        </div>
      </div>

      {/* Bottom: rep counter + reference GIF (during active/ready) */}
      {isActive && (
        <div className="absolute bottom-0 inset-x-0 z-10 flex items-end justify-between px-6 py-5 bg-gradient-to-t from-black/80 to-transparent">
          <div className="bg-black/70 rounded-2xl px-5 py-3 text-center">
            <p className="text-5xl font-bold text-white tabular-nums">{snap.repsCompleted}</p>
            <p className="text-slate-400 text-xs mt-0.5">/ {snap.set.repsTarget} reps</p>
          </div>
          {snap.set.referenceGifUrl && (
            <div className="w-24 h-24 rounded-xl overflow-hidden border border-slate-600">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={snap.set.referenceGifUrl} alt="Reference" className="w-full h-full object-cover" />
            </div>
          )}
        </div>
      )}

      {/* T-pose ring (during ACTIVE when holding) */}
      {phase === 'ACTIVE' && snap.tposeProgress > 0 && (
        <div className="absolute bottom-24 right-6 z-20">
          <TPoseRing progress={snap.tposeProgress} />
        </div>
      )}

      {/* ── State overlays ── */}

      {phase === 'IDLE' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 bg-black/65">
          <div className="text-center px-6">
            <p className="text-white text-2xl font-bold">{snap.set.exerciseName}</p>
            <p className="text-slate-300 text-sm mt-1">
              {snap.set.repsTarget} reps × {snap.set.totalSets} set{snap.set.totalSets > 1 ? 's' : ''}
            </p>
          </div>
          {h10Status !== 'connected' && h10Status !== 'reconnecting' && (
            <button
              onClick={handleConnectH10}
              className="px-5 py-2.5 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-500"
            >
              Connect H10 (optional)
            </button>
          )}
          <button
            onClick={handleStart}
            className="px-12 py-5 rounded-2xl bg-green-600 text-white text-2xl font-bold hover:bg-green-500 active:bg-green-700 transition-colors"
          >
            Start
          </button>
          <p className="text-slate-500 text-xs">T-pose during a set to end it early</p>
        </div>
      )}

      {phase === 'READY' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="bg-black/75 rounded-3xl px-14 py-8 text-center">
            <p className="text-slate-300 text-sm uppercase tracking-widest">Get Ready</p>
            <p className="text-white text-8xl font-bold mt-1 tabular-nums">
              {snap.countdownSecondsLeft || 1}
            </p>
          </div>
        </div>
      )}

      {phase === 'PAUSED' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-black/75">
          <PauseOverlay
            reason={snap.pauseReason}
            tposeProgress={snap.tposeProgress}
            hrBpm={snap.hrBpm}
            hrLimit={hrLimit}
          />
        </div>
      )}

      {phase === 'SET_COMPLETE' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/75">
          <p className="text-green-400 text-5xl font-bold">Set Done!</p>
          <p className="text-white text-2xl tabular-nums">{snap.repsCompleted} reps</p>
          {!snap.set.isLastSet && (
            <p className="text-slate-300 text-sm mt-1">
              {snap.set.isLastSetOfItem
                ? `Next: ${snap.set.nextExerciseName ?? ''}…`
                : 'Rest coming up…'}
            </p>
          )}
        </div>
      )}

      {phase === 'RESTING' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/75">
          <p className="text-slate-200 text-2xl font-semibold">Rest</p>
          <p className="text-white text-8xl font-bold tabular-nums">{snap.restSecondsLeft}</p>
          <p className="text-slate-400 text-sm">seconds</p>
          <p className="text-slate-300 text-sm mt-2">
            Next: {snap.set.exerciseName} — Set {snap.set.setNumber} of {snap.set.totalSets}
          </p>
        </div>
      )}

      {phase === 'SESSION_COMPLETE' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/90 px-6">
          <p className="text-green-400 text-4xl font-bold text-center">Session Complete!</p>
          {uploadState === 'uploading' && (
            <p className="text-slate-300 text-base">Uploading session data…</p>
          )}
          {uploadState === 'uploaded' && (
            <p className="text-slate-300 text-base">Saved. Returning to calendar…</p>
          )}
          {uploadState === 'failed' && (
            <div className="flex flex-col items-center gap-3 max-w-sm">
              <p className="text-amber-300 text-sm text-center">
                Upload failed. Your session is saved on this device and will retry next time you open the app.
              </p>
              {uploadError && (
                <p className="text-slate-500 text-xs text-center break-all">{uploadError}</p>
              )}
              <button
                onClick={() => router.push('/patient/calendar')}
                className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium"
              >
                Return to calendar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function PauseOverlay({
  reason,
  tposeProgress,
  hrBpm,
  hrLimit,
}: {
  reason: string | null
  tposeProgress: number
  hrBpm: number | null
  hrLimit: number
}) {
  const info: Record<string, { title: string; subtitle: string }> = {
    hr_breach:       { title: 'Heart Rate Too High',  subtitle: 'Rest — show T-pose when ready' },
    h10_disconnect:  { title: 'H10 Disconnected',     subtitle: 'Reconnecting automatically…' },
    out_of_frame:    { title: 'Out of Frame',          subtitle: 'Step back into camera view' },
    multiple_people: { title: 'Multiple People',       subtitle: 'Please exercise alone' },
  }
  const { title, subtitle } = (reason ? info[reason] : undefined) ?? { title: 'Paused', subtitle: '' }

  return (
    <>
      <p className="text-red-400 text-3xl font-bold text-center px-6">{title}</p>
      <p className="text-slate-300 text-base text-center">{subtitle}</p>
      {hrBpm !== null && (
        <p className={`text-3xl font-semibold tabular-nums ${hrBpm > hrLimit ? 'text-red-400' : 'text-slate-200'}`}>
          {hrBpm} bpm
        </p>
      )}
      {reason === 'hr_breach' && tposeProgress > 0 && (
        <TPoseRing progress={tposeProgress} />
      )}
    </>
  )
}

function TPoseRing({ progress }: { progress: number }) {
  const size = 100
  const r = size / 2 - 8
  const circ = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#374151" strokeWidth={8} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="#22c55e" strokeWidth={8}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - progress)}
          strokeLinecap="round"
        />
      </svg>
      <p className="text-slate-400 text-xs">Hold T-pose</p>
    </div>
  )
}
