import Link from 'next/link'
import HrPatientHistoryClient from './HrPatientHistoryClient'

export default async function HrPatientHistoryPage({
  params,
}: {
  params: Promise<{ patientId: string }>
}) {
  const { patientId } = await params
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/clinician/hr/history" className="text-sm text-slate-400 hover:text-slate-600">
          ← History
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">Patient history</h1>
      </header>
      <main className="p-6">
        <HrPatientHistoryClient patientId={patientId} />
      </main>
    </div>
  )
}
