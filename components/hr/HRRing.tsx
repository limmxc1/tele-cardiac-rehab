'use client'

import { useEffect, useRef } from 'react'

interface Props {
  hrBpm: number | null
  hrLimit: number
  size?: number
}

export default function HRRing({ hrBpm, hrLimit, size = 80 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hrRef = useRef<number | null>(null)
  const blinkRef = useRef(false)
  const rafRef = useRef<number>(0)

  hrRef.current = hrBpm

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const r = size / 2 - 6
    let lastBlink = 0

    function draw(t: number) {
      if (!ctx) return
      const hr = hrRef.current
      const isDanger = hr !== null && hr > hrLimit
      const isLow = hr !== null && hr < hrLimit * 0.6

      if (isDanger && t - lastBlink > 500) {
        blinkRef.current = !blinkRef.current
        lastBlink = t
      }
      if (!isDanger) blinkRef.current = false

      const color = isDanger
        ? blinkRef.current ? '#ef4444' : '#ffffff'
        : isLow ? '#3b82f6' : '#22c55e'

      ctx.clearRect(0, 0, size, size)

      // Background track
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.strokeStyle = '#374151'
      ctx.lineWidth = 6
      ctx.stroke()

      // Colored ring
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.strokeStyle = color
      ctx.lineWidth = 6
      ctx.stroke()

      // HR number
      ctx.fillStyle = color
      ctx.font = `bold ${Math.round(size * 0.28)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(hr !== null ? String(hr) : '—', cx, cy - size * 0.08)

      // "bpm" label
      ctx.fillStyle = '#9ca3af'
      ctx.font = `${Math.round(size * 0.14)}px sans-serif`
      ctx.fillText('bpm', cx, cy + size * 0.2)

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [hrLimit, size])

  return <canvas ref={canvasRef} />
}
