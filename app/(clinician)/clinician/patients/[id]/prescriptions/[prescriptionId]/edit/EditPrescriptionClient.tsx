'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { updatePrescriptionAction } from '@/app/actions/prescriptions'

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

interface Item {
  key: string
  exerciseId: string
  exerciseName: string
  exerciseJoint: string
  exerciseSide: string
  defaultStartMin: number
  defaultStartMax: number
  defaultEndMin: number
  defaultEndMax: number
  numSets: number
  repsPerSet: number
  restSeconds: number
  showOverrides: boolean
  overrideStartMin: string
  overrideStartMax: string
  overrideEndMin: string
  overrideEndMax: string
}

export default function EditPrescriptionClient({
  patientId,
  prescription,
  initialItems,
  exercises,
  hasSessionHistory,
}: {
  patientId: string
  prescription: { id: string; scheduled_date: string; hr_upper_limit_bpm: number; status: string }
  initialItems: Item[]
  exercises: Exercise[]
  hasSessionHistory: boolean
}) {
  const [date, setDate] = useState(prescription.scheduled_date)
  const [hrLimit, setHrLimit] = useState(prescription.hr_upper_limit_bpm)
  const [items, setItems] = useState<Item[]>(initialItems)
  const [addExerciseId, setAddExerciseId] = useState(exercises[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function addItem() {
    if (!addExerciseId) return
    const ex = exercises.find((e) => e.id === addExerciseId)!
    setItems((prev) => [
      ...prev,
      {
        key: `${addExerciseId}-${Date.now()}`,
        exerciseId: ex.id,
        exerciseName: ex.name,
        exerciseJoint: ex.primary_joint,
        exerciseSide: ex.primary_side,
        defaultStartMin: ex.start_angle_min,
        defaultStartMax: ex.start_angle_max,
        defaultEndMin: ex.end_angle_min,
        defaultEndMax: ex.end_angle_max,
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

  function updateItem<K extends keyof Item>(key: string, field: K, value: Item[K]) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)))
  }

  function handleSave() {
    if (items.length === 0) {
      setError('Add at least one exercise.')
      return
    }
    setError(null)
    startTransition(async () => {
      const toNum = (v: string) => (v === '' ? null : parseFloat(v))
      const result = await updatePrescriptionAction({
        prescriptionId: prescription.id,
        patientId,
        scheduledDate: date,
        hrUpperLimitBpm: hrLimit,
        items: items.map((item) => ({
          exercise_id: item.exerciseId,
          num_sets: item.numSets,
          reps_per_set: item.repsPerSet,
          rest_seconds: item.restSeconds,
          override_start_angle_min: item.showOverrides ? toNum(item.overrideStartMin) : null,
          override_start_angle_max: item.showOverrides ? toNum(item.overrideStartMax) : null,
          override_end_angle_min: item.showOverrides ? toNum(item.overrideEndMin) : null,
          override_end_angle_max: item.showOverrides ? toNum(item.overrideEndMax) : null,
        })),
      })
      if (!result.ok) setError(result.error)
      // on success server action redirects
    })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link
          href={`/clinician/patients/${patientId}`}
          className="text-sm text-slate-400 hover:text-slate-600"
        >
          ← Patient
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">Edit Scheduled Routine</h1>
      </header>

      <main className="mx-auto max-w-2xl p-6 space-y-6">
        {hasSessionHistory && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This routine already has session history. Exercise items cannot be changed, but you
            can still update the date and HR limit.
          </div>
        )}

        {/* Date + HR */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Routine Details</h2>
          <div className="flex flex-wrap gap-6">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-700">Scheduled date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-700">HR upper limit</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={60}
                  max={220}
                  value={hrLimit}
                  onChange={(e) => setHrLimit(Number(e.target.value))}
                  className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-center text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-500">bpm</span>
              </div>
            </div>
          </div>
        </section>

        {/* Exercises */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Exercises</h2>

          {!hasSessionHistory && exercises.length > 0 && (
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
          )}

          {items.length === 0 && (
            <p className="text-sm text-slate-400">No exercises added yet.</p>
          )}

          <div className="space-y-3">
            {items.map((item, idx) => (
              <div
                key={item.key}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-800">{item.exerciseName}</p>
                    <p className="text-xs text-slate-400 capitalize">
                      {item.exerciseJoint} · {item.exerciseSide}
                    </p>
                  </div>
                  {!hasSessionHistory && (
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
                  )}
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

                {!hasSessionHistory && (
                  <>
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
                            Start zone (°) — default {item.defaultStartMin}–{item.defaultStartMax}
                          </p>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              placeholder={String(item.defaultStartMin)}
                              value={item.overrideStartMin}
                              onChange={(e) => updateItem(item.key, 'overrideStartMin', e.target.value)}
                              className="w-20 rounded border border-slate-300 px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <span className="text-slate-400">–</span>
                            <input
                              type="number"
                              placeholder={String(item.defaultStartMax)}
                              value={item.overrideStartMax}
                              onChange={(e) => updateItem(item.key, 'overrideStartMax', e.target.value)}
                              className="w-20 rounded border border-slate-300 px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-slate-500">
                            End zone (°) — default {item.defaultEndMin}–{item.defaultEndMax}
                          </p>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              placeholder={String(item.defaultEndMin)}
                              value={item.overrideEndMin}
                              onChange={(e) => updateItem(item.key, 'overrideEndMin', e.target.value)}
                              className="w-20 rounded border border-slate-300 px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <span className="text-slate-400">–</span>
                            <input
                              type="number"
                              placeholder={String(item.defaultEndMax)}
                              value={item.overrideEndMax}
                              onChange={(e) => updateItem(item.key, 'overrideEndMax', e.target.value)}
                              className="w-20 rounded border border-slate-300 px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </section>

        {error && (
          <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        )}

        <button
          type="button"
          disabled={pending || items.length === 0}
          onClick={handleSave}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save Changes'}
        </button>
      </main>
    </div>
  )
}
