'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const POSE_CONNECTIONS: [number, number][] = [
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31],
  [24, 26], [26, 28], [28, 30], [28, 32],
]

interface Props {
  landmarksRef: RefObject<NormalizedLandmark[] | null>
  className?: string
}

/**
 * Clean stickman drawing on a dark panel — same skeleton geometry as the
 * camera overlay but without the video underneath. Driven by an rAF loop
 * that polls a ref so 30fps pose updates don't trigger React re-renders.
 */
export default function LiveStickman({ landmarksRef, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
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

      const lm = landmarksRef.current
      if (!lm || lm.length === 0) {
        ctx.fillStyle = '#64748b'
        ctx.font = `${14 * dpr}px ui-sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText('Searching for body…', canvas.width / 2, canvas.height / 2)
        return
      }

      // Aspect-fit assuming a 4:3 capture region; mirrors the camera framing.
      const pad = 12 * dpr
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
        ctx.moveTo(px(A.x), py(A.y))
        ctx.lineTo(px(B.x), py(B.y))
        ctx.stroke()
      }

      ctx.fillStyle = '#86efac'
      for (const p of lm) {
        ctx.beginPath()
        ctx.arc(px(p.x), py(p.y), 3.5 * dpr, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [landmarksRef])

  return <canvas ref={canvasRef} className={className ?? 'w-full h-full block'} />
}
