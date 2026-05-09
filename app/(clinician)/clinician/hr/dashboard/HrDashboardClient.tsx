'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import {
  HR_DASHBOARD_MAX_PATIENTS,
  classifyZone,
  drawSpark,
  fmtClock,
  type HrSample,
} from '@/lib/hr/hrSupabase'
import type { Database } from '@/lib/supabase/types'

type WorkoutRow = Database['public']['Tables']['hr_workouts']['Row']
type PatientMeta = { name: string; fall_risk: string; precautions: string[] }
type CachedWorkout = WorkoutRow & {
  patient_name: string
  patient_fall_risk: string
  patient_precautions: string[]
}

type ZoneClass = 'zone-in' | 'zone-below' | 'zone-above' | 'zone-ended' | 'zone-stale'

type Toast = { id: number; kind: 'warn' | 'danger'; text: string }

const STALE_SECONDS = 10
const PREC_LABELS: Record<string, string> = {
  check_hypocount: 'HYPO',
  low_bp: 'LOW BP',
  chest_pain_hx: 'CP HX',
  dizziness: 'DIZZY',
  balance: 'BALANCE',
}
const PREC_TITLES: Record<string, string> = {
  check_hypocount: 'Check hypocount (low blood sugar)',
  low_bp: 'Watch for low blood pressure',
  chest_pain_hx: 'Chest pain history',
  dizziness: 'Watch for dizziness',
  balance: 'Balance issues',
}
const MACHINE_LABELS: Record<string, string> = {
  treadmill: 'Treadmill',
  elliptical: 'Elliptical',
  cycling: 'Cycling',
  rowing: 'Rowing',
  arm_cycle: 'Arm cycle',
}

function asPrecArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : []
}

function flattenMeta(meta: PatientMeta) {
  return {
    patient_name: meta.name,
    patient_fall_risk: meta.fall_risk,
    patient_precautions: meta.precautions,
  }
}

function computeZoneClass(w: CachedWorkout): ZoneClass {
  if (w.status !== 'active') return 'zone-ended'
  const fresh =
    w.current_hr_at && Date.now() - new Date(w.current_hr_at).getTime() < STALE_SECONDS * 1000
  if (!fresh || w.current_hr == null) return 'zone-stale'
  const z = classifyZone(w.current_hr, w.hr_lower, w.hr_upper)
  return z === 'in' ? 'zone-in' : z === 'below' ? 'zone-below' : 'zone-above'
}

const cardZoneStyles: Record<ZoneClass, string> = {
  'zone-in': 'bg-green-200',
  'zone-below': 'bg-blue-200',
  'zone-above': 'bg-red-200 hr-blink',
  'zone-ended': 'bg-slate-200 text-slate-600',
  'zone-stale': 'bg-amber-200',
}

export default function HrDashboardClient() {
  // The render-driving state. Whatever ends up here is what the JSX reads;
  // refs below are the working copy that the realtime/timer callbacks mutate
  // before snapshotting back into state.
  const [sessionActive, setSessionActive] = useState(false)
  const [sessionStart, setSessionStart] = useState<number | null>(null)
  const [visible, setVisible] = useState<CachedWorkout[]>([])
  const [elapsedSec, setElapsedSec] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Mutable working copies. Read/written by callbacks, never accessed during
  // render (React 19 lint rule).
  const sessionStartRef = useRef<number | null>(null)
  const cacheRef = useRef<Map<string, CachedWorkout>>(new Map())
  const stickyEndedRef = useRef<Map<string, CachedWorkout>>(new Map())
  const patientMetaRef = useRef<Map<string, PatientMeta>>(new Map())
  const prevZoneRef = useRef<Map<string, ZoneClass>>(new Map())
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const renderTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const toastIdRef = useRef(0)

  const showToast = useCallback((text: string, kind: Toast['kind']) => {
    const id = ++toastIdRef.current
    setToasts((prev) => [{ id, kind, text }, ...prev].slice(0, 6))
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 8000)
  }, [])

  // Snapshot refs → state. Also detects zone transitions for toast alerts.
  // Called from the 1Hz timer and from realtime handlers after they mutate
  // the cache.
  const recompute = useCallback(() => {
    const start = sessionStartRef.current
    if (start == null) {
      setVisible([])
      return
    }
    const inSession = (w: CachedWorkout) => new Date(w.started_at).getTime() >= start
    const actives = Array.from(cacheRef.current.values())
      .filter((w) => w.status === 'active' && inSession(w))
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    const ended = Array.from(stickyEndedRef.current.values())
      .filter((w) => inSession(w) && !actives.find((a) => a.id === w.id))
      .sort(
        (a, b) =>
          new Date(b.ended_at || b.started_at).getTime() -
          new Date(a.ended_at || a.started_at).getTime(),
      )
    const next = [...actives, ...ended].slice(0, HR_DASHBOARD_MAX_PATIENTS)

    for (const w of next) {
      const newZone = computeZoneClass(w)
      const oldZone = prevZoneRef.current.get(w.id)
      if (oldZone && oldZone !== newZone) {
        const name = w.patient_name || 'Patient'
        if (newZone === 'zone-stale' && oldZone !== 'zone-ended') {
          showToast(`⚠ ${name} — signal lost`, 'warn')
        } else if (newZone === 'zone-above' && oldZone !== 'zone-above') {
          showToast(`⬆ ${name} — HR above target`, 'danger')
        }
      }
      prevZoneRef.current.set(w.id, newZone)
    }

    setVisible(next)
    setElapsedSec(Math.floor((Date.now() - start) / 1000))
  }, [showToast])

  const refetchAll = useCallback(async () => {
    const since = new Date(sessionStartRef.current!).toISOString()
    const { data, error } = await supabase
      .from('hr_workouts')
      .select(
        'id, patient_id, machine, status, started_at, ended_at, current_hr, current_hr_at, hr_sum, hr_count, hr_max, hr_min, samples, hr_lower, hr_upper, hr_patients(name, fall_risk, precautions)',
      )
      .gte('started_at', since)
      .order('started_at', { ascending: false })
    if (error) {
      setErrorMsg(error.message)
      return
    }
    setErrorMsg(null)
    cacheRef.current.clear()
    for (const w of (data || []) as Array<
      WorkoutRow & {
        hr_patients: { name: string; fall_risk: string; precautions: unknown } | null
      }
    >) {
      const p = w.hr_patients
      const meta: PatientMeta = {
        name: p?.name || 'Patient',
        fall_risk: p?.fall_risk || 'low',
        precautions: asPrecArray(p?.precautions),
      }
      patientMetaRef.current.set(w.patient_id, meta)
      const flat: CachedWorkout = { ...w, ...flattenMeta(meta) } as CachedWorkout
      ;(flat as unknown as { hr_patients?: unknown }).hr_patients = undefined
      cacheRef.current.set(w.id, flat)
      if (flat.status !== 'active') stickyEndedRef.current.set(flat.id, flat)
    }
    recompute()
  }, [recompute])

  const onRealtimeChange = useCallback(
    async (payload: {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE'
      new?: WorkoutRow
      old?: Partial<WorkoutRow>
    }) => {
      const start = sessionStartRef.current
      if (start == null) return
      if (payload.eventType === 'DELETE') {
        const id = payload.old?.id
        if (id) {
          cacheRef.current.delete(id)
          stickyEndedRef.current.delete(id)
        }
        recompute()
        return
      }
      const row = payload.new
      if (!row) return
      // Drop INSERTs from before this session — clinician asked for a clean
      // slate each time they hit Start. UPDATEs to rows we never cached fall
      // through too.
      if (payload.eventType === 'INSERT' && new Date(row.started_at).getTime() < start) return
      if (payload.eventType === 'UPDATE' && !cacheRef.current.has(row.id)) return

      let meta = patientMetaRef.current.get(row.patient_id)
      if (!meta) {
        const { data } = await supabase
          .from('hr_patients')
          .select('name, fall_risk, precautions')
          .eq('id', row.patient_id)
          .maybeSingle()
        meta = {
          name: data?.name || 'Patient',
          fall_risk: data?.fall_risk || 'low',
          precautions: asPrecArray(data?.precautions),
        }
        patientMetaRef.current.set(row.patient_id, meta)
      }
      const merged: CachedWorkout = { ...row, ...flattenMeta(meta) } as CachedWorkout
      cacheRef.current.set(row.id, merged)
      if (merged.status !== 'active') stickyEndedRef.current.set(row.id, merged)
      recompute()
    },
    [recompute],
  )

  const startSession = useCallback(async () => {
    const start = Date.now()
    sessionStartRef.current = start
    cacheRef.current.clear()
    stickyEndedRef.current.clear()
    prevZoneRef.current.clear()
    setSessionStart(start)
    setSessionActive(true)
    setErrorMsg(null)
    await refetchAll()

    channelRef.current = supabase
      .channel('hr_dashboard')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hr_workouts' },
        (payload) =>
          onRealtimeChange(payload as unknown as Parameters<typeof onRealtimeChange>[0]).catch(
            (err) => console.warn('realtime handler error', err),
          ),
      )
      .subscribe()

    if (renderTimerRef.current) clearInterval(renderTimerRef.current)
    renderTimerRef.current = setInterval(recompute, 1000)
  }, [onRealtimeChange, recompute, refetchAll])

  const stopSession = useCallback(() => {
    setSessionActive(false)
    setSessionStart(null)
    sessionStartRef.current = null
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    if (renderTimerRef.current) {
      clearInterval(renderTimerRef.current)
      renderTimerRef.current = null
    }
    cacheRef.current.clear()
    stickyEndedRef.current.clear()
    prevZoneRef.current.clear()
    setVisible([])
  }, [])

  useEffect(() => {
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      if (renderTimerRef.current) clearInterval(renderTimerRef.current)
    }
  }, [])

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes hrCardBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.5; } }
        .hr-blink { animation: hrCardBlink 0.7s infinite; }
        @keyframes hrStaleDot { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } }
        .hr-stale-dot { animation: hrStaleDot 1.5s infinite; }
      `}</style>

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          {sessionActive && sessionStart != null
            ? `Session: ${fmtClock(elapsedSec)}`
            : 'Session not started.'}
        </div>
        <div className="flex items-center gap-2">
          {!sessionActive ? (
            <button
              onClick={startSession}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Start session
            </button>
          ) : (
            <button
              onClick={stopSession}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Stop session
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{errorMsg}</div>
      )}

      {sessionActive && visible.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white py-16 text-center text-slate-500">
          <p className="text-base">No active workouts.</p>
          <p className="mt-1 text-sm">
            When patients start a workout on their phones, they&apos;ll appear here automatically.
          </p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map((w) => (
            <HRPatientCard
              key={w.id}
              workout={w}
              nowMs={sessionStart != null ? sessionStart + elapsedSec * 1000 : Date.parse(w.started_at)}
            />
          ))}
        </div>
      )}

      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex max-w-xs flex-col-reverse gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-lg ${
              t.kind === 'danger' ? 'bg-red-600' : 'bg-amber-600'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}

function HRPatientCard({ workout: w, nowMs }: { workout: CachedWorkout; nowMs: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const zoneClass = computeZoneClass(w)
  const isEnded = w.status !== 'active'
  const machine = MACHINE_LABELS[w.machine] || w.machine.replace('_', ' ')
  const avg = w.hr_count ? Math.round(w.hr_sum / w.hr_count) : null
  const max = w.hr_max
  const startMs = new Date(w.started_at).getTime()
  const endMs = isEnded ? new Date(w.ended_at || nowMs).getTime() : nowMs
  const elapsed = Math.floor((endMs - startMs) / 1000)

  let hrText: string | number = '—'
  let signalLostText: string | null = null
  let signalLostSeconds = 0
  if (!isEnded) {
    if (zoneClass === 'zone-stale') {
      hrText = '…'
      const lastAt = w.current_hr_at ? new Date(w.current_hr_at).getTime() : startMs
      signalLostSeconds = Math.floor((nowMs - lastAt) / 1000)
      signalLostText =
        signalLostSeconds < 60
          ? `${signalLostSeconds}s ago`
          : `${Math.floor(signalLostSeconds / 60)}m ${signalLostSeconds % 60}s ago`
    } else {
      hrText = w.current_hr ?? '—'
    }
  } else {
    hrText = avg != null ? `avg ${avg}` : 'ended'
  }

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const r = c.getBoundingClientRect()
    c.width = Math.max(120, Math.floor(r.width))
    c.height = 50
    const samples = (Array.isArray(w.samples) ? (w.samples as HrSample[]) : []).slice(-90)
    drawSpark(c, samples, w.hr_lower, w.hr_upper)
  }, [w.samples, w.hr_lower, w.hr_upper])

  const fall = w.patient_fall_risk
  const fallChip =
    fall === 'high'
      ? { cls: 'bg-red-600 text-white', text: 'FALL RISK', title: 'Fall risk: high' }
      : fall === 'medium'
      ? { cls: 'bg-amber-500 text-white', text: 'FALL RISK', title: 'Fall risk: medium' }
      : null

  return (
    <div
      className={`relative min-h-[200px] overflow-hidden rounded-xl p-4 text-slate-900 transition-colors duration-300 ${cardZoneStyles[zoneClass]}`}
    >
      <span
        className={`absolute right-3 top-3 h-2.5 w-2.5 rounded-full ${
          zoneClass === 'zone-ended'
            ? 'bg-slate-400'
            : zoneClass === 'zone-stale'
            ? 'bg-amber-500 hr-stale-dot'
            : 'bg-emerald-600 ring-2 ring-emerald-600/30'
        }`}
      />
      <div className="text-base font-bold">{w.patient_name || 'Patient'}</div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-700/80">
        {machine}
        {isEnded && ' · ended'}
      </div>

      {(fallChip || (w.patient_precautions || []).length > 0) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {fallChip && (
            <span
              title={fallChip.title}
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${fallChip.cls}`}
            >
              {fallChip.text}
            </span>
          )}
          {(w.patient_precautions || []).map((p) => (
            <span
              key={p}
              title={PREC_TITLES[p] || p}
              className="rounded-full bg-slate-900/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-slate-900"
            >
              {PREC_LABELS[p] || p.toUpperCase()}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-[3rem] font-extrabold leading-none tracking-tight">{hrText}</span>
        {!isEnded && zoneClass !== 'zone-stale' && (
          <span className="text-xs font-medium opacity-70">bpm</span>
        )}
      </div>

      {signalLostText && (
        <div className="mt-1 text-[11px] font-bold text-amber-900">
          SIGNAL LOST · {signalLostText}
          {signalLostSeconds > 120 && (
            <div className="text-[10px] font-normal opacity-80">Patient may have stepped away</div>
          )}
        </div>
      )}

      <canvas ref={canvasRef} className="mt-2 h-[50px] w-full" />

      <div className="mt-2 flex justify-between text-xs text-slate-700/85">
        <span>avg {avg ?? '—'}</span>
        <span>max {max ?? '—'}</span>
        <span>{fmtClock(elapsed)}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-700/60">
        target {w.hr_lower}–{w.hr_upper}
      </div>
    </div>
  )
}
