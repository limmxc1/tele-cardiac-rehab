'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { createPatientAction } from '@/app/actions/patients'

export default function NewPatientPage() {
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Auto-suggest username from display name
  function handleDisplayNameChange(value: string) {
    setDisplayName(value)
    const suggested = value
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_.-]/g, '')
    setUsername(suggested)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createPatientAction({ displayName, username })
      if (!result.ok) setError(result.error)
      // on success the server action redirects
    })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/clinician/patients" className="text-sm text-slate-400 hover:text-slate-600">
          ← Patients
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">New Patient</h1>
      </header>

      <main className="mx-auto max-w-md p-6">
        <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">
              Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => handleDisplayNameChange(e.target.value)}
              placeholder="e.g. Alice Tan"
              required
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">
              Username <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="e.g. alice_tan"
              required
              className="w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
            <p className="text-xs text-slate-400">
              Used to log in. Lowercase letters, numbers, _, . and - only.
            </p>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? 'Creating…' : 'Create Patient'}
          </button>
        </form>
      </main>
    </div>
  )
}
