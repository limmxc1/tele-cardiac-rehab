'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { bulkDeletePrescriptionsAction } from '@/app/actions/prescriptions'
import DeletePrescriptionButton from './DeletePrescriptionButton'

type Prescription = {
  id: string
  scheduled_date: string
  hr_upper_limit_bpm: number
  status: string
}

const statusColor: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  missed: 'bg-red-100 text-red-700',
  abandoned: 'bg-slate-100 text-slate-600',
}

export default function PrescriptionHistoryTable({
  prescriptions,
  patientId,
}: {
  prescriptions: Prescription[]
  patientId: string
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const allIds = prescriptions.map((p) => p.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const someSelected = selected.size > 0

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds))
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleBulkDelete() {
    setError(null)
    startTransition(async () => {
      const result = await bulkDeletePrescriptionsAction({
        prescriptionIds: Array.from(selected),
        patientId,
      })
      if (!result.ok) {
        setError(result.error)
      } else {
        setSelected(new Set())
        setConfirming(false)
      }
    })
  }

  return (
    <div className="space-y-2">
      {someSelected && (
        <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-2">
          <span className="text-sm text-rose-700">
            {selected.size} routine{selected.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-rose-600">{error}</span>}
            {confirming ? (
              <>
                <button
                  onClick={handleBulkDelete}
                  disabled={pending}
                  className="rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {pending ? 'Deleting…' : `Confirm delete ${selected.size}`}
                </button>
                <button
                  onClick={() => { setConfirming(false); setError(null) }}
                  disabled={pending}
                  className="rounded-md px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700"
              >
                Delete selected
              </button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-slate-300"
                  aria-label="Select all"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Date</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">HR Limit</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600"></th>
            </tr>
          </thead>
          <tbody>
            {prescriptions.map((p) => (
              <tr
                key={p.id}
                className={`border-b border-slate-100 last:border-0 ${selected.has(p.id) ? 'bg-rose-50' : ''}`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleOne(p.id)}
                    className="rounded border-slate-300"
                    aria-label={`Select ${p.scheduled_date}`}
                  />
                </td>
                <td className="px-4 py-3 text-slate-800">
                  {new Date(p.scheduled_date + 'T00:00:00').toLocaleDateString('en-SG', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </td>
                <td className="px-4 py-3 text-slate-600">{p.hr_upper_limit_bpm} bpm</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColor[p.status] ?? 'bg-slate-100 text-slate-600'}`}
                  >
                    {p.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/clinician/patients/${patientId}/prescriptions/${p.id}/edit`}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                    >
                      Edit
                    </Link>
                    <DeletePrescriptionButton prescriptionId={p.id} patientId={patientId} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
