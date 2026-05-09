'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { PolarH10, type H10Status } from '@/lib/hr/polarH10'
import {
  SessionStateMachine,
  type ExerciseEntry,
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
  exercise: ExerciseEntry
  setNumber: number
}

type UploadState = 'idle' | 'uploading' | 'uploaded' | 'failed'

export default function SessionRunClient({
  prescriptionId,
  patientId,
  hrLimit,
  exercise,
  setNumber,
}: Props) {
  const router = useRouter()
  const smRef = useRef<SessionStateMachine | null>(null)
  const h10Ref = useRef<PolarH10 | null>(null)

  const sessionIdRef = useRef<string | null>(null)
  const clockBasePerfRef = useRef<number>(0)
  const clockBaseWallRef = useRef<number>(0)
  const sessionStartedAtWallRef = useRef<number>(0)
  const setIdRef = useRef<string | null>(null)
  const sessionEndedRef = useRef(false)
  const uploadKickedRef = useRef(false)
  const [resumable, setResumable] = useState<{ sessionId: string; startedAtMs: number } | null>(null)

  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const toWall = useCallback((perfMs: number) => {
    return clockBaseWallRef.current + (perfMs - clockBasePerfRef.current)
  }, [])

  const [snap, setSnap] = useState<SessionSnapshot>(() => ({
    phase: 'IDLE',
    exercise,
    fullyInFrame: false,
    oposeProgress: 0,
    tposeProgress: 0,
    hrBpm: null,
  }))
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const [h10Status, setH10Status] = useState<H10Status>('idle')
  const [h10Error, setH10Error] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<{ kind: 'denied' | 'unavailable' | 'unknown'; message: string } | null>(null)
  const [cameraRetryKey, setCameraRetryKey] = useState(0)
  const [mutedUI, setMutedUI] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : isMuted(),
  )

  const phaseRef = useRef<SessionSnapshot['phase']>('IDLE')
  useEffect(() => { phaseRef.current = snap.phase }, [snap.phase])

  useEffect(() => {
    const events: SessionEvents = {
      onRecordingStart: ({ ts_ms }) => {
        const sessionId = sessionIdRef.current
        if (!sessionId) return
        if (setIdRef.current) return
        const setId = crypto.randomUUID()
        setIdRef.current = setId
        void recordSetStart({
          setId,
          sessionId,
          prescriptionItemId: exercise.prescriptionItemId,
          exerciseId: exercise.exerciseId,
          setNumber,
          startedAtMs: toWall(ts_ms),
        })
      },
      onRecordingEnd: ({ ts_ms, reason }) => {
        const setId = setIdRef.current
        if (!setId) return
        void recordSetComplete({
          setId,
          completedAtMs: toWall(ts_ms),
          endedReason: reason,
        })
      },
      onSessionEnd: ({ ts_ms }) => {
        const sessionId = sessionIdRef.current
        if (!sessionId || sessionEndedRef.current) return
        sessionEndedRef.current = true
        void markSessionComplete(sessionId, toWall(ts_ms), 'completed')
      },
    }
    const sm = new SessionStateMachine(exercise, setSnap, events)
    smRef.current = sm
    return () => { sm.destroy(); smRef.current = null }
  }, [exercise, setNumber, toWall])

  // Kick off upload on COMPLETE.
  useEffect(() => {
    if (snap.phase !== 'COMPLETE') return
    if (uploadKickedRef.current) return
    uploadKickedRef.current = true

    const sessionId = sessionIdRef.current
    if (!sessionId) {
      const t = setTimeout(() => router.push('/patient/calendar'), 2000)
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
      }
    })()
    return () => { cancelled = true }
  }, [snap.phase, router])

  const latestLmRef = useRef<NormalizedLandmark[] | null>(null)

  const handlePose = useCallback((poses: NormalizedLandmark[][], timestamp_ms: number) => {
    const sm = smRef.current
    if (!sm) return
    const first = poses[0]
    latestLmRef.current = first ?? null
    if (!first) return
    sm.feedPose(first, timestamp_ms)

    // Save full-body pose frames only while RECORDING. No "fully in frame"
    // gate — the user asked for no auto-pauses, so partial frames just become
    // gaps in the timeline (low-visibility landmarks come through as the
    // model's best-guess coords).
    const sessionId = sessionIdRef.current
    if (sessionId && phaseRef.current === 'RECORDING') {
      const wallMs = toWall(timestamp_ms)
      void recordPoseFrame(
        sessionId,
        wallMs,
        first,
        sessionStartedAtWallRef.current,
      )
    }
  }, [toWall])

  const handleConnectH10 = useCallback(async () => {
    setH10Error(null)
    const h10 = new PolarH10()
    h10Ref.current = h10
    h10.onStatus((status) => {
      setH10Status(status)
    })
    h10.onHR((s) => {
      smRef.current?.feedHR(s.hr_bpm)
      const sessionId = sessionIdRef.current
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
    void abandonStaleSessionsFor(patientId, prescriptionId)
      .then(() => startSession({ sessionId, prescriptionId, patientId, startedAtMs: wall }))
      .then(() => smRef.current?.start())
  }, [prescriptionId, patientId])

  const handleResume = useCallback(() => {
    if (!resumable || sessionIdRef.current) return
    sessionIdRef.current = resumable.sessionId
    clockBaseWallRef.current = Date.now()
    clockBasePerfRef.current = performance.now()
    sessionStartedAtWallRef.current = resumable.startedAtMs
    setResumable(null)
    smRef.current?.start()
  }, [resumable])

  const handleDiscardResumable = useCallback(() => {
    void abandonStaleSessionsFor(patientId, prescriptionId)
    setResumable(null)
  }, [patientId, prescriptionId])

  useEffect(() => {
    let cancelled = false
    void findResumableSession(patientId, prescriptionId).then((r) => {
      if (cancelled || !r) return
      setResumable({ sessionId: r.sessionId, startedAtMs: r.startedAtMs })
    })
    return () => { cancelled = true }
  }, [patientId, prescriptionId])

  useEffect(() => {
    const handler = () => {
      const sessionId = sessionIdRef.current
      if (!sessionId || sessionEndedRef.current) return
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
    smRef.current?.endRecordingEarly()
  }, [])

  const handleCameraRetry = useCallback(() => {
    setCameraError(null)
    setCameraRetryKey((k) => k + 1)
  }, [])

  const { phase } = snap

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden select-none flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2.5 z-10">
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-base leading-tight truncate">
            {snap.exercise.exerciseName}
          </p>
          <p className="text-slate-400 text-xs">{snap.exercise.guidance}</p>
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
        {phase === 'RECORDING' && (
          <button
            onClick={() => setConfirmingEnd(true)}
            className="rounded-lg bg-rose-600/90 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-600"
          >
            End recording
          </button>
        )}
      </div>

      {/* Body — 2 columns: camera left, status right */}
      <div className="flex-1 grid grid-cols-2 gap-3 p-3 min-h-0">
        <div className="relative rounded-xl overflow-hidden bg-black">
          <CameraStickman
            key={cameraRetryKey}
            className="w-full h-full"
            onPose={handlePose}
            onCameraError={(kind, message) => setCameraError({ kind, message })}
          />
        </div>

        <div className="flex flex-col gap-3 min-h-0">
          <div className="rounded-xl bg-slate-900 px-6 py-4 flex items-center justify-center">
            <HRRing hrBpm={snap.hrBpm} hrLimit={hrLimit} size={140} />
          </div>

          <div className="rounded-xl bg-slate-900 px-4 py-3">
            <p className="text-slate-300 text-xs uppercase tracking-wide mb-1.5">Joints recorded</p>
            {snap.exercise.trackedJoints.length === 0 ? (
              <p className="text-amber-300 text-sm">No joints configured for this exercise.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {snap.exercise.trackedJoints.map((t) => (
                  <span
                    key={`${t.side}_${t.joint}`}
                    className="rounded-full bg-blue-900/50 px-2.5 py-0.5 text-xs font-medium text-blue-200 capitalize"
                  >
                    {t.side} {t.joint}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 rounded-xl overflow-hidden bg-slate-900 min-h-0 relative">
            <LiveStickman landmarksRef={latestLmRef} />
            {phase === 'RECORDING' && snap.tposeProgress > 0 && (
              <div className="absolute bottom-3 right-3">
                <HoldRing progress={snap.tposeProgress} label="Hold T-pose" color="#22c55e" />
              </div>
            )}
            {phase === 'RECORDING' && (
              <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                Recording
              </div>
            )}
          </div>

          {phase === 'RECORDING' && snap.exercise.referenceGifUrl && (
            <div className="self-end w-28 h-28 rounded-xl overflow-hidden border border-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={snap.exercise.referenceGifUrl}
                alt="Reference"
                className="w-full h-full object-cover"
              />
            </div>
          )}
        </div>
      </div>

      {/* Camera error blocker */}
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

      {/* ── Phase overlays ── */}

      {phase === 'IDLE' && resumable && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-black/75 px-6">
          <p className="text-3xl">↺</p>
          <p className="text-white text-2xl font-bold text-center">Resume previous recording?</p>
          <p className="text-slate-300 text-sm text-center max-w-xs">
            We found an unfinished recording from{' '}
            {new Date(resumable.startedAtMs).toLocaleString('en-SG', {
              hour: '2-digit',
              minute: '2-digit',
              day: 'numeric',
              month: 'short',
            })}
            .
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
          <div className="text-center px-6 max-w-md">
            <p className="text-white text-2xl font-bold">{snap.exercise.exerciseName}</p>
            <p className="text-slate-300 text-sm mt-1">{snap.exercise.guidance}</p>
            {snap.exercise.instructionsText && (
              <p className="text-slate-400 text-sm mt-3 whitespace-pre-line">
                {snap.exercise.instructionsText}
              </p>
            )}
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
          <p className="text-slate-500 text-xs text-center max-w-sm">
            Make a circle above your head with both hands to start recording. Hold a T-pose to end.
          </p>
        </div>
      )}

      {phase === 'READY' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="bg-black/80 rounded-3xl px-10 py-8 text-center max-w-md flex flex-col items-center gap-4">
            <p className="text-slate-300 text-xs uppercase tracking-widest">Get Ready</p>
            <p className="text-white text-2xl font-bold">{snap.exercise.exerciseName}</p>
            {!snap.fullyInFrame ? (
              <p className="text-amber-300 text-base font-medium">Step fully into the frame</p>
            ) : (
              <>
                <p className="text-emerald-300 text-base font-medium">
                  Make an &quot;O&quot; above your head with both hands
                </p>
                <HoldRing
                  progress={snap.oposeProgress}
                  label={snap.oposeProgress > 0 ? 'Hold…' : 'Show O-pose'}
                  color="#3b82f6"
                />
              </>
            )}
          </div>
        </div>
      )}

      {confirmingEnd && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/90 px-6 text-center">
          <p className="text-3xl">⚠️</p>
          <p className="text-white text-2xl font-bold">End the recording now?</p>
          <p className="text-slate-300 text-sm max-w-sm">
            We&apos;ll save what you&apos;ve recorded so far.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleConfirmEnd}
              className="px-6 py-3 rounded-xl bg-rose-600 text-white text-base font-semibold hover:bg-rose-500"
            >
              Yes, end recording
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

      {phase === 'COMPLETE' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/90 px-6">
          <p className="text-green-400 text-4xl font-bold text-center">Recording Saved</p>
          {uploadState === 'uploading' && (
            <p className="text-slate-300 text-base">Uploading session data…</p>
          )}
          {uploadState === 'uploaded' && (
            <p className="text-slate-300 text-base">Saved. Returning to calendar…</p>
          )}
          {uploadState === 'failed' && (
            <div className="flex flex-col items-center gap-3 max-w-sm">
              <p className="text-amber-300 text-sm text-center">
                Upload failed. Your recording is saved on this device and will retry next time you open the app.
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

function HoldRing({
  progress,
  label,
  color,
}: {
  progress: number
  label: string
  color: string
}) {
  const size = 120
  const r = size / 2 - 8
  const circ = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#374151" strokeWidth={8} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - Math.min(1, progress))}
          strokeLinecap="round"
        />
      </svg>
      <p className="text-slate-200 text-xs">{label}</p>
    </div>
  )
}
