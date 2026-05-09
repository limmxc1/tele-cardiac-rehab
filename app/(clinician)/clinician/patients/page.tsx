import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase/server'

export default async function PatientsPage() {
  const { data: patients } = await supabaseServer
    .from('users')
    .select('id, username, display_name')
    .eq('role', 'patient')
    .order('display_name')

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/clinician" className="text-sm text-slate-400 hover:text-slate-600">
          ← Dashboard
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">Patients</h1>
      </header>

      <main className="p-6">
        {!patients || patients.length === 0 ? (
          <div className="mt-16 text-center text-slate-400">
            <p className="text-lg">No patients found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Username</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"></th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{p.display_name}</td>
                    <td className="px-4 py-3 text-slate-500">{p.username}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/clinician/patients/${p.id}`}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
