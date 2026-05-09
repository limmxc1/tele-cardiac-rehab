'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store/auth'
import { createExerciseAction, updateExerciseAction } from '@/app/actions/exercises'
import { getJointAngle } from '@/lib/pose/angles'
import { detectOrientation } from '@/lib/pose/orientationDetector'

type Joint = 'knee' | 'hip' | 'shoulder' | 'elbow' | 'ankle'
type Side = 'left' | 'right' | 'both'
type Direction = 'flexion_first' | 'extension_first'
type ViewOrientation = 'front' | 'side'
type DemoStatus = 'idle' | 'loading' | 'running' | 'stopped'

interface InitialValues {
  name: string
  instructions: string
  joint: Joint
  side: Side
  direction: Direction
  viewOrientation: ViewOrientation
  startMin: number
  startMax: number
  endMin: number
  endMax: number
  secondaryEnabled: boolean
  secondaryJoint: Joint
  secondaryStartMin: number
  secondaryStartMax: number
  secondaryEndMin: number
  secondaryEndMax: number
  existingGifUrl: string | null
}

const BUCKETS = 36
const BUCKET_DEG = 5

function buildHistogram(angles: number[]): number[] {
  const hist = Array<number>(BUCKETS).fill(0)
  for (const a of angles) {
    const b = Math.min(Math.floor(a / BUCKET_DEG), BUCKETS - 1)
    hist[b]++
  }
  return hist
}

interface Zone { min: number; max: number }
interface TunedThresholds {
  low: Zone
  high: Zone
  direction: Direction
}

/**
 * Pick start/end zones from a recorded angle history.
 *
 * Zones are intentionally generous (≈30° wide on the outer edge, ≈8° on the
 * inner edge) so a patient with slightly less ROM than the clinician still
 * registers reps. Without this, the rep state machine can wedge in
 * TRAVELING_TO_END forever the first time a patient undershoots.
 *
 * Direction is inferred from where the clinician rested at the very start
 * of the demo (first ≈1 s) rather than from a half-vs-half mean comparison
 * — the latter is unreliable when reps are uniform.
 */
function autoTuneZones(history: number[]): TunedThresholds | null {
  if (history.length < 30) return null
  const sorted = [...history].sort((a, b) => a - b)
  const lo = sorted[Math.floor(sorted.length * 0.05)]
  const hi = sorted[Math.floor(sorted.length * 0.95)]
  if (hi - lo < 10) return null

  const range = hi - lo
  const innerPad = Math.min(8, Math.max(3, Math.floor(range / 4)))
  const outerPad = 15

  const lowMin = Math.max(0,   Math.round(lo) - outerPad)
  let lowMax = Math.min(180, Math.round(lo) + innerPad)
  let highMin = Math.max(0,   Math.round(hi) - innerPad)
  const highMax = Math.min(180, Math.round(hi) + outerPad)

  // Defensive: keep the zones disjoint even on very short ROMs.
  if (lowMax >= highMin) {
    const mid = Math.round((lo + hi) / 2)
    lowMax = Math.min(lowMax, mid - 1)
    highMin = Math.max(highMin, mid + 1)
  }

  const restWindowSize = Math.min(30, Math.floor(history.length / 4))
  const restWindow = history.slice(0, Math.max(1, restWindowSize))
  const restMean = restWindow.reduce((a, b) => a + b, 0) / restWindow.length
  const direction: Direction =
    Math.abs(restMean - lo) < Math.abs(restMean - hi)
      ? 'extension_first'
      : 'flexion_first'

  return {
    low:  { min: lowMin,  max: lowMax  },
    high: { min: highMin, max: highMax },
    direction,
  }
}

export default function NewExerciseClient({
  exerciseId,
  initial,
}: {
  exerciseId?: string
  initial?: InitialValues
}) {
  const mode = exerciseId ? 'edit' : 'create'
  const user = useAuthStore((s) => s.user)

  // Form fields
  const [name, setName] = useState(initial?.name ?? '')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const [joint, setJoint] = useState<Joint>(initial?.joint ?? 'knee')
  const [side, setSide] = useState<Side>(initial?.side ?? 'both')
  // Default 'extension_first' matches the default zone values (start 80–100° flexed,
  // end 155–175° extended). The previous 'flexion_first' default contradicted them.
  const [direction, setDirection] = useState<Direction>(initial?.direction ?? 'extension_first')
  const [viewOrientation, setViewOrientation] = useState<ViewOrientation>(initial?.viewOrientation ?? 'front')
  const [gifFile, setGifFile] = useState<File | null>(null)
  const [existingGifUrl, setExistingGifUrl] = useState<string | null>(initial?.existingGifUrl ?? null)

  // Threshold sliders
  const [startMin, setStartMin] = useState(initial?.startMin ?? 80)
  const [startMax, setStartMax] = useState(initial?.startMax ?? 100)
  const [endMin, setEndMin] = useState(initial?.endMin ?? 155)
  const [endMax, setEndMax] = useState(initial?.endMax ?? 175)

  // Secondary joint (optional co-constraint)
  const [secondaryEnabled, setSecondaryEnabled] = useState(initial?.secondaryEnabled ?? false)
  const [secondaryJoint, setSecondaryJoint] = useState<Joint>(initial?.secondaryJoint ?? 'hip')
  const [secondaryStartMin, setSecondaryStartMin] = useState(initial?.secondaryStartMin ?? 80)
  const [secondaryStartMax, setSecondaryStartMax] = useState(initial?.secondaryStartMax ?? 100)
  const [secondaryEndMin, setSecondaryEndMin] = useState(initial?.secondaryEndMin ?? 150)
  const [secondaryEndMax, setSecondaryEndMax] = useState(initial?.secondaryEndMax ?? 180)

  // Demo state
  const [demoStatus, setDemoStatus] = useState<DemoStatus>('idle')
  const [currentAngle, setCurrentAngle] = useState<number | null>(null)
  const [secondaryCurrentAngle, setSecondaryCurrentAngle] = useState<number | null>(null)
  const [histogramData, setHistogramData] = useState<number[]>(Array(BUCKETS).fill(0))
  const [totalSamples, setTotalSamples] = useState(0)

  // Save state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orientationWarning, setOrientationWarning] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const poseLandmarkerRef = useRef<unknown>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef(0)
  const angleHistoryRef = useRef<number[]>([])
  const secondaryAngleHistoryRef = useRef<number[]>([])
  const runningRef = useRef(false)
  const jointRef = useRef(joint)
  const sideRef = useRef(side)
  const secondaryJointRef = useRef(secondaryJoint)
  const secondaryEnabledRef = useRef(secondaryEnabled)
  const viewOrientationRef = useRef(viewOrientation)
  const mismatchStreakRef = useRef(0)
  const orientationWarnedRef = useRef(false)

  // Keep refs in sync so the rAF closure always reads the current joint/side
  useEffect(() => { jointRef.current = joint }, [joint])
  useEffect(() => { sideRef.current = side }, [side])
  useEffect(() => { secondaryJointRef.current = secondaryJoint }, [secondaryJoint])
  useEffect(() => { secondaryEnabledRef.current = secondaryEnabled }, [secondaryEnabled])
  useEffect(() => { viewOrientationRef.current = viewOrientation }, [viewOrientation])

  const stopDemo = useCallback(() => {
    runningRef.current = false
    cancelAnimationFrame(animFrameRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(poseLandmarkerRef.current as any)?.close?.()
    poseLandmarkerRef.current = null
    setDemoStatus('stopped')
    // Flush final sample count + histogram so the UI reflects the full demo.
    setTotalSamples(angleHistoryRef.current.length)
    setHistogramData(buildHistogram(angleHistoryRef.current))

    // Auto-suggest thresholds from the demo. Direction is inferred from the
    // patient's resting position at the start of the recording (first ≈1 s);
    // start/end zone roles are then assigned by direction so the rep state
    // machine sees a consistent picture.
    const tuned = autoTuneZones(angleHistoryRef.current)
    if (tuned) {
      setDirection(tuned.direction)
      const startZone = tuned.direction === 'extension_first' ? tuned.low : tuned.high
      const endZone   = tuned.direction === 'extension_first' ? tuned.high : tuned.low
      setStartMin(startZone.min); setStartMax(startZone.max)
      setEndMin(endZone.min);     setEndMax(endZone.max)

      // Tune the secondary joint zones the same way. If we left them at form
      // defaults, RepDetector.feed() (which now enforces the secondary zones)
      // would silently kill rep detection.
      if (secondaryEnabledRef.current) {
        const secTuned = autoTuneZones(secondaryAngleHistoryRef.current)
        if (secTuned) {
          const secStart = tuned.direction === 'extension_first' ? secTuned.low : secTuned.high
          const secEnd   = tuned.direction === 'extension_first' ? secTuned.high : secTuned.low
          setSecondaryStartMin(secStart.min); setSecondaryStartMax(secStart.max)
          setSecondaryEndMin(secEnd.min);     setSecondaryEndMax(secEnd.max)
        }
      }
    }
  }, [])

  const startDemo = useCallback(async () => {
    setDemoStatus('loading')
    setError(null)
    angleHistoryRef.current = []
    secondaryAngleHistoryRef.current = []
    mismatchStreakRef.current = 0
    orientationWarnedRef.current = false
    setHistogramData(Array(BUCKETS).fill(0))
    setTotalSamples(0)
    setCurrentAngle(null)
    setSecondaryCurrentAngle(null)
    setOrientationWarning(false)

    try {
      const { PoseLandmarker, FilesetResolver, DrawingUtils } =
        await import('@mediapipe/tasks-vision')

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
      )
      const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
      poseLandmarkerRef.current = poseLandmarker

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      })
      streamRef.current = stream

      const video = videoRef.current!
      video.srcObject = stream
      await video.play()

      runningRef.current = true
      setDemoStatus('running')

      let lastTs = -1
      let frameCount = 0

      function detectFrame(ts: number) {
        if (!runningRef.current) return
        if (video.readyState < 2) {
          animFrameRef.current = requestAnimationFrame(detectFrame)
          return
        }

        const canvas = canvasRef.current!
        const ctx = canvas.getContext('2d')!

        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth || 640
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight || 480

        if (ts !== lastTs) {
          lastTs = ts
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const results = (poseLandmarkerRef.current as any).detectForVideo(video, ts)

          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

          if (results.landmarks.length > 0) {
            const lms = results.landmarks[0]
            const drawingUtils = new DrawingUtils(ctx)
            drawingUtils.drawLandmarks(lms, { color: '#ef4444', lineWidth: 2, radius: 4 })
            drawingUtils.drawConnectors(lms, PoseLandmarker.POSE_CONNECTIONS, {
              color: '#22c55e',
              lineWidth: 2,
            })

            // Only record into the histogram while the clinician is in the
            // orientation the patient will use — angles measured from the
            // wrong view don't transfer cleanly. Live HUD still updates
            // either way so the clinician sees feedback.
            const detected = detectOrientation(lms)
            const orientationOk =
              detected === null || detected === viewOrientationRef.current

            const angle = getJointAngle(lms, jointRef.current, sideRef.current)
            if (angle !== null) {
              const rounded = Math.round(angle)
              setCurrentAngle(rounded)
              if (orientationOk) {
                angleHistoryRef.current.push(rounded)
                frameCount++
                if (frameCount % 20 === 0) {
                  setHistogramData(buildHistogram(angleHistoryRef.current))
                  setTotalSamples(angleHistoryRef.current.length)
                }
              }
            }

            if (secondaryEnabledRef.current) {
              const sec = getJointAngle(lms, secondaryJointRef.current, sideRef.current)
              if (sec === null) {
                setSecondaryCurrentAngle(null)
              } else {
                const secRounded = Math.round(sec)
                setSecondaryCurrentAngle(secRounded)
                if (orientationOk) secondaryAngleHistoryRef.current.push(secRounded)
              }
            }

            // Debounced sustained-mismatch banner. Single-frame flickers
            // shouldn't toggle the warning.
            if (orientationOk) {
              mismatchStreakRef.current = 0
              if (orientationWarnedRef.current) {
                orientationWarnedRef.current = false
                setOrientationWarning(false)
              }
            } else {
              mismatchStreakRef.current++
              if (mismatchStreakRef.current >= 30 && !orientationWarnedRef.current) {
                orientationWarnedRef.current = true
                setOrientationWarning(true)
              }
            }
          }
        }

        animFrameRef.current = requestAnimationFrame(detectFrame)
      }

      animFrameRef.current = requestAnimationFrame(detectFrame)
    } catch (e) {
      console.error('Demo failed:', e)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      setDemoStatus('idle')
      setError('Could not start camera or load pose detection. Check camera permissions.')
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      runningRef.current = false
      cancelAnimationFrame(animFrameRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function handleSave() {
    if (!name.trim()) {
      setError('Exercise name is required')
      return
    }
    setSaving(true)
    setError(null)

    try {
      let gifUrl: string | null = existingGifUrl

      if (gifFile) {
        const safeName = gifFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${Date.now()}_${safeName}`
        const { error: uploadErr } = await supabase.storage
          .from('reference-gifs')
          .upload(path, gifFile, { contentType: gifFile.type })

        if (uploadErr) {
          setError(`GIF upload failed: ${uploadErr.message}`)
          setSaving(false)
          return
        }
        const { data: { publicUrl } } = supabase.storage
          .from('reference-gifs')
          .getPublicUrl(path)
        gifUrl = publicUrl
        setExistingGifUrl(publicUrl)
      }

      const payload = {
        name: name.trim(),
        instructions_text: instructions.trim() || null,
        reference_gif_url: gifUrl,
        primary_joint: joint,
        primary_side: side,
        start_angle_min: startMin,
        start_angle_max: startMax,
        end_angle_min: endMin,
        end_angle_max: endMax,
        direction,
        secondary_joint: secondaryEnabled ? secondaryJoint : null,
        secondary_start_min: secondaryEnabled ? secondaryStartMin : null,
        secondary_start_max: secondaryEnabled ? secondaryStartMax : null,
        secondary_end_min: secondaryEnabled ? secondaryEndMin : null,
        secondary_end_max: secondaryEnabled ? secondaryEndMax : null,
        view_orientation: viewOrientation,
      }

      const result = mode === 'edit' && exerciseId
        ? await updateExerciseAction(exerciseId, payload)
        : await createExerciseAction({ ...payload, created_by: user?.id ?? null })

      if (result?.error) {
        setError(result.error)
        setSaving(false)
      }
      // on success the server action redirects
    } catch {
      setError('Failed to save exercise')
      setSaving(false)
    }
  }

  const hasHistData = histogramData.some((v) => v > 0)
  const maxCount = Math.max(...histogramData, 1)

  const startMinBucket = Math.floor(startMin / BUCKET_DEG)
  const startMaxBucket = Math.floor(startMax / BUCKET_DEG)
  const endMinBucket = Math.floor(endMin / BUCKET_DEG)
  const endMaxBucket = Math.floor(endMax / BUCKET_DEG)

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/clinician/exercises" className="text-sm text-slate-400 hover:text-slate-600">
          ← Library
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">
          {mode === 'edit' ? 'Edit Exercise' : 'New Exercise'}
        </h1>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 p-6">
        {/* Name */}
        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700">Exercise Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sit to Stand"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {/* Instructions */}
        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700">
            Instructions <span className="text-slate-400">(optional)</span>
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder="Step-by-step guidance for the patient…"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {/* Reference GIF */}
        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700">
            Reference GIF <span className="text-slate-400">(optional)</span>
          </label>
          <input
            type="file"
            accept="image/gif,image/*"
            onChange={(e) => setGifFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1 file:text-sm file:font-medium file:text-blue-700"
          />
          {gifFile ? (
            <p className="text-xs text-slate-400">Selected: {gifFile.name}</p>
          ) : existingGifUrl ? (
            <div className="mt-2 flex items-center gap-3">
              <img src={existingGifUrl} alt="Current reference" className="h-16 rounded-lg object-cover" />
              <div>
                <p className="text-xs text-slate-500">Current reference GIF</p>
                <button
                  type="button"
                  onClick={() => setExistingGifUrl(null)}
                  className="text-xs text-rose-500 hover:text-rose-700"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Joint + Side */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">Primary Joint *</label>
            <select
              value={joint}
              disabled={demoStatus === 'running'}
              onChange={(e) => setJoint(e.target.value as Joint)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-800 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="knee">Knee</option>
              <option value="hip">Hip</option>
              <option value="shoulder">Shoulder</option>
              <option value="elbow">Elbow</option>
              <option value="ankle">Ankle</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">Side *</label>
            <select
              value={side}
              disabled={demoStatus === 'running'}
              onChange={(e) => setSide(e.target.value as Side)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-800 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="both">Both</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>

        {/* Camera orientation requirement */}
        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700">Patient view orientation *</label>
          <div className="grid grid-cols-2 gap-2">
            {(['front', 'side'] as const).map((opt) => {
              const active = viewOrientation === opt
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setViewOrientation(opt)}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-semibold capitalize">{opt} view</div>
                  <div className="text-[11px] text-slate-500">
                    {opt === 'front'
                      ? 'Patient faces the camera (e.g. squats, sit-to-stand).'
                      : 'Patient stands sideways (e.g. arm raise, bicep curl).'}
                  </div>
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-slate-400">
            The session won&apos;t start until the patient is in this orientation.
          </p>
        </div>

        {/* Always mount the video element so videoRef is available before demo starts */}
        <video ref={videoRef} className="hidden" playsInline muted />

        {/* Demo Mode */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-800">Demo Mode</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Perform 5–10 reps in front of the camera to auto-set angle thresholds.
              </p>
            </div>
            {demoStatus === 'idle' && (
              <button
                onClick={startDemo}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Start Demo
              </button>
            )}
            {demoStatus === 'stopped' && (
              <button
                onClick={startDemo}
                className="rounded-xl border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50"
              >
                Redo Demo
              </button>
            )}
          </div>

          {demoStatus === 'loading' && (
            <p className="text-sm text-slate-500 animate-pulse">
              Loading pose detection model…
            </p>
          )}

          {/* Camera + stickman canvas */}
          {(demoStatus === 'running' || demoStatus === 'stopped') && (
            <div className="space-y-3">
              {demoStatus === 'running' && (
                <div className="relative">
                  <canvas
                    ref={canvasRef}
                    className="w-full rounded-xl bg-black"
                    style={{ maxHeight: 360 }}
                  />
                  {currentAngle !== null && (
                    <div className="absolute left-1/2 top-3 -translate-x-1/2 flex items-center gap-3 rounded-xl bg-black/60 px-5 py-2 text-white">
                      <div className="flex items-baseline gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-slate-300">
                          {joint}
                        </span>
                        <span className="text-3xl font-bold tabular-nums">{currentAngle}°</span>
                      </div>
                      {secondaryEnabled && (
                        <div className="flex items-baseline gap-1 border-l border-white/30 pl-3">
                          <span className="text-[10px] uppercase tracking-wide text-slate-300">
                            {secondaryJoint}
                          </span>
                          <span className="text-3xl font-bold tabular-nums">
                            {secondaryCurrentAngle ?? '—'}°
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {orientationWarning && (
                    <div className="absolute bottom-3 left-3 max-w-[220px] rounded-lg bg-amber-500/95 px-3 py-2 text-xs font-medium text-white shadow">
                      Stand {viewOrientation === 'side' ? 'sideways to' : 'facing'} the camera —
                      frames are not being recorded.
                    </div>
                  )}
                  <button
                    onClick={stopDemo}
                    className="absolute bottom-3 right-3 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    Stop
                  </button>
                </div>
              )}

              {demoStatus === 'stopped' && (
                <p className="text-sm text-slate-500">
                  Demo complete — {totalSamples} angle samples recorded.
                  Adjust the sliders below if needed.
                </p>
              )}

              {/* Histogram */}
              {hasHistData && (
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-500">
                    Angle distribution — blue = start zone, red = end zone
                  </p>
                  <svg
                    viewBox={`0 0 ${BUCKETS * 12} 80`}
                    className="w-full rounded-lg bg-slate-50"
                    preserveAspectRatio="none"
                  >
                    {histogramData.map((count, i) => {
                      const h = count > 0 ? Math.max(2, (count / maxCount) * 72) : 0
                      const isStart = i >= startMinBucket && i <= startMaxBucket
                      const isEnd = i >= endMinBucket && i <= endMaxBucket
                      const fill = isStart
                        ? '#3b82f6'
                        : isEnd
                        ? '#ef4444'
                        : '#94a3b8'
                      return (
                        <rect
                          key={i}
                          x={i * 12 + 1}
                          y={80 - h}
                          width={10}
                          height={h}
                          fill={fill}
                          rx={2}
                        />
                      )
                    })}
                  </svg>
                  <div className="mt-1 flex justify-between text-xs text-slate-400">
                    <span>0°</span>
                    <span>90°</span>
                    <span>180°</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Threshold Sliders */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
          <h2 className="font-semibold text-slate-800">Angle Thresholds</h2>

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-blue-600">
              Start position (rest / beginning of rep)
            </p>
            <SliderRow
              label="Min"
              value={startMin}
              onChange={(v) => setStartMin(Math.min(v, startMax - 1))}
            />
            <SliderRow
              label="Max"
              value={startMax}
              onChange={(v) => setStartMax(Math.max(v, startMin + 1))}
            />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-red-500">
              End position (peak of movement)
            </p>
            <SliderRow
              label="Min"
              value={endMin}
              onChange={(v) => setEndMin(Math.min(v, endMax - 1))}
            />
            <SliderRow
              label="Max"
              value={endMax}
              onChange={(v) => setEndMax(Math.max(v, endMin + 1))}
            />
          </div>
        </section>

        {/* Secondary joint co-constraint */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-800">Secondary Joint Focus</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Optional. Both joints must be in their target zones for a rep to count
                (e.g. squat: knee + hip).
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={secondaryEnabled}
                onChange={(e) => setSecondaryEnabled(e.target.checked)}
                className="h-4 w-4 accent-blue-600"
              />
              <span className={secondaryEnabled ? 'text-slate-700' : 'text-slate-400'}>
                Enable
              </span>
            </label>
          </div>

          {secondaryEnabled && (
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-700">Secondary Joint</label>
                <select
                  value={secondaryJoint}
                  disabled={demoStatus === 'running'}
                  onChange={(e) => setSecondaryJoint(e.target.value as Joint)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-800 outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="knee">Knee</option>
                  <option value="hip">Hip</option>
                  <option value="shoulder">Shoulder</option>
                  <option value="elbow">Elbow</option>
                  <option value="ankle">Ankle</option>
                </select>
                <p className="text-[11px] text-slate-400">
                  Side reuses the primary side ({side}).
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-blue-600">
                  Secondary start position
                </p>
                <SliderRow
                  label="Min"
                  value={secondaryStartMin}
                  onChange={(v) => setSecondaryStartMin(Math.min(v, secondaryStartMax - 1))}
                />
                <SliderRow
                  label="Max"
                  value={secondaryStartMax}
                  onChange={(v) => setSecondaryStartMax(Math.max(v, secondaryStartMin + 1))}
                />
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-red-500">
                  Secondary end position
                </p>
                <SliderRow
                  label="Min"
                  value={secondaryEndMin}
                  onChange={(v) => setSecondaryEndMin(Math.min(v, secondaryEndMax - 1))}
                />
                <SliderRow
                  label="Max"
                  value={secondaryEndMax}
                  onChange={(v) => setSecondaryEndMax(Math.max(v, secondaryEndMin + 1))}
                />
              </div>
            </div>
          )}
        </section>

        {/* Direction */}
        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700">Direction</label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-800 outline-none focus:border-blue-500"
          >
            <option value="flexion_first">Flexion first — start extended, flex toward peak</option>
            <option value="extension_first">Extension first — start flexed, extend toward peak</option>
          </select>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white disabled:opacity-50 hover:bg-blue-700 active:bg-blue-800"
        >
          {saving ? 'Saving…' : mode === 'edit' ? 'Save Changes' : 'Save Exercise'}
        </button>
      </main>
    </div>
  )
}

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 text-xs text-slate-500">{label}</span>
      <input
        type="range"
        min={0}
        max={180}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-blue-600"
      />
      <span className="w-12 text-right text-sm font-medium tabular-nums text-slate-700">
        {value}°
      </span>
    </div>
  )
}
