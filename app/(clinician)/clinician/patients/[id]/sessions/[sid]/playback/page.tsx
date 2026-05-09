import Link from 'next/link'
import { notFound } from 'next/navigation'
import PlaybackClient from '@/components/playback/PlaybackClient'
import { loadPlaybackBundle } from '@/lib/playback/loader'

export default async function SessionPlaybackPage({
  params,
}: {
  params: Promise<{ id: string; sid: string }>
}) {
  const { id, sid } = await params
  const bundle = await loadPlaybackBundle(sid)
  if (!bundle || bundle.patientId !== id) notFound()

  const startedAtFmt = new Date(bundle.startedAtIso).toLocaleString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <Link
            href={`/clinician/patients/${id}`}
            className="text-sm text-slate-400 hover:text-slate-600"
          >
            ← {bundle.patientName}
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Session playback</h1>
            <p className="text-xs text-slate-400">{startedAtFmt}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 capitalize">
            {bundle.status.replace('_', ' ')}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5">
            {bundle.poses.length} pose frames
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5">
            {bundle.hr.length} HR samples
          </span>
        </div>
      </header>

      <main className="p-6">
        <PlaybackClient bundle={bundle} />
      </main>
    </div>
  )
}
