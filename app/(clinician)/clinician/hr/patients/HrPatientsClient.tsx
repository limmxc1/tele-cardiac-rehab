'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { HR_FALL_RISK_LEVELS, HR_PRECAUTIONS } from '@/lib/hr/hrSupabase'
import type { Database } from '@/lib/supabase/types'

type HrPatientRow = Database['public']['Tables']['hr_patients']['Row']

type FormState = {
  id: string
  name: string
  device_name: string
  hr_lower: string
  hr_upper: string
  fall_risk: string
  precautions: string[]
  notes: string
}

const blankForm = (): FormState => ({
  id: '',
  name: '',
  device_name: '',
  hr_lower: '',
  hr_upper: '',
  fall_risk: 'low',
  precautions: [],
  notes: '',
})

function fallRiskBadgeClasses(risk: string): string {
  if (risk === 'high') return 'bg-red-100 text-red-700'
  if (risk === 'medium') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-600'
}

export default function HrPatientsClient() {
  const [patients, setPatients] = useState<HrPatientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState>(blankForm())
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('hr_patients')
      .select('*')
      .order('name', { ascending: true })
    if (error) {
      setFormMsg({ kind: 'err', text: error.message })
      setPatients([])
    } else {
      setPatients(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return patients
    return patients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.device_name || '').toLowerCase().includes(q),
    )
  }, [patients, search])

  function startEdit(p: HrPatientRow) {
    setForm({
      id: p.id,
      name: p.name,
      device_name: p.device_name,
      hr_lower: String(p.hr_lower),
      hr_upper: String(p.hr_upper),
      fall_risk: p.fall_risk,
      precautions: Array.isArray(p.precautions) ? (p.precautions as string[]) : [],
      notes: p.notes || '',
    })
    setFormMsg(null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setForm(blankForm())
    setFormMsg(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const lower = parseInt(form.hr_lower, 10)
    const upper = parseInt(form.hr_upper, 10)
    if (!(lower >= 30 && upper <= 220 && lower < upper)) {
      setFormMsg({ kind: 'err', text: 'HR range must satisfy 30 ≤ lower < upper ≤ 220.' })
      return
    }
    if (!form.name.trim() || !form.device_name.trim()) {
      setFormMsg({ kind: 'err', text: 'Name and device name are required.' })
      return
    }
    setSaving(true)
    setFormMsg({ kind: 'ok', text: 'Saving…' })
    const payload = {
      name: form.name.trim(),
      device_name: form.device_name.trim(),
      hr_lower: lower,
      hr_upper: upper,
      fall_risk: form.fall_risk,
      precautions: form.precautions,
      notes: form.notes.trim() || null,
    }
    const res = form.id
      ? await supabase.from('hr_patients').update(payload).eq('id', form.id)
      : await supabase.from('hr_patients').insert(payload)
    setSaving(false)
    if (res.error) {
      setFormMsg({ kind: 'err', text: res.error.message })
      return
    }
    setFormMsg({ kind: 'ok', text: 'Saved.' })
    resetForm()
    await load()
  }

  async function deletePatient(p: HrPatientRow) {
    if (!confirm(`Delete "${p.name}" and all their workouts?`)) return
    const { error } = await supabase.from('hr_patients').delete().eq('id', p.id)
    if (error) {
      alert(error.message)
      return
    }
    await load()
  }

  function togglePrecaution(value: string) {
    setForm((f) =>
      f.precautions.includes(value)
        ? { ...f, precautions: f.precautions.filter((p) => p !== value) }
        : { ...f, precautions: [...f.precautions, value] },
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-slate-800">
            {form.id ? `Edit: ${form.name || 'patient'}` : 'Add patient'}
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            On first pairing the patient&apos;s app shows the device name (e.g.{' '}
            <code className="rounded bg-slate-100 px-1">Polar H10 8B3A2C1F</code>). Enter that
            here exactly.
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={60}
                placeholder="e.g. John Tan"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Polar H10 device name
              </label>
              <input
                value={form.device_name}
                onChange={(e) => setForm({ ...form, device_name: e.target.value })}
                maxLength={80}
                placeholder="e.g. Polar H10 8B3A2C1F"
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Must match exactly what the patient&apos;s phone shows on first pairing.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">HR lower (bpm)</label>
                <input
                  type="number"
                  value={form.hr_lower}
                  onChange={(e) => setForm({ ...form, hr_lower: e.target.value })}
                  min={30}
                  max={220}
                  placeholder="95"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">HR upper (bpm)</label>
                <input
                  type="number"
                  value={form.hr_upper}
                  onChange={(e) => setForm({ ...form, hr_upper: e.target.value })}
                  min={30}
                  max={220}
                  placeholder="130"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Fall risk</label>
              <select
                value={form.fall_risk}
                onChange={(e) => setForm({ ...form, fall_risk: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              >
                {HR_FALL_RISK_LEVELS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Precautions</label>
              <div className="space-y-1">
                {HR_PRECAUTIONS.map(([v, label]) => (
                  <label key={v} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.precautions.includes(v)}
                      onChange={() => togglePrecaution(v)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                maxLength={300}
                placeholder="Any extra context for clinicians."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {form.id ? 'Save changes' : 'Save patient'}
              </button>
              {form.id && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel edit
                </button>
              )}
              {formMsg && (
                <span
                  className={
                    formMsg.kind === 'err'
                      ? 'text-sm text-red-600'
                      : 'text-sm text-emerald-600'
                  }
                >
                  {formMsg.text}
                </span>
              )}
            </div>
          </form>
        </div>

        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <strong>Tip:</strong> Need the device name? Open the{' '}
          <a href="/hr" className="underline">
            patient page
          </a>{' '}
          on the patient&apos;s phone, tap &quot;Pair HR strap,&quot; and the device name will
          appear on screen.
        </div>
      </div>

      <div className="lg:col-span-7">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-800">Existing patients</h2>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or device…"
              className="max-w-[220px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
            />
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-500">No patients yet.</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-800">{p.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        <code className="rounded bg-slate-100 px-1">{p.device_name}</code>
                        {' · '}HR {p.hr_lower}–{p.hr_upper}
                        {' · fall risk: '}
                        <span
                          className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${fallRiskBadgeClasses(p.fall_risk)}`}
                        >
                          {p.fall_risk}
                        </span>
                      </div>
                      {Array.isArray(p.precautions) && (p.precautions as string[]).length > 0 && (
                        <div className="mt-1 text-xs text-slate-500">
                          {(p.precautions as string[]).join(' · ')}
                        </div>
                      )}
                      {p.notes && (
                        <div className="mt-1 text-xs italic text-slate-400">{p.notes}</div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(p)}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deletePatient(p)}
                        className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
