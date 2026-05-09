'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { fmtClock, type HrSample } from '@/lib/hr/hrSupabase'
import type { Database } from '@/lib/supabase/types'

type WorkoutWithPatient = Database['public']['Tables']['hr_workouts']['Row'] & {
  hr_patients: { id: string; name: string; device_name: string } | null
}

const MACHINE_LABELS: Record<string, string> = {
  treadmill: 'Treadmill',
  elliptical: 'Elliptical',
  cycling: 'Cycling',
  rowing: 'Rowing',
  arm_cycle: 'Arm cycle',
}

function drawFullChart(
  canvas: HTMLCanvasElement,
  samples: HrSample[],
  hrLower: number,
  hrUpper: number,
) {
  const dpr = window.devicePixelRatio || 1
  const r = canvas.getBoundingClientRect()
  canvas.width = Math.floor(r.width * dpr)
  canvas.height = 320 * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  const W = r.width
  const H = 320

  ctx.clearRect(0, 0, W, H)
  const valid = samples.filter((s): s is [number, number] => s[1] != null)
  if (valid.length < 2) {
    ctx.fillStyle = '#94a3b8'
    ctx.font = '14px sans-serif'
    ctx.fillText('Not enough samples to plot.', 20, 30)
    return
  }
  const xs = valid.map((s) => s[0])
  const ys = valid.map((s) => s[1])
  const minX = xs[0]
  const maxX = xs[xs.length - 1]
  const xrange = Math.max(1, maxX - minX)
  const minY = Math.min(hrLower - 10, ...ys)
  const maxY = Math.max(hrUpper + 10, ...ys)
  const yrange = Math.max(1, maxY - minY)
  const padL = 40,
    padR = 16,
    padT = 10,
    padB = 26
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const xx = (t: number) => padL + ((t - minX) / xrange) * innerW
  const yy = (v: number) => padT + (1 - (v - minY) / yrange) * innerH

  ctx.fillStyle = 'rgba(34,197,94,0.15)'
  ctx.fillRect(padL, yy(hrUpper), innerW, yy(hrLower) - yy(hrUpper))

  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 1
  ctx.fillStyle = '#64748b'
  ctx.font = '11px sans-serif'
  ctx.beginPath()
  const ticks = 5
  for (let i = 0; i <= ticks; i++) {
    const v = minY + (yrange * i) / ticks
    const y = yy(v)
    ctx.moveTo(padL, y)
    ctx.lineTo(W - padR, y)
    ctx.fillText(String(Math.round(v)), 4, y + 3)
  }
  ctx.stroke()

  const xticks = 6
  for (let i = 0; i <= xticks; i++) {
    const t = minX + (xrange * i) / xticks
    const x = xx(t)
    ctx.fillText(fmtClock(Math.round(t)), x - 14, H - 8)
  }

  ctx.strokeStyle = '#0ea5e9'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  valid.forEach((s, idx) => {
    const x = xx(s[0])
    const y = yy(s[1])
    if (idx === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  ctx.strokeStyle = '#16a34a'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(padL, yy(hrLower))
  ctx.lineTo(W - padR, yy(hrLower))
  ctx.moveTo(padL, yy(hrUpper))
  ctx.lineTo(W - padR, yy(hrUpper))
  ctx.stroke()
  ctx.setLineDash([])
}

export default function HrWorkoutDetailClient({ workoutId }: { workoutId: string }) {
  const [workout, setWorkout] = useState<WorkoutWithPatient | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('hr_workouts')
        .select('*, hr_patients(id, name, device_name)')
        .eq('id', workoutId)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      setWorkout((data as WorkoutWithPatient) || null)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [workoutId])

  useEffect(() => {
    if (!workout || !canvasRef.current) return
    const samples = (Array.isArray(workout.samples) ? (workout.samples as HrSample[]) : [])
    drawFullChart(canvasRef.current, samples, workout.hr_lower, workout.hr_upper)
  }, [workout])

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (error)
    return <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>
  if (!workout)
    return (
      <div className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-700">
        Workout not found (may be older than 7 days).
      </div>
    )

  const p = workout.hr_patients
  const machine = MACHINE_LABELS[workout.machine] || workout.machine
  const dur = Math.floor(
    (new Date(workout.ended_at || workout.started_at).getTime() -
      new Date(workout.started_at).getTime()) /
      1000,
  )
  const avg = workout.hr_count ? Math.round(workout.hr_sum / workout.hr_count) : null

  return (
    <div className="space-y-4">
      <nav className="text-xs text-slate-500">
        <Link href="/clinician/hr" className="hover:text-slate-700">
          HR Monitoring
        </Link>
        {' / '}
        <Link href="/clinician/hr/history" className="hover:text-slate-700">
          History
        </Link>
        {p && (
          <>
            {' / '}
            <Link href={`/clinician/hr/history/${p.id}`} className="hover:text-slate-700">
              {p.name}
            </Link>
          </>
        )}
        {' / Workout'}
      </nav>

      <div>
        <h2 className="text-2xl font-bold text-slate-800">
          {p?.name || 'Patient'} — {machine}
        </h2>
        <p className="text-xs text-slate-500">
          {new Date(workout.started_at).toLocaleString()}
          {' · status: '}
          {workout.status}
          {' · target '}
          {workout.hr_lower}–{workout.hr_upper} bpm
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Duration', value: fmtClock(dur) },
          { label: 'Avg HR', value: avg ?? '—' },
          { label: 'Max HR', value: workout.hr_max ?? '—' },
          { label: 'Min HR', value: workout.hr_min ?? '—' },
        ].map((t) => (
          <div key={t.label} className="rounded-xl bg-slate-100 px-4 py-3">
            <div className="text-xs text-slate-500">{t.label}</div>
            <div className="mt-0.5 text-lg font-bold text-slate-800">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">HR trace</h3>
          <span className="text-xs text-slate-500">target zone shaded green</span>
        </div>
        <canvas ref={canvasRef} className="h-[320px] w-full rounded-lg bg-slate-50" />
      </div>
    </div>
  )
}
