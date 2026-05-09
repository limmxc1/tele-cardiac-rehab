import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'
import DeleteSessionButton from './DeleteSessionButton'
import PrescriptionHistoryTable from './PrescriptionHistoryTable'

type SessionRow = {
  id: string
  started_at: string
  completed_at: string | null
  status: string
  duration_label: string
  max_hr: number | null
  exercises: string
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '—'
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms <= 0) return '—'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

async function loadSessionHistory(patientId: string): Promise<SessionRow[]> {
  const { data: sessions } = await supabaseServer
    .from('sessions')
    .select('id, started_at, completed_at, status')
    .eq('patient_id', patientId)
    .order('started_at', { ascending: false })
    .limit(30)

  if (!sessions || sessions.length === 0) return []

  const sessionIds = sessions.map((s) => s.id)

  const [{ data: setRows }, { data: hrRows }] = await Promise.all([
    supabaseServer
      .from('session_sets')
      .select('session_id, exercises ( name )')
      .in('session_id', sessionIds),
    supabaseServer
      .from('session_hr_samples')
      .select('session_id, hr_bpm')
      .in('session_id', sessionIds),
  ])

  type SetRow = {
    session_id: string
    exercises: { name: string } | { name: string }[] | null
  }

  const exercisesBySession = new Map<string, Set<string>>()
  for (const r of (setRows ?? []) as SetRow[]) {
    const ex = Array.isArray(r.exercises) ? r.exercises[0] : r.exercises
    if (ex?.name) {
      const set = exercisesBySession.get(r.session_id) ?? new Set<string>()
      set.add(ex.name)
      exercisesBySession.set(r.session_id, set)
    }
  }

  const maxHrBySession = new Map<string, number>()
  for (const h of hrRows ?? []) {
    const cur = maxHrBySession.get(h.session_id) ?? 0
    if (h.hr_bpm > cur) maxHrBySession.set(h.session_id, h.hr_bpm)
  }

  return sessions.map((s) => ({
    id: s.id,
    started_at: s.started_at,
    completed_at: s.completed_at,
    status: s.status,
    duration_label: formatDuration(s.started_at, s.completed_at),
    max_hr: maxHrBySession.get(s.id) ?? null,
    exercises: Array.from(exercisesBySession.get(s.id) ?? []).join(', ') || '—',
  }))
}

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { data: patient } = await supabaseServer
    .from('users')
    .select('id, username, display_name')
    .eq('id', id)
    .eq('role', 'patient')
    .single()

  if (!patient) notFound()

  const [{ data: prescriptions }, sessions] = await Promise.all([
    supabaseServer
      .from('prescriptions')
      .select('id, scheduled_date, hr_upper_limit_bpm, status')
      .eq('patient_id', id)
      .order('scheduled_date', { ascending: false })
      .limit(30),
    loadSessionHistory(id),
  ])

  const statusColor: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    missed: 'bg-red-100 text-red-700',
    abandoned: 'bg-slate-100 text-slate-600',
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/clinician/patients" className="text-sm text-slate-400 hover:text-slate-600">
            ← Patients
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{patient.display_name}</h1>
            <p className="text-xs text-slate-400">{patient.username}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/clinician/patients/${id}/edit?name=${encodeURIComponent(patient.display_name)}&username=${encodeURIComponent(patient.username)}`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Edit Patient
          </Link>
          <Link
            href={`/clinician/prescribe/${id}`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            + Prescribe Routine
          </Link>
        </div>
      </header>

      <main className="p-6 space-y-6">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            Prescription History
          </h2>
          {!prescriptions || prescriptions.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400">
              <p>No prescriptions yet.</p>
              <p className="mt-1 text-sm">Prescribe a routine to get started.</p>
            </div>
          ) : (
            <PrescriptionHistoryTable prescriptions={prescriptions} patientId={id} />
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            Session History
          </h2>
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400">
              <p className="text-sm">No completed sessions yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Date</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Exercises</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">Duration</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">Max HR</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600"></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 text-slate-800">
                        {new Date(s.started_at).toLocaleString('en-SG', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{s.exercises}</td>
                      <td className="px-4 py-3 text-right text-slate-700 tabular-nums">{s.duration_label}</td>
                      <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                        {s.max_hr ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColor[s.status] ?? 'bg-slate-100 text-slate-600'}`}
                        >
                          {s.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/clinician/patients/${id}/sessions/${s.id}/playback`}
                            className="text-sm font-medium text-blue-600 hover:text-blue-800"
                          >
                            Review →
                          </Link>
                          <DeleteSessionButton sessionId={s.id} patientId={id} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
