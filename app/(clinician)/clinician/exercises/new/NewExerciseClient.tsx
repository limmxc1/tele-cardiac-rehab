'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store/auth'
import {
  createExerciseAction,
  updateExerciseAction,
  type Joint,
  type Side,
  type TrackedJointSpec,
} from '@/app/actions/exercises'

const JOINTS: Joint[] = ['knee', 'hip', 'shoulder', 'elbow', 'ankle']
const SIDES: Side[] = ['left', 'right', 'both']

const SIDE_HINT: Record<Side, string> = {
  left: 'Left side only.',
  right: 'Right side only.',
  both: 'Records both sides; angle is averaged for playback.',
}

export interface InitialValues {
  name: string
  instructions: string
  trackedJoints: TrackedJointSpec[]
  existingGifUrl: string | null
}

function jointKey(spec: TrackedJointSpec): string {
  return `${spec.side}_${spec.joint}`
}

function jointLabel(spec: TrackedJointSpec): string {
  return `${spec.side} ${spec.joint}`
}

export default function NewExerciseClient({
  exerciseId,
  initial,
}: {
  exerciseId?: string
  initial?: InitialValues
}) {
  const mode = exerciseId ? 'edit' : 'create'
  const user = useAuthStore((s) => s.user)

  const [name, setName] = useState(initial?.name ?? '')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const [tracked, setTracked] = useState<TrackedJointSpec[]>(initial?.trackedJoints ?? [])
  const [gifFile, setGifFile] = useState<File | null>(null)
  const [existingGifUrl, setExistingGifUrl] = useState<string | null>(initial?.existingGifUrl ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trackedKeys = new Set(tracked.map(jointKey))

  function toggle(spec: TrackedJointSpec): void {
    const key = jointKey(spec)
    setTracked((cur) => {
      if (cur.some((t) => jointKey(t) === key)) {
        return cur.filter((t) => jointKey(t) !== key)
      }
      // Adding 'both' for a joint replaces any per-side rows for the same joint
      // (and vice versa). This keeps the trace unambiguous: one row per joint.
      const withoutClashes =
        spec.side === 'both'
          ? cur.filter((t) => !(t.joint === spec.joint && (t.side === 'left' || t.side === 'right')))
          : cur.filter((t) => !(t.joint === spec.joint && t.side === 'both'))
      return [...withoutClashes, spec]
    })
  }

  async function handleSave() {
    if (!name.trim()) {
      setError('Exercise name is required')
      return
    }
    if (tracked.length === 0) {
      setError('Pick at least one joint to track')
      return
    }
    setSaving(true)
    setError(null)

    try {
      let gifUrl: string | null = existingGifUrl

      if (gifFile) {
        const safeName = gifFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${Date.now()}_${safeName}`
        const { error: uploadErr } = await supabase.storage
          .from('reference-gifs')
          .upload(path, gifFile, { contentType: gifFile.type })

        if (uploadErr) {
          setError(`GIF upload failed: ${uploadErr.message}`)
          setSaving(false)
          return
        }
        const { data: { publicUrl } } = supabase.storage
          .from('reference-gifs')
          .getPublicUrl(path)
        gifUrl = publicUrl
        setExistingGifUrl(publicUrl)
      }

      // primary_joint / primary_side stay on the row for back-compat with old
      // playback bundles and list views; they always reflect the first tracked
      // joint here, and aren't used as exercise logic anymore.
      const head = tracked[0]
      const payload = {
        name: name.trim(),
        instructions_text: instructions.trim() || null,
        reference_gif_url: gifUrl,
        primary_joint: head.joint,
        primary_side: head.side,
        tracked_joints: tracked,
      }

      const result = mode === 'edit' && exerciseId
        ? await updateExerciseAction(exerciseId, payload)
        : await createExerciseAction({ ...payload, created_by: user?.id ?? null })

      if (result?.error) {
        setError(result.error)
        setSaving(false)
      }
    } catch {
      setError('Failed to save exercise')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/clinician/exercises" className="text-sm text-slate-400 hover:text-slate-600">
          ← Library
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">
          {mode === 'edit' ? 'Edit Exercise' : 'New Exercise'}
        </h1>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700">Exercise Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sit to Stand"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700">
            Instructions <span className="text-slate-400">(optional)</span>
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder="Step-by-step guidance for the patient…"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700">
            Reference GIF <span className="text-slate-400">(optional)</span>
          </label>
          <input
            type="file"
            accept="image/gif,image/*"
            onChange={(e) => setGifFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1 file:text-sm file:font-medium file:text-blue-700"
          />
          {gifFile ? (
            <p className="text-xs text-slate-400">Selected: {gifFile.name}</p>
          ) : existingGifUrl ? (
            <div className="mt-2 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={existingGifUrl} alt="Current reference" className="h-16 rounded-lg object-cover" />
              <div>
                <p className="text-xs text-slate-500">Current reference GIF</p>
                <button
                  type="button"
                  onClick={() => setExistingGifUrl(null)}
                  className="text-xs text-rose-500 hover:text-rose-700"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-slate-800">Joints to track</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Only these joints&apos; coordinates will be recorded during the patient&apos;s
              session and shown on playback. Pick one or more.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Joint</th>
                  {SIDES.map((side) => (
                    <th
                      key={side}
                      className="px-4 py-2 text-center font-medium capitalize"
                      title={SIDE_HINT[side]}
                    >
                      {side}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {JOINTS.map((joint) => (
                  <tr key={joint} className="border-t border-slate-100">
                    <td className="px-4 py-2 capitalize font-medium text-slate-700">{joint}</td>
                    {SIDES.map((side) => {
                      const spec: TrackedJointSpec = { joint, side }
                      const checked = trackedKeys.has(jointKey(spec))
                      return (
                        <td key={side} className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-blue-600"
                            checked={checked}
                            onChange={() => toggle(spec)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">
            Pick <em>Both</em> for symmetric movements (e.g. squats) — angles from each side are
            averaged into one playback trace. Pick <em>Left</em> + <em>Right</em> separately if
            you want side-by-side traces (e.g. to spot asymmetry).
          </p>

          {tracked.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tracked.map((t) => (
                <span
                  key={jointKey(t)}
                  className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 capitalize"
                >
                  {jointLabel(t)}
                </span>
              ))}
            </div>
          )}
        </section>

        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white disabled:opacity-50 hover:bg-blue-700 active:bg-blue-800"
        >
          {saving ? 'Saving…' : mode === 'edit' ? 'Save Changes' : 'Save Exercise'}
        </button>
      </main>
    </div>
  )
}
