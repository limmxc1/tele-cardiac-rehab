'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/lib/store/auth'
import { createPrescriptionAction } from '@/app/actions/prescriptions'

interface Exercise {
  id: string
  name: string
  primary_joint: string
  primary_side: string
  start_angle_min: number
  start_angle_max: number
  end_angle_min: number
  end_angle_max: number
}

interface Patient {
  id: string
  username: string
  display_name: string
}

interface PrescriptionItem {
  key: string
  exerciseId: string
  numSets: number
  repsPerSet: number
  restSeconds: number
  showOverrides: boolean
  overrideStartMin: string
  overrideStartMax: string
  overrideEndMin: string
  overrideEndMax: string
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DEFAULT_DAYS = new Set([1, 3, 5]) // Mon, Wed, Fri

function nextMondayStr(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? 1 : day === 1 ? 0 : 8 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function computeDates(startDateStr: string, selectedDays: Set<number>, numWeeks: number): string[] {
  if (selectedDays.size === 0 || numWeeks < 1) return []
  const dates: string[] = []
  const start = new Date(startDateStr + 'T00:00:00')
  for (let i = 0; i < numWeeks * 7; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    if (selectedDays.has(d.getDay())) {
      dates.push(d.toISOString().slice(0, 10))
    }
  }
  return dates
}

function weekLabel(dateStr: string, startStr: string): number {
  const diff = new Date(dateStr + 'T00:00:00').getTime() - new Date(startStr + 'T00:00:00').getTime()
  return Math.floor(diff / (7 * 24 * 3600 * 1000)) + 1
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export default function PrescribeClient({
  patient,
  exercises,
}: {
  patient: Patient
  exercises: Exercise[]
}) {
  const user = useAuthStore((s) => s.user)

  const [hrLimit, setHrLimit] = useState(120)
  const [startDateStr, setStartDateStr] = useState(nextMondayStr)
  const [selectedDays, setSelectedDays] = useState<Set<number>>(DEFAULT_DAYS)
  const [numWeeks, setNumWeeks] = useState(4)
  const [items, setItems] = useState<PrescriptionItem[]>([])
  const [addExerciseId, setAddExerciseId] = useState(exercises[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scheduledDates = useMemo(
    () => computeDates(startDateStr, selectedDays, numWeeks),
    [startDateStr, selectedDays, numWeeks]
  )

  // Group dates by week for preview
  const datesByWeek = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const d of scheduledDates) {
      const w = weekLabel(d, startDateStr)
      if (!map.has(w)) map.set(w, [])
      map.get(w)!.push(d)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b)
  }, [scheduledDates, startDateStr])

  function toggleDay(day: number) {
    setSelectedDays((prev) => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  function addItem() {
    if (!addExerciseId) return
    setItems((prev) => [
      ...prev,
      {
        key: `${addExerciseId}-${Date.now()}`,
        exerciseId: addExerciseId,
        numSets: 3,
        repsPerSet: 10,
        restSeconds: 30,
        showOverrides: false,
        overrideStartMin: '',
        overrideStartMax: '',
        overrideEndMin: '',
        overrideEndMax: '',
      },
    ])
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key))
  }

  function moveItem(key: string, dir: -1 | 1) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.key === key)
      if (idx < 0) return prev
      const next = [...prev]
      const swap = idx + dir
      if (swap < 0 || swap >= next.length) return prev
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return next
    })
  }

  function updateItem<K extends keyof PrescriptionItem>(key: string, field: K, value: PrescriptionItem[K]) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)))
  }

  async function handleSave() {
    if (scheduledDates.length === 0) {
      setError('Select at least one day and one week.')
      return
    }
    if (items.length === 0) {
      setError('Add at least one exercise.')
      return
    }
    if (!user) {
      setError('Not logged in.')
      return
    }

    setSaving(true)
    setError(null)

    const payload = {
      patient_id: patient.id,
      prescribed_by: user.id,
      hr_upper_limit_bpm: hrLimit,
      scheduled_dates: scheduledDates,
      items: items.map((item) => {
        const ex = exercises.find((e) => e.id === item.exerciseId)!
        const toNum = (v: string, fallback: number) => (v === '' ? null : parseFloat(v) ?? fallback)
        return {
          exercise_id: item.exerciseId,
          num_sets: item.numSets,
          reps_per_set: item.repsPerSet,
          rest_seconds: item.restSeconds,
          override_start_angle_min: item.showOverrides ? toNum(item.overrideStartMin, ex.start_angle_min) : null,
          override_start_angle_max: item.showOverrides ? toNum(item.overrideStartMax, ex.start_angle_max) : null,
          override_end_angle_min: item.showOverrides ? toNum(item.overrideEndMin, ex.end_angle_min) : null,
          override_end_angle_max: item.showOverrides ? toNum(item.overrideEndMax, ex.end_angle_max) : null,
        }
      }),
    }

    const result = await createPrescriptionAction(payload)
    if (result?.error) {
      setError(result.error)
      setSaving(false)
    }
    // On success, server action redirects — component unmounts
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link href={`/clinician/patients/${patient.id}`} className="text-sm text-slate-400 hover:text-slate-600">
          ← {patient.display_name}
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">Prescribe Routine</h1>
      </header>

      <main className="mx-auto max-w-3xl p-6 space-y-6">

        {/* HR limit */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="font-semibold text-slate-800">Heart Rate Limit</h2>
          <label className="flex items-center gap-3 text-sm text-slate-600">
            Upper HR limit
            <input
              type="number"
              min={60}
              max={220}
              value={hrLimit}
              onChange={(e) => setHrLimit(Number(e.target.value))}
              className="w-24 rounded-lg border border-slate-300 px-3 py-1.5 text-center text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span>bpm</span>
          </label>
        </section>

        {/* Schedule */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Schedule</h2>

          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">Start date</p>
            <input
              type="date"
              value={startDateStr}
              onChange={(e) => setStartDateStr(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">Days of week</p>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedDays.has(day)
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {DAY_LABELS[day]}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm text-slate-600">
            Number of weeks
            <input
              type="number"
              min={1}
              max={52}
              value={numWeeks}
              onChange={(e) => setNumWeeks(Math.max(1, Number(e.target.value)))}
              className="w-20 rounded-lg border border-slate-300 px-3 py-1.5 text-center text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-slate-400">({scheduledDates.length} sessions total)</span>
          </label>
        </section>

        {/* Exercises */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Exercises</h2>

          {exercises.length === 0 ? (
            <p className="text-sm text-slate-400">
              No exercises in library.{' '}
              <Link href="/clinician/exercises/new" className="text-blue-600 hover:underline">
                Create one first.
              </Link>
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <select
                  value={addExerciseId}
                  onChange={(e) => setAddExerciseId(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {exercises.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.name} ({ex.primary_joint}, {ex.primary_side})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addItem}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Add
                </button>
              </div>

              {items.length === 0 && (
                <p className="text-sm text-slate-400">No exercises added yet.</p>
              )}

              <div className="space-y-3">
                {items.map((item, idx) => {
                  const ex = exercises.find((e) => e.id === item.exerciseId)!
                  return (
                    <div
                      key={item.key}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-800">{ex.name}</p>
                          <p className="text-xs text-slate-400 capitalize">
                            {ex.primary_joint} · {ex.primary_side}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveItem(item.key, -1)}
                            className="rounded p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={idx === items.length - 1}
                            onClick={() => moveItem(item.key, 1)}
                            className="rounded p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeItem(item.key)}
                            className="rounded p-1 text-red-400 hover:text-red-600"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-4 text-sm">
                        <label className="flex items-center gap-2 text-slate-600">
                          Sets
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={item.numSets}
                            onChange={(e) => updateItem(item.key, 'numSets', Number(e.target.value))}
                            className="w-16 rounded border border-slate-300 px-2 py-1 text-center text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-slate-600">
                          Reps
                          <input
                            type="number"
                            min={1}
                            max={50}
                            value={item.repsPerSet}
                            onChange={(e) => updateItem(item.key, 'repsPerSet', Number(e.target.value))}
                            className="w-16 rounded border border-slate-300 px-2 py-1 text-center text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-slate-600">
                          Rest (s)
                          <input
                            type="number"
                            min={0}
                            max={300}
                            step={5}
                            value={item.restSeconds}
                            onChange={(e) => updateItem(item.key, 'restSeconds', Number(e.target.value))}
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-center text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        onClick={() => updateItem(item.key, 'showOverrides', !item.showOverrides)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {item.showOverrides ? '− Hide' : '+ Override'} angle thresholds for this patient
                      </button>

                      {item.showOverrides && (
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div className="space-y-1">
                            <p className="text-xs text-slate-500">
                              Start zone (°) — default {ex.start_angle_min}–{ex.start_angle_max}
                            </p>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                placeholder={String(ex.start_angle_min)}
                                value={item.overrideStartMin}
                                onChange={(e) => updateItem(item.key, 'overrideStartMin', e.target.value)}
                                className="w-20 rounded border border-slate-300 px-2 py-1 text-center text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <span className="text-slate-400">–</span>
                              <input
                                type="number"
                                placeholder={String(ex.start_angle_max)}
                                value={item.overrideStartMax}
                                onChange={(e) => updateItem(item.key, 'overrideStartMax', e.target.value)}
                                className="w-20 rounded border border-slate-300 px-2 py-1 text-center text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-slate-500">
                              End zone (°) — default {ex.end_angle_min}–{ex.end_angle_max}
                            </p>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                placeholder={String(ex.end_angle_min)}
                                value={item.overrideEndMin}
                                onChange={(e) => updateItem(item.key, 'overrideEndMin', e.target.value)}
                                className="w-20 rounded border border-slate-300 px-2 py-1 text-center text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <span className="text-slate-400">–</span>
                              <input
                                type="number"
                                placeholder={String(ex.end_angle_max)}
                                value={item.overrideEndMax}
                                onChange={(e) => updateItem(item.key, 'overrideEndMax', e.target.value)}
                                className="w-20 rounded border border-slate-300 px-2 py-1 text-center text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </section>

        {/* Calendar preview */}
        {scheduledDates.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="font-semibold text-slate-800">
              Preview — {scheduledDates.length} sessions
            </h2>
            <div className="space-y-2">
              {datesByWeek.map(([week, dates]) => (
                <div key={week} className="flex gap-3 text-sm">
                  <span className="w-14 shrink-0 font-medium text-slate-500">Wk {week}</span>
                  <div className="flex flex-wrap gap-2">
                    {dates.map((d) => (
                      <span
                        key={d}
                        className="rounded-full bg-blue-50 px-3 py-0.5 text-blue-700"
                      >
                        {formatDate(d)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Error + Save */}
        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <button
          type="button"
          disabled={saving || scheduledDates.length === 0 || items.length === 0}
          onClick={handleSave}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? 'Saving…' : `Save ${scheduledDates.length} Sessions for ${patient.display_name}`}
        </button>
      </main>
    </div>
  )
}
