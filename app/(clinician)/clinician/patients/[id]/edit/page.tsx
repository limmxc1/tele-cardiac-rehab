'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updatePatientAction } from '@/app/actions/patients'

// We receive initial data via searchParams so we avoid an extra server fetch.
// The patient detail page passes them as query params when navigating here.
export default function EditPatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ name?: string; username?: string }>
}) {
  // Next.js 15: params/searchParams are Promises in server components but
  // in client components they are already resolved objects — use React.use() or
  // just cast since this is a client component and they arrive as plain objects.
  const { id } = params as unknown as { id: string }
  const { name: initialName = '', username: initialUsername = '' } =
    searchParams as unknown as { name?: string; username?: string }

  const router = useRouter()
  const [displayName, setDisplayName] = useState(initialName)
  const [username, setUsername] = useState(initialUsername)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await updatePatientAction({ patientId: id, displayName, username })
      if (!result.ok) setError(result.error)
      // on success server action redirects
    })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link
          href={`/clinician/patients/${id}`}
          className="text-sm text-slate-400 hover:text-slate-600"
        >
          ← Patient
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">Edit Patient</h1>
      </header>

      <main className="mx-auto max-w-md p-6">
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6"
        >
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">
              Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
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

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
