'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { fmtClock } from '@/lib/hr/hrSupabase'
import type { Database } from '@/lib/supabase/types'

type Patient = Database['public']['Tables']['hr_patients']['Row']
type Workout = Pick<
  Database['public']['Tables']['hr_workouts']['Row'],
  | 'id'
  | 'machine'
  | 'status'
  | 'started_at'
  | 'ended_at'
  | 'hr_sum'
  | 'hr_count'
  | 'hr_min'
  | 'hr_max'
  | 'hr_lower'
  | 'hr_upper'
>

const MACHINE_LABELS: Record<string, string> = {
  treadmill: 'Treadmill',
  elliptical: 'Elliptical',
  cycling: 'Cycling',
  rowing: 'Rowing',
  arm_cycle: 'Arm cycle',
}

function statusBadge(status: string): { cls: string; text: string } {
  if (status === 'ended')
    return { cls: 'bg-emerald-100 text-emerald-700', text: 'completed' }
  if (status === 'aborted')
    return { cls: 'bg-amber-100 text-amber-700', text: 'aborted' }
  return { cls: 'bg-blue-100 text-blue-700', text: 'active' }
}

export default function HrPatientHistoryClient({ patientId }: { patientId: string }) {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
      const [{ data: p, error: e1 }, { data: ws, error: e2 }] = await Promise.all([
        supabase.from('hr_patients').select('*').eq('id', patientId).maybeSingle(),
        supabase
          .from('hr_workouts')
          .select(
            'id, machine, status, started_at, ended_at, hr_sum, hr_count, hr_min, hr_max, hr_lower, hr_upper',
          )
          .eq('patient_id', patientId)
          .gte('started_at', since)
          .order('started_at', { ascending: false }),
      ])
      if (cancelled) return
      if (e1 || e2) {
        setError((e1 || e2)!.message)
        setLoading(false)
        return
      }
      setPatient((p as Patient) || null)
      setWorkouts((ws || []) as Workout[])
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [patientId])

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (error)
    return <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>
  if (!patient)
    return (
      <div className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-700">
        Patient not found.
      </div>
    )

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-slate-800">{patient.name}</h2>
        <p className="text-xs text-slate-500">
          Strap <code className="rounded bg-slate-100 px-1">{patient.device_name}</code>
          {' · '}target {patient.hr_lower}–{patient.hr_upper} bpm
          {' · '}fall risk {patient.fall_risk}
        </p>
      </div>

      {workouts.length === 0 ? (
        <p className="text-sm text-slate-500">No workouts in the last 7 days.</p>
      ) : (
        <div className="space-y-2">
          {workouts.map((w) => {
            const dur = Math.floor(
              (new Date(w.ended_at || w.started_at).getTime() -
                new Date(w.started_at).getTime()) /
                1000,
            )
            const avg = w.hr_count ? Math.round(w.hr_sum / w.hr_count) : null
            const startedTxt = new Date(w.started_at).toLocaleString()
            const machine = MACHINE_LABELS[w.machine] || w.machine
            const badge = statusBadge(w.status)
            return (
              <Link
                key={w.id}
                href={`/clinician/hr/workout/${w.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">{machine}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                      >
                        {badge.text}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">{startedTxt}</div>
                  </div>
                  <div className="text-right text-sm text-slate-700">
                    <strong>{fmtClock(dur)}</strong> · avg <strong>{avg ?? '—'}</strong> · max{' '}
                    <strong>{w.hr_max ?? '—'}</strong>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
