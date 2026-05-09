import Link from 'next/link'
import HrHistoryClient from './HrHistoryClient'

export default function HrHistoryPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/clinician/hr" className="text-sm text-slate-400 hover:text-slate-600">
          ← HR Monitoring
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Workout history</h1>
          <p className="text-xs text-slate-400">Last 7 days, auto-deleted after that.</p>
        </div>
      </header>
      <main className="p-6">
        <HrHistoryClient />
      </main>
    </div>
  )
}
