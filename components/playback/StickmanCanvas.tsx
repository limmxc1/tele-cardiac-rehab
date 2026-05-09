'use client'

import { useEffect, useRef } from 'react'
import type { PlaybackPose, SparseLandmarks } from '@/lib/playback/loader'

/** Standard MediaPipe pose connections — full body, anatomical view. */
const POSE_CONNECTIONS: [number, number][] = [
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31],
  [24, 26], [26, 28], [28, 30], [28, 32],
]

function findFrameIndex(poses: PlaybackPose[], tMs: number): number {
  if (poses.length === 0) return -1
  let lo = 0
  let hi = poses.length - 1
  if (tMs <= poses[0].tMs) return 0
  if (tMs >= poses[hi].tMs) return hi
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (poses[mid].tMs <= tMs) lo = mid
    else hi = mid - 1
  }
  return lo
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Resolve the interpolated landmark map at `currentTMs`. Loader normalizes
 * dense (new full-body) and sparse (legacy joint-only) recordings into the
 * same `SparseLandmarks` Record so the drawing path doesn't have to care.
 */
export function resolveFrame(
  poses: PlaybackPose[],
  currentTMs: number,
): SparseLandmarks | null {
  if (poses.length === 0) return null
  const i = findFrameIndex(poses, currentTMs)
  const a = poses[i]
  const b = poses[Math.min(i + 1, poses.length - 1)]
  const span = b.tMs - a.tMs
  const t = span > 0 ? Math.min(1, Math.max(0, (currentTMs - a.tMs) / span)) : 0
  const out: SparseLandmarks = {}
  const indices = new Set<number>([
    ...Object.keys(a.lm).map(Number),
    ...Object.keys(b.lm).map(Number),
  ])
  for (const idx of indices) {
    const p = a.lm[idx]
    const q = b.lm[idx]
    if (p && q) {
      out[idx] = [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)]
    } else if (p) {
      out[idx] = p
    } else if (q) {
      out[idx] = q
    }
  }
  return out
}

interface Props {
  poses: PlaybackPose[]
  currentTMs: number
  className?: string
}

/**
 * Stickman replay. Anatomical view — landmarks are drawn as-is, so the
 * patient's right hand appears on the viewer's left.
 */
export default function StickmanCanvas({ poses, currentTMs, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }

    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (poses.length === 0) {
      ctx.fillStyle = '#64748b'
      ctx.font = `${14 * dpr}px ui-sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('No pose data', canvas.width / 2, canvas.height / 2)
      return
    }

    const lm = resolveFrame(poses, currentTMs)
    if (!lm) return

    const pad = 16 * dpr
    const fitW = canvas.width - pad * 2
    const fitH = canvas.height - pad * 2
    const aspect = fitW / fitH
    const srcAspect = 4 / 3
    let drawW = fitW
    let drawH = fitH
    if (aspect > srcAspect) drawW = fitH * srcAspect
    else drawH = fitW / srcAspect
    const offX = (canvas.width - drawW) / 2
    const offY = (canvas.height - drawH) / 2

    const px = (x: number) => offX + x * drawW
    const py = (y: number) => offY + y * drawH

    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth = 3 * dpr
    for (const [a, b] of POSE_CONNECTIONS) {
      const A = lm[a]
      const B = lm[b]
      if (!A || !B) continue
      ctx.beginPath()
      ctx.moveTo(px(A[0]), py(A[1]))
      ctx.lineTo(px(B[0]), py(B[1]))
      ctx.stroke()
    }

    ctx.fillStyle = '#86efac'
    for (const idx of Object.keys(lm)) {
      const p = lm[Number(idx)]
      if (!p) continue
      ctx.beginPath()
      ctx.arc(px(p[0]), py(p[1]), 3.5 * dpr, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [poses, currentTMs])

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full ${className ?? ''}`}
    />
  )
}
