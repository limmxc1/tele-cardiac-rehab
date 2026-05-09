import Link from 'next/link'
import HrPatientsClient from './HrPatientsClient'

export default function HrPatientsPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/clinician/hr" className="text-sm text-slate-400 hover:text-slate-600">
          ← HR Monitoring
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">Patient Profiles</h1>
      </header>

      <main className="p-6">
        <HrPatientsClient />
      </main>
    </div>
  )
}
