'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { PolarH10, type H10Status } from '@/lib/hr/polarH10'
import {
  SessionStateMachine,
  isFullyInFrame,
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
  findResumableSession,
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

const LiveStickman = dynamic(() => import('@/components/patient/LiveStickman'), { ssr: false })

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
  // Clock-conversion baseline: paired (perf, wall) captured at the same instant
  // we attached to the session — for fresh sessions this is session start; for
  // a resume it's the resume moment. Used by toWall() to convert perf timestamps
  // (from MediaPipe / state machine) into current wall time.
  const clockBasePerfRef = useRef<number>(0)
  const clockBaseWallRef = useRef<number>(0)
  // The actual original session start wall time. For fresh sessions == clockBaseWallRef;
  // for resumed sessions, points at the original `startedAt` so pose-frame
  // second_offset chunking stays continuous with the existing buffer.
  const sessionStartedAtWallRef = useRef<number>(0)
  const setIdsRef = useRef<Map<number, string>>(new Map())
  const activePauseIdRef = useRef<string | null>(null)
  const sessionEndedRef = useRef(false)
  const uploadKickedRef = useRef(false)
  const [resumable, setResumable] = useState<{ sessionId: string; startedAtMs: number } | null>(null)

  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const snapPhaseRef = useRef<SessionSnapshot['phase']>('IDLE')

  /** Convert performance.now()-style ms to wall-clock ms using the captured offset. */
  const toWall = useCallback((perfMs: number) => {
    return clockBaseWallRef.current + (perfMs - clockBasePerfRef.current)
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
    fullyInFrame: false,
    primaryAngleDegrees: null,
    secondaryAngleDegrees: null,
  }))
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const [h10Status, setH10Status] = useState<H10Status>('idle')
  const [h10Error, setH10Error] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<{ kind: 'denied' | 'unavailable' | 'unknown'; message: string } | null>(null)
  const [cameraRetryKey, setCameraRetryKey] = useState(0)
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

  // Latest pose landmarks for the right-column LiveStickman canvas. Stored in
  // a ref so 30fps pose updates don't trigger React re-renders of the page.
  const latestLmRef = useRef<NormalizedLandmark[] | null>(null)

  const handlePose = useCallback((poses: NormalizedLandmark[][], timestamp_ms: number) => {
    const sm = smRef.current
    if (!sm) return
    sm.setPersonCount(poses.length, timestamp_ms)
    const first = poses[0]
    latestLmRef.current = first ?? null
    if (first) {
      sm.feedPose(first, timestamp_ms)
      const sessionId = sessionIdRef.current
      // Recording gate: ACTIVE phase + full 33-landmark visibility + exactly
      // one person in frame. The state machine itself pauses on partial body
      // / multi-person, but defending in the recorder means we never write a
      // partial frame even within the 2s pause-debounce window.
      if (
        sessionId &&
        snapPhaseRef.current === 'ACTIVE' &&
        poses.length === 1 &&
        isFullyInFrame(first)
      ) {
        const wallMs = toWall(timestamp_ms)
        void recordPoseFrame(sessionId, wallMs, first, sessionStartedAtWallRef.current)
      }
    }
  }, [toWall])

  const handleConnectH10 = useCallback(async () => {
    setH10Error(null)
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
    try {
      await h10.connect()
    } catch (err: unknown) {
      console.error('[H10]', err)
      h10Ref.current = null
      const name = err instanceof DOMException ? err.name : ''
      // NotFoundError = user dismissed the chooser without picking; not an error.
      if (name !== 'NotFoundError') {
        const friendly =
          name === 'SecurityError'
            ? 'Bluetooth permission denied. Tap "Connect H10" again and accept.'
            : name === 'NotAllowedError'
              ? 'Bluetooth blocked. Open browser settings to allow Bluetooth, then retry.'
              : err instanceof Error && err.message.includes('not supported')
                ? 'Web Bluetooth not supported on this browser. Use Chrome on Android.'
                : err instanceof Error
                  ? err.message
                  : 'Could not connect to Polar H10.'
        setH10Error(friendly)
      }
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
    clockBaseWallRef.current = wall
    clockBasePerfRef.current = perf
    sessionStartedAtWallRef.current = wall
    // Mark any prior in_progress buffer entries for this patient+prescription
    // as abandoned so the calendar flusher uploads them next pass.
    void abandonStaleSessionsFor(patientId, prescriptionId)
      .then(() => startSession({ sessionId, prescriptionId, patientId, startedAtMs: wall }))
      .then(() => smRef.current?.start())
  }, [prescriptionId, patientId])

  // Resume an in-progress session left in IndexedDB (browser crashed, tab
  // closed mid-rep, etc.). Does NOT abandon other sessions — the buffer's
  // existing data stays intact and we keep recording into the same sessionId.
  const handleResume = useCallback(() => {
    if (!resumable || sessionIdRef.current) return
    sessionIdRef.current = resumable.sessionId
    clockBaseWallRef.current = Date.now()
    clockBasePerfRef.current = performance.now()
    sessionStartedAtWallRef.current = resumable.startedAtMs
    setResumable(null)
    smRef.current?.start()
  }, [resumable])

  // Discard the resumable session: mark it abandoned so the calendar uploads
  // whatever was buffered, then drop the offer so the user sees the normal
  // Start flow.
  const handleDiscardResumable = useCallback(() => {
    void abandonStaleSessionsFor(patientId, prescriptionId)
    setResumable(null)
  }, [patientId, prescriptionId])

  // Look for a resumable session once on mount.
  useEffect(() => {
    let cancelled = false
    void findResumableSession(patientId, prescriptionId).then((r) => {
      if (cancelled || !r) return
      setResumable({ sessionId: r.sessionId, startedAtMs: r.startedAtMs })
    })
    return () => { cancelled = true }
  }, [patientId, prescriptionId])

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

  const handleConfirmEnd = useCallback(() => {
    setConfirmingEnd(false)
    smRef.current?.endSessionEarly('abandoned')
  }, [])

  const { phase } = snap
  const isActive = phase === 'ACTIVE' || phase === 'READY'

  const handleCameraRetry = useCallback(() => {
    setCameraError(null)
    setCameraRetryKey((k) => k + 1)
  }, [])

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden select-none flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2.5 z-10">
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-base leading-tight truncate">
            {snap.set.exerciseName}
          </p>
          <p className="text-slate-400 text-xs">
            Set {snap.set.setNumber} of {snap.set.totalSets}
          </p>
        </div>
        <span className={`text-xs font-medium ${h10Status === 'connected' ? 'text-green-400' : 'text-slate-500'}`}>
          {h10Status === 'connected' ? 'H10 ●' : 'H10 ○'}
        </span>
        <button
          onClick={handleMuteToggle}
          className="text-base px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
          aria-label={mutedUI ? 'Unmute' : 'Mute'}
        >
          {mutedUI ? '🔇' : '🔊'}
        </button>
        {phase !== 'IDLE' && phase !== 'SESSION_COMPLETE' && (
          <button
            onClick={() => setConfirmingEnd(true)}
            className="rounded-lg bg-rose-600/90 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-600"
          >
            End workout
          </button>
        )}
      </div>

      {/* Body — 2 columns: camera left, stats right */}
      <div className="flex-1 grid grid-cols-2 gap-3 p-3 min-h-0">
        {/* Left: live camera (with skeleton overlay).
            `key` lets us tear down + remount on retry. */}
        <div className="relative rounded-xl overflow-hidden bg-black">
          <CameraStickman
            key={cameraRetryKey}
            className="w-full h-full"
            onPose={handlePose}
            onCameraError={(kind, message) => setCameraError({ kind, message })}
          />
        </div>

        {/* Right: reps + HR + clean stickman + ref GIF */}
        <div className="flex flex-col gap-3 min-h-0">
          {/* Reps counter */}
          <div className="rounded-xl bg-slate-900 px-6 py-4 text-center">
            <p className="text-7xl font-bold text-white tabular-nums leading-none">
              {snap.repsCompleted}
            </p>
            <p className="text-slate-400 text-sm mt-2">
              / {snap.set.repsTarget} reps
            </p>
          </div>

          {/* HR ring */}
          <div className="rounded-xl bg-slate-900 px-6 py-4 flex items-center justify-center">
            <HRRing hrBpm={snap.hrBpm} hrLimit={hrLimit} size={140} />
          </div>

          {/* Joint angles — live readouts vs. target zones during ACTIVE/PAUSED. */}
          {(phase === 'ACTIVE' || phase === 'PAUSED') && (
            <div className="rounded-xl bg-slate-900 px-4 py-3 flex flex-col gap-2.5">
              <JointAngleMeter
                label={`${capitalize(snap.set.repConfig.primaryJoint)}${snap.set.repConfig.primarySide === 'both' ? '' : ` (${snap.set.repConfig.primarySide})`}`}
                current={snap.primaryAngleDegrees}
                startMin={snap.set.repConfig.startAngleMin}
                startMax={snap.set.repConfig.startAngleMax}
                endMin={snap.set.repConfig.endAngleMin}
                endMax={snap.set.repConfig.endAngleMax}
              />
              {snap.set.repConfig.secondaryJoint &&
                snap.set.repConfig.secondaryStartMin !== undefined &&
                snap.set.repConfig.secondaryStartMax !== undefined &&
                snap.set.repConfig.secondaryEndMin !== undefined &&
                snap.set.repConfig.secondaryEndMax !== undefined && (
                  <JointAngleMeter
                    label={`${capitalize(snap.set.repConfig.secondaryJoint)}${snap.set.repConfig.primarySide === 'both' ? '' : ` (${snap.set.repConfig.primarySide})`}`}
                    current={snap.secondaryAngleDegrees}
                    startMin={snap.set.repConfig.secondaryStartMin}
                    startMax={snap.set.repConfig.secondaryStartMax}
                    endMin={snap.set.repConfig.secondaryEndMin}
                    endMax={snap.set.repConfig.secondaryEndMax}
                  />
                )}
            </div>
          )}

          {/* Live stickman figure (clean canvas, no camera background) */}
          <div className="flex-1 rounded-xl overflow-hidden bg-slate-900 min-h-0 relative">
            <LiveStickman landmarksRef={latestLmRef} />
            {/* T-pose ring overlaid on the stickman corner during ACTIVE */}
            {phase === 'ACTIVE' && snap.tposeProgress > 0 && (
              <div className="absolute bottom-3 right-3">
                <TPoseRing progress={snap.tposeProgress} />
              </div>
            )}
          </div>

          {/* Reference GIF (small, only while exercising) */}
          {isActive && snap.set.referenceGifUrl && (
            <div className="self-end w-28 h-28 rounded-xl overflow-hidden border border-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={snap.set.referenceGifUrl}
                alt="Reference"
                className="w-full h-full object-cover"
              />
            </div>
          )}
        </div>
      </div>

      {/* Camera error blocker — full screen because no camera means no session. */}
      {cameraError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/90 px-6 text-center">
          <p className="text-4xl">📷</p>
          <p className="text-2xl font-bold text-white">
            {cameraError.kind === 'denied'
              ? 'Camera permission denied'
              : cameraError.kind === 'unavailable'
                ? 'No camera detected'
                : 'Camera error'}
          </p>
          <p className="max-w-sm text-sm text-slate-300">
            {cameraError.kind === 'denied'
              ? 'Open browser settings, allow camera access for this site, then tap Retry.'
              : cameraError.kind === 'unavailable'
                ? 'Make sure no other app is using the camera, then tap Retry.'
                : cameraError.message}
          </p>
          <button
            onClick={handleCameraRetry}
            className="rounded-xl bg-blue-600 px-6 py-3 text-base font-medium text-white hover:bg-blue-500"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── State overlays ── */}

      {phase === 'IDLE' && resumable && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-black/75 px-6">
          <p className="text-3xl">↺</p>
          <p className="text-white text-2xl font-bold text-center">Resume previous session?</p>
          <p className="text-slate-300 text-sm text-center max-w-xs">
            We found an unfinished session from{' '}
            {new Date(resumable.startedAtMs).toLocaleString('en-SG', {
              hour: '2-digit',
              minute: '2-digit',
              day: 'numeric',
              month: 'short',
            })}
            . Continue where you left off, or discard and start fresh.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleResume}
              className="px-6 py-3 rounded-xl bg-blue-600 text-white text-base font-semibold hover:bg-blue-500"
            >
              Resume
            </button>
            <button
              onClick={handleDiscardResumable}
              className="px-6 py-3 rounded-xl bg-slate-700 text-slate-200 text-base font-medium hover:bg-slate-600"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {phase === 'IDLE' && !resumable && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 bg-black/65">
          <div className="text-center px-6">
            <p className="text-white text-2xl font-bold">{snap.set.exerciseName}</p>
            <p className="text-slate-300 text-sm mt-1">
              {snap.set.repsTarget} reps × {snap.set.totalSets} set{snap.set.totalSets > 1 ? 's' : ''}
            </p>
          </div>
          {h10Status !== 'connected' && h10Status !== 'reconnecting' && (
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={handleConnectH10}
                className="px-5 py-2.5 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-500"
              >
                Connect H10 (optional)
              </button>
              {h10Error && (
                <p className="max-w-xs px-3 text-center text-xs text-amber-300">{h10Error}</p>
              )}
            </div>
          )}
          <button
            onClick={handleStart}
            className="px-12 py-5 rounded-2xl bg-green-600 text-white text-2xl font-bold hover:bg-green-500 active:bg-green-700 transition-colors"
          >
            Start
          </button>
          <p className="text-slate-500 text-xs">
            After tapping Start, a 3-second countdown will begin · T-pose to end the workout early
          </p>
        </div>
      )}

      {phase === 'READY' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="bg-black/80 rounded-3xl px-10 py-6 text-center max-w-md">
            <p className="text-slate-300 text-xs uppercase tracking-widest">Get Ready</p>
            <p className="text-white text-2xl font-bold mt-1">
              {snap.set.exerciseName}
            </p>

            {snap.countdownSecondsLeft > 0 ? (
              <p className="mt-4 text-white text-8xl font-bold tabular-nums leading-none">
                {snap.countdownSecondsLeft}
              </p>
            ) : !snap.fullyInFrame ? (
              <p className="mt-4 text-amber-300 text-base font-medium">
                Step fully into the frame
              </p>
            ) : (
              <p className="mt-4 text-emerald-300 text-base font-medium">Begin</p>
            )}
          </div>
        </div>
      )}

      {confirmingEnd && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/90 px-6 text-center">
          <p className="text-3xl">⚠️</p>
          <p className="text-white text-2xl font-bold">End the workout now?</p>
          <p className="text-slate-300 text-sm max-w-sm">
            We&apos;ll save what you&apos;ve done so far and skip the remaining sets.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleConfirmEnd}
              className="px-6 py-3 rounded-xl bg-rose-600 text-white text-base font-semibold hover:bg-rose-500"
            >
              Yes, end workout
            </button>
            <button
              onClick={() => setConfirmingEnd(false)}
              className="px-6 py-3 rounded-xl bg-slate-700 text-slate-200 text-base font-medium hover:bg-slate-600"
            >
              Keep going
            </button>
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
    out_of_frame:    { title: 'Body Not Fully Visible', subtitle: 'Recording paused — step into the frame so all of you is visible' },
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

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

/**
 * Horizontal range bar showing the start zone (blue) and end zone (green) for
 * a joint, with a marker at the live angle. Falls back to a "—" readout when
 * the joint is briefly occluded.
 */
function JointAngleMeter({
  label,
  current,
  startMin,
  startMax,
  endMin,
  endMax,
}: {
  label: string
  current: number | null
  startMin: number
  startMax: number
  endMin: number
  endMax: number
}) {
  // Bar spans the union of both zones with a small pad so the marker has room
  // to travel even when the patient overshoots a target.
  const lo = Math.min(startMin, endMin)
  const hi = Math.max(startMax, endMax)
  const pad = Math.max(10, (hi - lo) * 0.15)
  const min = Math.max(0, Math.floor(lo - pad))
  const max = Math.min(180, Math.ceil(hi + pad))
  const span = Math.max(1, max - min)

  const pct = (v: number) => `${((Math.max(min, Math.min(max, v)) - min) / span) * 100}%`
  const inStart = current !== null && current >= startMin && current <= startMax
  const inEnd = current !== null && current >= endMin && current <= endMax
  const valueColor = inEnd
    ? 'text-emerald-400'
    : inStart
      ? 'text-sky-400'
      : current === null
        ? 'text-slate-500'
        : 'text-amber-300'

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-slate-300 text-xs font-medium">{label}</p>
        <p className={`text-2xl font-bold tabular-nums leading-none ${valueColor}`}>
          {current === null ? '—' : Math.round(current)}
          <span className="text-sm text-slate-400 font-normal ml-0.5">°</span>
        </p>
      </div>
      <div className="relative mt-1.5 h-2.5 rounded-full bg-slate-800 overflow-hidden">
        {/* Start zone */}
        <div
          className="absolute top-0 bottom-0 bg-sky-500/55"
          style={{ left: pct(startMin), width: `calc(${pct(startMax)} - ${pct(startMin)})` }}
        />
        {/* End zone (target) */}
        <div
          className="absolute top-0 bottom-0 bg-emerald-500/65"
          style={{ left: pct(endMin), width: `calc(${pct(endMax)} - ${pct(endMin)})` }}
        />
        {/* Live marker */}
        {current !== null && (
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-4 rounded-sm bg-white shadow-[0_0_4px_rgba(255,255,255,0.9)]"
            style={{ left: pct(current) }}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500 tabular-nums">
        <span>{min}°</span>
        <span className="text-sky-400">start {startMin}-{startMax}°</span>
        <span className="text-emerald-400">target {endMin}-{endMax}°</span>
        <span>{max}°</span>
      </div>
    </div>
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
