'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { HRMonitor, type HrStatusPayload } from '@/lib/hr/hrMonitor'
import {
  HR_MACHINES,
  HR_SESSION_MAX_HOURS,
  classifyZone,
  deviceIdFromBLE,
  drawSpark,
  fmtClock,
  idbClearPending,
  idbPutPending,
  type HrSample,
  type ZoneKind,
} from '@/lib/hr/hrSupabase'
import type { Database } from '@/lib/supabase/types'

type Patient = Database['public']['Tables']['hr_patients']['Row']
type Stage = 'pair' | 'unmapped' | 'ready' | 'workout' | 'post'

const FLUSH_INTERVAL_MS = 10_000
const SCALAR_UPDATE_MS = 1000

const ZONE_PILL: Record<
  ZoneKind | 'none',
  { cls: string; text: string; blink?: boolean }
> = {
  in: { cls: 'bg-emerald-100 text-emerald-700', text: 'In zone' },
  below: { cls: 'bg-blue-100 text-blue-700', text: 'Below zone — push harder' },
  above: { cls: 'bg-red-100 text-red-700 hr-pill-blink', text: 'Above zone — slow down', blink: true },
  none: { cls: 'bg-slate-100 text-slate-500', text: 'waiting…' },
}

export default function HrPatientClient() {
  const [stage, setStage] = useState<Stage>('pair')
  const [supportError, setSupportError] = useState<string | null>(null)
  const [pairStatus, setPairStatus] = useState<string>('')
  const [pairing, setPairing] = useState(false)
  const [unmappedDeviceName, setUnmappedDeviceName] = useState<string | null>(null)

  const [patient, setPatient] = useState<Patient | null>(null)
  const [chosenMachine, setChosenMachine] = useState<string | null>(null)
  const [startMsg, setStartMsg] = useState<string | null>(null)

  const [liveHr, setLiveHr] = useState<number | null>(null)
  const [connStatus, setConnStatus] = useState<string>('')
  const [reconnectCountdown, setReconnectCountdown] = useState<number | null>(null)
  const [postSummary, setPostSummary] = useState<{
    duration: number
    avg: number | null
    max: number | null
    aborted: boolean
  } | null>(null)

  // Stats kept in refs so the 1Hz tick doesn't have to round-trip via setState
  // for every update.
  const hrmRef = useRef<HRMonitor | null>(null)
  const liveHrRef = useRef<number | null>(null)
  const workoutIdRef = useRef<string | null>(null)
  const workoutStartRef = useRef<number | null>(null)
  const pendingRef = useRef<HrSample[]>([])
  const displayRef = useRef<HrSample[]>([])
  const hrSumRef = useRef(0)
  const hrCountRef = useRef(0)
  const hrMinRef = useRef<number | null>(null)
  const hrMaxRef = useRef<number | null>(null)
  const flushInFlightRef = useRef(false)
  const lastScalarAtRef = useRef(0)

  const uiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimedOutRef = useRef(false)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Stats snapshotted from the working refs every 1Hz. The JSX reads these,
  // not the refs (React 19 lint forbids reading refs during render).
  const [stats, setStats] = useState<{ elapsedSec: number; avg: number | null; max: number | null }>({
    elapsedSec: 0,
    avg: null,
    max: null,
  })

  // ---- Helpers ----
  const machineLabel = useCallback((v: string | null) => {
    if (!v) return ''
    return HR_MACHINES.find(([code]) => code === v)?.[1] || v
  }, [])

  const clearTimers = useCallback(() => {
    if (uiTimerRef.current) {
      clearInterval(uiTimerRef.current)
      uiTimerRef.current = null
    }
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current)
      flushTimerRef.current = null
    }
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current)
      autoStopTimerRef.current = null
    }
  }, [])

  const stopReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearInterval(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    setReconnectCountdown(null)
  }, [])

  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    try {
      const sentinel = await navigator.wakeLock.request('screen')
      wakeLockRef.current = sentinel
      sentinel.addEventListener('release', () => {
        wakeLockRef.current = null
      })
    } catch {
      // user denied / not supported
    }
  }, [])

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current) await wakeLockRef.current.release()
    } catch {
      // ignore
    }
    wakeLockRef.current = null
  }, [])

  // ---- Flush samples to Supabase ----
  const flushSamples = useCallback(async () => {
    const id = workoutIdRef.current
    if (!id || flushInFlightRef.current || pendingRef.current.length === 0) return
    flushInFlightRef.current = true
    const batch = pendingRef.current.slice()
    try {
      const { error } = await supabase.rpc('hr_append_samples', {
        workout_id: id,
        delta: batch as unknown as Database['public']['Functions']['hr_append_samples']['Args']['delta'],
      })
      if (error) throw error
      pendingRef.current.splice(0, batch.length)
      await idbPutPending(id, pendingRef.current)
    } catch (err) {
      console.warn('sample flush failed (will retry):', err)
    } finally {
      flushInFlightRef.current = false
    }
  }, [])

  const tick = useCallback(async () => {
    const id = workoutIdRef.current
    const start = workoutStartRef.current
    if (!id || start == null) return
    const now = Date.now()
    const tOffset = Math.floor((now - start) / 1000)
    const hr = liveHrRef.current
    const sample: HrSample = [tOffset, hr]
    pendingRef.current.push(sample)
    displayRef.current.push(sample)
    if (displayRef.current.length > 1800) {
      displayRef.current.splice(0, displayRef.current.length - 1800)
    }
    if (hr != null) {
      hrSumRef.current += hr
      hrCountRef.current += 1
      hrMinRef.current = hrMinRef.current == null ? hr : Math.min(hrMinRef.current, hr)
      hrMaxRef.current = hrMaxRef.current == null ? hr : Math.max(hrMaxRef.current, hr)
    }
    // Fire-and-forget IDB write so a transient failure doesn't lose samples.
    idbPutPending(id, pendingRef.current).catch(() => {})

    // Cheap scalar update; samples flush at the slower interval.
    if (now - lastScalarAtRef.current >= 950) {
      lastScalarAtRef.current = now
      const { error } = await supabase
        .from('hr_workouts')
        .update({
          current_hr: hr,
          current_hr_at: new Date(now).toISOString(),
          hr_min: hrMinRef.current,
          hr_max: hrMaxRef.current,
          hr_sum: hrSumRef.current,
          hr_count: hrCountRef.current,
        })
        .eq('id', id)
      if (error) console.warn('scalar update failed:', error.message)
    }
    setStats({
      elapsedSec: tOffset,
      avg: hrCountRef.current ? Math.round(hrSumRef.current / hrCountRef.current) : null,
      max: hrMaxRef.current,
    })
  }, [])

  // ---- Reconnect flow ----
  const startReconnectFlow = useCallback(() => {
    if (reconnectTimerRef.current) return
    let secondsLeft = 30
    setReconnectCountdown(secondsLeft)
    reconnectTimedOutRef.current = false

    reconnectTimerRef.current = setInterval(() => {
      secondsLeft--
      if (secondsLeft <= 0) {
        if (reconnectTimerRef.current) clearInterval(reconnectTimerRef.current)
        reconnectTimerRef.current = null
        reconnectTimedOutRef.current = true
        setReconnectCountdown(null)
        endWorkoutRef.current?.(true)
        return
      }
      setReconnectCountdown(secondsLeft)
    }, 1000)

    const hrm = hrmRef.current
    if (hrm && hrm.device) {
      hrm
        .reconnect(hrm.device)
        .then((ok) => {
          if (reconnectTimedOutRef.current) return
          if (ok && reconnectTimerRef.current) {
            clearInterval(reconnectTimerRef.current)
            reconnectTimerRef.current = null
            setReconnectCountdown(null)
          }
        })
        .catch(() => {
          // countdown handles the rest
        })
    }
  }, [])

  // ---- End workout ----
  // Forward-decl with a ref because startReconnectFlow needs to call it.
  const endWorkoutRef = useRef<((auto: boolean) => Promise<void>) | null>(null)

  const endWorkout = useCallback(
    async (autoOrAborted: boolean) => {
      const id = workoutIdRef.current
      const start = workoutStartRef.current
      if (!id || start == null) return
      clearTimers()
      stopReconnectTimer()
      releaseWakeLock()
      const finalDur = Math.floor((Date.now() - start) / 1000)
      workoutIdRef.current = null
      workoutStartRef.current = null

      // Best-effort final flush before closing the workout.
      for (let i = 0; i < 3 && pendingRef.current.length > 0; i++) {
        try {
          const batch = pendingRef.current.slice()
          const { error } = await supabase.rpc('hr_append_samples', {
            workout_id: id,
            delta: batch as unknown as Database['public']['Functions']['hr_append_samples']['Args']['delta'],
          })
          if (error) throw error
          pendingRef.current.splice(0, batch.length)
        } catch (err) {
          if (i === 2) console.warn('final flush failed:', err)
        }
      }
      await idbClearPending(id)

      await supabase
        .from('hr_workouts')
        .update({
          status: autoOrAborted ? 'aborted' : 'ended',
          ended_at: new Date().toISOString(),
          current_hr: null,
          current_hr_at: null,
          hr_min: hrMinRef.current,
          hr_max: hrMaxRef.current,
          hr_sum: hrSumRef.current,
          hr_count: hrCountRef.current,
        })
        .eq('id', id)

      const avg = hrCountRef.current ? Math.round(hrSumRef.current / hrCountRef.current) : null
      setPostSummary({
        duration: finalDur,
        avg,
        max: hrMaxRef.current,
        aborted: autoOrAborted,
      })
      setStage('post')
    },
    [clearTimers, releaseWakeLock, stopReconnectTimer],
  )

  // Keep the latest endWorkout in a ref so timer/reconnect callbacks can call
  // it without rebuilding their setInterval closures every time. The lint
  // rule against ref-mutation doesn't fit the latest-ref pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    endWorkoutRef.current = endWorkout
  }, [endWorkout])

  const identifyByDeviceName = useCallback(async (deviceName: string) => {
    const { data, error } = await supabase
      .from('hr_patients')
      .select('*')
      .eq('device_name', deviceName)
      .maybeSingle()
    if (error) {
      setPairStatus('Lookup failed: ' + error.message)
      setStage('pair')
      return
    }
    if (!data) {
      setUnmappedDeviceName(deviceName)
      setStage('unmapped')
      return
    }
    setPatient(data as Patient)
    setStage('ready')
  }, [])

  // ---- Setup HRMonitor on mount + try silent reconnect ----
  useEffect(() => {
    if (!HRMonitor.isSupported()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupportError(
        'Web Bluetooth not available. Open this page on Android Chrome or desktop Chrome / Edge. (iOS Safari is not supported.)',
      )
      return
    }
    const hrm = new HRMonitor()
    hrmRef.current = hrm

    hrm.on('hr', (hr) => {
      liveHrRef.current = hr
      setLiveHr(hr)
    })
    hrm.on('status', (s: HrStatusPayload) => {
      if (workoutIdRef.current == null) setPairStatus(s.text || '')
      else setConnStatus(s.text || '')
    })
    hrm.on('disconnect', () => {
      if (workoutIdRef.current != null) startReconnectFlow()
    })

    // Silent auto-reconnect: if exactly one previously-permitted Polar device
    // exists, try it without showing the chooser.
    ;(async () => {
      const known = await HRMonitor.knownDevices()
      const candidates = known.filter((d) => /polar/i.test(d.name || ''))
      if (candidates.length !== 1) return
      const dev = candidates[0]
      setPairStatus(`Reconnecting to ${dev.name}…`)
      setPairing(true)
      const ok = await hrm.reconnect(dev)
      setPairing(false)
      if (ok) {
        const deviceName = deviceIdFromBLE(hrm.device)
        await identifyByDeviceName(deviceName)
      } else {
        setPairStatus('')
      }
    })()

    return () => {
      hrm.disconnect()
      hrmRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Pair button ----
  async function onPair() {
    const hrm = hrmRef.current
    if (!hrm) return
    setPairStatus('Waiting for browser dialog…')
    setPairing(true)
    try {
      await hrm.connect()
      const deviceName = deviceIdFromBLE(hrm.device)
      if (!deviceName) throw new Error('Could not read device name.')
      await identifyByDeviceName(deviceName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // NotFoundError: user cancelled the chooser; suppress.
      if (msg.includes('User cancelled') || (err instanceof Error && err.name === 'NotFoundError')) {
        setPairStatus('')
      } else {
        setPairStatus('Failed: ' + msg)
      }
    } finally {
      setPairing(false)
    }
  }

  // ---- Start workout ----
  async function onStart() {
    if (!chosenMachine || !patient) return
    setStartMsg('Starting workout…')
    const { data, error } = await supabase
      .from('hr_workouts')
      .insert({
        patient_id: patient.id,
        machine: chosenMachine,
        hr_lower: patient.hr_lower,
        hr_upper: patient.hr_upper,
      })
      .select()
      .single()
    if (error) {
      setStartMsg(error.message)
      return
    }
    workoutIdRef.current = data.id
    workoutStartRef.current = Date.now()
    pendingRef.current = []
    displayRef.current = []
    hrSumRef.current = 0
    hrCountRef.current = 0
    hrMinRef.current = null
    hrMaxRef.current = null
    flushInFlightRef.current = false
    lastScalarAtRef.current = 0
    setStartMsg(null)
    setStage('workout')
    setConnStatus('')

    acquireWakeLock()
    uiTimerRef.current = setInterval(() => {
      tick()
    }, SCALAR_UPDATE_MS)
    flushTimerRef.current = setInterval(() => {
      flushSamples()
    }, FLUSH_INTERVAL_MS)
    autoStopTimerRef.current = setTimeout(() => {
      if (workoutIdRef.current != null) endWorkoutRef.current?.(true)
    }, HR_SESSION_MAX_HOURS * 60 * 60 * 1000)
    tick()
  }

  // ---- Visibility-change: re-acquire wake lock + recover BLE ----
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === 'visible' && workoutIdRef.current != null) {
        if (!wakeLockRef.current) acquireWakeLock()
        const hrm = hrmRef.current
        if (hrm && !hrm.connected && reconnectTimerRef.current == null) {
          startReconnectFlow()
        }
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [acquireWakeLock, startReconnectFlow])

  // ---- Warn before unload during workout ----
  useEffect(() => {
    function onBefore(e: BeforeUnloadEvent) {
      if (workoutIdRef.current != null) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [])

  // ---- Sparkline render on stat tick ----
  useEffect(() => {
    if (stage !== 'workout' || !canvasRef.current || !patient) return
    const recent = displayRef.current.slice(-180)
    drawSpark(canvasRef.current, recent, patient.hr_lower, patient.hr_upper)
  }, [stage, patient, stats.elapsedSec])

  // ---- Restart for new workout ----
  function onAnother() {
    setPostSummary(null)
    setChosenMachine(null)
    setStage('ready')
  }

  // ---- Derived ----
  const zone = useMemo(() => {
    if (!patient) return 'none' as const
    return classifyZone(liveHr, patient.hr_lower, patient.hr_upper) || 'none'
  }, [liveHr, patient])
  // Stats are snapshotted into useState by the 1Hz tick.
  const elapsedSec = stats.elapsedSec
  const avg = stats.avg
  const max = stats.max

  if (supportError) {
    return (
      <div className="rounded-xl bg-red-100 px-4 py-3 text-sm text-red-700">{supportError}</div>
    )
  }

  return (
    <div>
      <style>{`
        @keyframes hrPillBlink {
          0%, 49% { background-color: rgb(254 226 226); color: rgb(153 27 27); }
          50%, 100% { background-color: white; color: rgb(239 68 68); }
        }
        .hr-pill-blink { animation: hrPillBlink 1s infinite; }
      `}</style>

      {stage === 'pair' && (
        <div className="py-8 text-center">
          <h1 className="text-2xl font-bold text-slate-800">Heart-rate workout</h1>
          <p className="mt-1 text-sm text-slate-500">Connect your Polar H10 strap to begin.</p>
          <button
            onClick={onPair}
            disabled={pairing}
            className="mt-6 rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            🔗 Pair HR strap
          </button>
          {pairStatus && <div className="mt-3 text-xs text-slate-500">{pairStatus}</div>}
        </div>
      )}

      {stage === 'unmapped' && unmappedDeviceName && (
        <div className="rounded-xl bg-amber-50 p-5 text-amber-900 ring-1 ring-amber-200">
          <h2 className="text-lg font-semibold">Strap not registered</h2>
          <p className="mt-1 text-sm">
            Please show this device name to your clinician — they will add you on their dashboard:
          </p>
          <div className="my-4 text-center">
            <code className="text-lg">{unmappedDeviceName}</code>
          </div>
          <p className="text-xs">Once you&apos;re added, refresh this page or pair again.</p>
        </div>
      )}

      {(stage === 'ready' || stage === 'workout' || stage === 'post') && patient && (
        <>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs text-slate-500">Hello,</div>
                <div className="text-2xl font-bold text-slate-800">{patient.name}</div>
                <div className="text-xs text-slate-500">
                  Strap: <code className="rounded bg-slate-100 px-1">{patient.device_name}</code>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">Target zone</div>
                <div className="font-semibold text-slate-800">
                  {patient.hr_lower}–{patient.hr_upper} bpm
                </div>
              </div>
            </div>
          </div>

          {stage === 'ready' && (
            <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
              <h3 className="mb-2 font-semibold text-slate-800">Choose machine</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {HR_MACHINES.map(([code, label]) => (
                  <button
                    key={code}
                    onClick={() => setChosenMachine(code)}
                    className={`rounded-lg border px-2 py-3 text-sm font-semibold ${
                      chosenMachine === code
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={onStart}
                disabled={!chosenMachine}
                className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                Start workout
              </button>
              {startMsg && <div className="mt-2 text-xs text-slate-500">{startMsg}</div>}
            </div>
          )}

          {stage === 'workout' && (
            <div className="mt-3 space-y-3">
              {reconnectCountdown != null && (
                <div className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                    <div>
                      <strong>Strap disconnected</strong> — trying to reconnect…
                      <div className="mt-0.5 text-xs">
                        Workout continues · ending in {reconnectCountdown}s if strap is not found.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-white p-4 text-center shadow-sm">
                <div className="text-xs text-slate-500">{machineLabel(chosenMachine)}</div>
                <div className="mt-1 text-[5rem] font-extrabold leading-none tracking-tight text-slate-800">
                  {liveHr != null ? liveHr : '--'}
                </div>
                <div className="text-xs text-slate-500">bpm</div>
                <div className="mt-2">
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${ZONE_PILL[zone].cls}`}
                  >
                    {ZONE_PILL[zone].text}
                  </span>
                </div>
                {connStatus && <div className="mt-2 text-xs text-slate-500">{connStatus}</div>}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Elapsed', value: fmtClock(elapsedSec) },
                  { label: 'Avg HR', value: avg ?? '—' },
                  { label: 'Max HR', value: max ?? '—' },
                ].map((t) => (
                  <div key={t.label} className="rounded-xl bg-slate-100 p-3 text-center">
                    <div className="text-xs text-slate-500">{t.label}</div>
                    <div className="mt-0.5 text-lg font-bold text-slate-800">{t.value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-white p-4 shadow-sm">
                <div className="mb-1 text-xs text-slate-500">HR trend</div>
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={180}
                  className="h-[180px] w-full rounded-lg bg-slate-50"
                />
              </div>

              <button
                onClick={() => endWorkout(false)}
                className="w-full rounded-lg bg-red-600 px-4 py-3 text-base font-semibold text-white hover:bg-red-700"
              >
                End workout
              </button>
              <div className="text-center text-xs text-slate-500">
                Session auto-ends after {HR_SESSION_MAX_HOURS} hours.
              </div>
            </div>
          )}

          {stage === 'post' && postSummary && (
            <div className="mt-3 rounded-xl bg-white p-5 text-center shadow-sm">
              <h3 className="text-lg font-bold text-slate-800">
                {postSummary.aborted ? 'Workout ended' : 'Workout saved'}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {postSummary.aborted
                  ? 'Strap disconnected or session timed out — your data has been saved.'
                  : 'Great job. You can start another machine when you’re ready.'}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-slate-100 p-3">
                  <div className="text-xs text-slate-500">Duration</div>
                  <div className="text-base font-bold text-slate-800">
                    {fmtClock(postSummary.duration)}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-100 p-3">
                  <div className="text-xs text-slate-500">Avg HR</div>
                  <div className="text-base font-bold text-slate-800">
                    {postSummary.avg ?? '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-100 p-3">
                  <div className="text-xs text-slate-500">Max HR</div>
                  <div className="text-base font-bold text-slate-800">
                    {postSummary.max ?? '—'}
                  </div>
                </div>
              </div>
              <button
                onClick={onAnother}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Start another workout
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
