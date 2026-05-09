'use client'

import { useEffect, useRef, useCallback } from 'react'
import type { WorkerInMsg, WorkerOutMsg } from '@/lib/pose/poseWorker'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// MediaPipe 33-point skeleton — key body connections only (skip face/fingers)
const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], // shoulders
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [11, 23], [12, 24], [23, 24], // torso
  [23, 25], [25, 27], [27, 29], [27, 31], // left leg + foot
  [24, 26], [26, 28], [28, 30], [28, 32], // right leg + foot
]

const PERSON_COLORS = ['#22c55e', '#f97316'] // green (ok), orange (extra person)

const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm`
const MODEL_URL = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`

function drawStickman(
  canvas: HTMLCanvasElement,
  poses: NormalizedLandmark[][],
) {
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) return
  ctx2d.clearRect(0, 0, canvas.width, canvas.height)

  for (let pi = 0; pi < poses.length; pi++) {
    const landmarks = poses[pi]
    const color = PERSON_COLORS[pi] ?? '#ffffff'

    ctx2d.strokeStyle = color
    ctx2d.lineWidth = 3
    ctx2d.lineJoin = 'round'

    for (const [a, b] of POSE_CONNECTIONS) {
      const lmA = landmarks[a]
      const lmB = landmarks[b]
      if (!lmA || !lmB) continue
      ctx2d.beginPath()
      ctx2d.moveTo(lmA.x * canvas.width, lmA.y * canvas.height)
      ctx2d.lineTo(lmB.x * canvas.width, lmB.y * canvas.height)
      ctx2d.stroke()
    }

    ctx2d.fillStyle = color
    for (const lm of landmarks) {
      if (!lm) continue
      ctx2d.beginPath()
      ctx2d.arc(lm.x * canvas.width, lm.y * canvas.height, 4, 0, Math.PI * 2)
      ctx2d.fill()
    }
  }
}

interface Props {
  onPersonCount?: (count: number) => void
  onWorkerStatus?: (status: 'loading' | 'ready' | 'error') => void
  className?: string
}

export default function CameraStickman({ onPersonCount, onWorkerStatus, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const workerReadyRef = useRef(false)
  const workerBusyRef = useRef(false)
  const rafRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  const sendFrame = useCallback(() => {
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || video.readyState < 2 || !workerReadyRef.current || workerBusyRef.current) {
      rafRef.current = requestAnimationFrame(sendFrame)
      return
    }

    const w = video.videoWidth
    const h = video.videoHeight
    if (w === 0 || h === 0) {
      rafRef.current = requestAnimationFrame(sendFrame)
      return
    }

    if (overlay && (overlay.width !== w || overlay.height !== h)) {
      overlay.width = w
      overlay.height = h
    }

    createImageBitmap(video).then((bitmap) => {
      if (!workerRef.current) { bitmap.close(); return }
      workerBusyRef.current = true
      const msg: WorkerInMsg = { type: 'FRAME', bitmap, timestamp_ms: performance.now() }
      workerRef.current.postMessage(msg, [bitmap])
    }).catch(() => {})

    rafRef.current = requestAnimationFrame(sendFrame)
  }, [])

  useEffect(() => {
    let cancelled = false

    const worker = new Worker(
      new URL('../../lib/pose/poseWorker.ts', import.meta.url),
    )
    workerRef.current = worker
    onWorkerStatus?.('loading')

    worker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
      const msg = e.data
      if (msg.type === 'READY') {
        workerReadyRef.current = true
        onWorkerStatus?.('ready')
      } else if (msg.type === 'RESULT') {
        workerBusyRef.current = false
        onPersonCount?.(msg.poses.length)
        if (overlayRef.current) drawStickman(overlayRef.current, msg.poses)
      } else if (msg.type === 'ERROR') {
        onWorkerStatus?.('error')
        console.error('[poseWorker]', msg.message)
      }
    }

    const initMsg: WorkerInMsg = { type: 'INIT', wasmUrl: WASM_URL, modelUrl: MODEL_URL }
    worker.postMessage(initMsg)

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
      }
      rafRef.current = requestAnimationFrame(sendFrame)
    }).catch((err) => {
      console.error('[CameraStickman] camera error:', err)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      worker.terminate()
      workerRef.current = null
      workerReadyRef.current = false
      workerBusyRef.current = false
    }
  }, [sendFrame, onPersonCount, onWorkerStatus])

  return (
    <div className={`relative bg-black overflow-hidden ${className ?? ''}`}>
      {/* Hidden video — source for frame extraction */}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        playsInline
        muted
        aria-hidden
      />
      {/* Stickman overlay — matches video dimensions */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: 'none' }}
      />
    </div>
  )
}
