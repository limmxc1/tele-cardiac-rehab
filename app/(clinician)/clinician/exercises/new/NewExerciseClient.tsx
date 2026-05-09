'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store/auth'
import { createExerciseAction } from '@/app/actions/exercises'
import { getJointAngle } from '@/lib/pose/angles'

type Joint = 'knee' | 'hip' | 'shoulder' | 'elbow' | 'ankle'
type Side = 'left' | 'right' | 'both'
type Direction = 'flexion_first' | 'extension_first'
type DemoStatus = 'idle' | 'loading' | 'running' | 'stopped'

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

export default function NewExerciseClient() {
  const user = useAuthStore((s) => s.user)

  // Form fields
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [joint, setJoint] = useState<Joint>('knee')
  const [side, setSide] = useState<Side>('both')
  const [direction, setDirection] = useState<Direction>('flexion_first')
  const [gifFile, setGifFile] = useState<File | null>(null)

  // Threshold sliders
  const [startMin, setStartMin] = useState(80)
  const [startMax, setStartMax] = useState(100)
  const [endMin, setEndMin] = useState(155)
  const [endMax, setEndMax] = useState(175)

  // Demo state
  const [demoStatus, setDemoStatus] = useState<DemoStatus>('idle')
  const [currentAngle, setCurrentAngle] = useState<number | null>(null)
  const [histogramData, setHistogramData] = useState<number[]>(Array(BUCKETS).fill(0))

  // Save state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const poseLandmarkerRef = useRef<unknown>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef(0)
  const angleHistoryRef = useRef<number[]>([])
  const runningRef = useRef(false)
  const jointRef = useRef(joint)
  const sideRef = useRef(side)

  // Keep refs in sync so the rAF closure always reads the current joint/side
  useEffect(() => { jointRef.current = joint }, [joint])
  useEffect(() => { sideRef.current = side }, [side])

  const stopDemo = useCallback(() => {
    runningRef.current = false
    cancelAnimationFrame(animFrameRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(poseLandmarkerRef.current as any)?.close?.()
    poseLandmarkerRef.current = null
    setDemoStatus('stopped')

    // Auto-suggest thresholds from the P10/P90 of recorded angles
    const history = angleHistoryRef.current
    if (history.length > 10) {
      const sorted = [...history].sort((a, b) => a - b)
      const p10 = sorted[Math.floor(sorted.length * 0.1)]
      const p90 = sorted[Math.floor(sorted.length * 0.9)]
      const low = Math.round(p10)
      const high = Math.round(p90)
      setStartMin(Math.max(0, low - 8))
      setStartMax(Math.min(180, low + 8))
      setEndMin(Math.max(0, high - 8))
      setEndMax(Math.min(180, high + 8))
      // If the low zone came first historically, patient started flexed → extension_first
      const midPoint = history.length / 2
      const firstHalfMean = history.slice(0, midPoint).reduce((a, b) => a + b, 0) / midPoint
      setDirection(firstHalfMean < (low + high) / 2 ? 'extension_first' : 'flexion_first')
    }
  }, [])

  const startDemo = useCallback(async () => {
    setDemoStatus('loading')
    setError(null)
    angleHistoryRef.current = []
    setHistogramData(Array(BUCKETS).fill(0))
    setCurrentAngle(null)

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

            const angle = getJointAngle(lms, jointRef.current, sideRef.current)
            if (angle !== null) {
              const rounded = Math.round(angle)
              setCurrentAngle(rounded)
              angleHistoryRef.current.push(rounded)
              frameCount++
              if (frameCount % 20 === 0) {
                setHistogramData(buildHistogram(angleHistoryRef.current))
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
      let gifUrl: string | null = null

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
      }

      const result = await createExerciseAction({
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
        created_by: user?.id ?? null,
      })

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

  const totalSamples = angleHistoryRef.current.length
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
        <h1 className="text-lg font-semibold text-slate-800">New Exercise</h1>
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
          {gifFile && (
            <p className="text-xs text-slate-400">Selected: {gifFile.name}</p>
          )}
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
              {/* Hidden video element */}
              <video ref={videoRef} hidden playsInline muted />

              {demoStatus === 'running' && (
                <div className="relative">
                  <canvas
                    ref={canvasRef}
                    className="w-full rounded-xl bg-black"
                    style={{ maxHeight: 360 }}
                  />
                  {currentAngle !== null && (
                    <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-xl bg-black/60 px-5 py-2 text-4xl font-bold tabular-nums text-white">
                      {currentAngle}°
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
          {saving ? 'Saving…' : 'Save Exercise'}
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
