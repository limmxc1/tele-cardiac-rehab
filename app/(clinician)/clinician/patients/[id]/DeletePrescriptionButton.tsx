'use client'

import { useState, useTransition } from 'react'
import { deletePrescriptionAction } from '@/app/actions/prescriptions'

export default function DeletePrescriptionButton({
  prescriptionId,
  patientId,
}: {
  prescriptionId: string
  patientId: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
      >
        Delete
      </button>
    )
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await deletePrescriptionAction({ prescriptionId, patientId })
            if (!result.ok) setError(result.error)
            else setConfirming(false)
          })
        }}
        disabled={pending}
        className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Deleting…' : 'Confirm delete'}
      </button>
      <button
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-rose-500">{error}</span>}
    </div>
  )
}
