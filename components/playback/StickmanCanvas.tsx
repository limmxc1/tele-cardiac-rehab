'use client'

import { useEffect, useRef } from 'react'
import { JOINT_TRIPLETS } from '@/lib/pose/landmarks'
import type { TrackedJointSpec } from '@/app/actions/exercises'
import type { PlaybackPose, SparseLandmarks } from '@/lib/playback/loader'

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
 * Resolve the interpolated sparse landmark map at `currentTMs`. Only landmarks
 * present in BOTH frames get lerped; landmarks present in only one frame are
 * carried through unchanged. Indices missing from both frames stay missing.
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

/**
 * Build the segment list to draw given the tracked joints — each joint's
 * triplet contributes two segments (proximal-joint and joint-distal). Deduped
 * across joints so shared bones (e.g. shoulder for both elbow and shoulder
 * tracking) don't draw twice.
 */
function trackedSegments(tracked: readonly TrackedJointSpec[]): [number, number][] {
  const seen = new Set<string>()
  const out: [number, number][] = []
  for (const t of tracked) {
    const triplet = JOINT_TRIPLETS[t.joint]?.[t.side]
    if (!triplet) continue
    const pairs: [number, number][] = [
      [triplet[0], triplet[1]],
      [triplet[1], triplet[2]],
    ]
    for (const [a, b] of pairs) {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push([a, b])
    }
  }
  return out
}

interface Props {
  poses: PlaybackPose[]
  trackedJoints: readonly TrackedJointSpec[]
  currentTMs: number
  className?: string
}

export default function StickmanCanvas({ poses, trackedJoints, currentTMs, className }: Props) {
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

    const segments = trackedSegments(trackedJoints)
    if (segments.length > 0) {
      ctx.strokeStyle = '#22c55e'
      ctx.lineWidth = 3 * dpr
      for (const [a, b] of segments) {
        const A = lm[a]
        const B = lm[b]
        if (!A || !B) continue
        ctx.beginPath()
        ctx.moveTo(px(A[0]), py(A[1]))
        ctx.lineTo(px(B[0]), py(B[1]))
        ctx.stroke()
      }
    }

    ctx.fillStyle = '#86efac'
    for (const idx of Object.keys(lm)) {
      const p = lm[Number(idx)]
      if (!p) continue
      ctx.beginPath()
      ctx.arc(px(p[0]), py(p[1]), 3.5 * dpr, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [poses, trackedJoints, currentTMs])

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full ${className ?? ''}`}
    />
  )
}
