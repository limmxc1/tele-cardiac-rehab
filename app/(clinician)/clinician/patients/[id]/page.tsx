import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'

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

  const { data: prescriptions } = await supabaseServer
    .from('prescriptions')
    .select('id, scheduled_date, hr_upper_limit_bpm, status')
    .eq('patient_id', id)
    .order('scheduled_date', { ascending: false })
    .limit(30)

  const statusColor: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    missed: 'bg-red-100 text-red-700',
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
        <Link
          href={`/clinician/prescribe/${id}`}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          + Prescribe Routine
        </Link>
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
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Date</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">HR Limit</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {prescriptions.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0">
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wide">
            Session History
          </h2>
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400">
            <p className="text-sm">Session playback available in Phase 8.</p>
          </div>
        </section>
      </main>
    </div>
  )
}
