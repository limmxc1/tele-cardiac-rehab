'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

type Patient = Pick<
  Database['public']['Tables']['hr_patients']['Row'],
  'id' | 'name' | 'device_name' | 'hr_lower' | 'hr_upper'
>

type WorkoutCount = { total: number; last: string | null }

export default function HrHistoryClient() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [counts, setCounts] = useState<Map<string, WorkoutCount>>(new Map())
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
      const [{ data: pts, error: e1 }, { data: ws, error: e2 }] = await Promise.all([
        supabase
          .from('hr_patients')
          .select('id, name, device_name, hr_lower, hr_upper')
          .order('name'),
        supabase
          .from('hr_workouts')
          .select('id, patient_id, started_at, ended_at, status')
          .gte('started_at', since),
      ])
      if (cancelled) return
      if (e1 || e2) {
        setError((e1 || e2)!.message)
        setLoading(false)
        return
      }
      const m = new Map<string, WorkoutCount>()
      for (const w of ws || []) {
        const cur = m.get(w.patient_id) || { total: 0, last: null }
        cur.total += 1
        if (!cur.last || new Date(w.started_at) > new Date(cur.last)) cur.last = w.started_at
        m.set(w.patient_id, cur)
      }
      setPatients(pts || [])
      setCounts(m)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return patients
    return patients.filter((p) => p.name.toLowerCase().includes(q))
  }, [patients, search])

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient name…"
          className="max-w-[260px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No patients.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const c = counts.get(p.id) || { total: 0, last: null }
            const lastTxt = c.last ? new Date(c.last).toLocaleString() : '—'
            return (
              <Link
                key={p.id}
                href={`/clinician/hr/history/${p.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-800">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      <code className="rounded bg-slate-100 px-1">{p.device_name}</code>
                      {' · '}target {p.hr_lower}–{p.hr_upper}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-800">
                      {c.total} workout{c.total === 1 ? '' : 's'}
                    </div>
                    <div className="text-xs text-slate-500">last: {lastTxt}</div>
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
