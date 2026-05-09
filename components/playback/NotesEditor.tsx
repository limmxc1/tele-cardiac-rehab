'use client'

import { useState, useTransition } from 'react'
import { saveClinicianNotes } from '@/app/actions/sessionNotes'

interface Props {
  sessionId: string
  patientId: string
  initial: string
}

export default function NotesEditor({ sessionId, patientId, initial }: Props) {
  const [value, setValue] = useState(initial)
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const dirty = value !== initial

  const onSave = () => {
    startTransition(async () => {
      const res = await saveClinicianNotes({ sessionId, patientId, notes: value })
      if (res.ok) {
        setStatus('saved')
        setErrorMsg(null)
        setTimeout(() => setStatus('idle'), 2500)
      } else {
        setStatus('error')
        setErrorMsg(res.error)
      }
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Clinician notes</h3>
        <div className="flex items-center gap-3 text-xs">
          {status === 'saved' && <span className="text-green-600">Saved</span>}
          {status === 'error' && <span className="text-red-600">{errorMsg ?? 'Save failed'}</span>}
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !dirty}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 hover:bg-blue-700"
          >
            {pending ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        placeholder="Observations, follow-ups, threshold tweaks for next prescription…"
        className="w-full resize-y rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white"
      />
    </div>
  )
}
