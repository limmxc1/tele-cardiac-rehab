import Link from 'next/link'
import HrDashboardClient from './HrDashboardClient'
import { HR_DASHBOARD_MAX_PATIENTS } from '@/lib/hr/hrSupabase'

export default function HrDashboardPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/clinician/hr" className="text-sm text-slate-400 hover:text-slate-600">
          ← HR Monitoring
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">Live Dashboard</h1>
        <span className="text-xs text-slate-400">Up to {HR_DASHBOARD_MAX_PATIENTS} patients</span>
      </header>
      <main className="p-6">
        <HrDashboardClient />
      </main>
    </div>
  )
}
