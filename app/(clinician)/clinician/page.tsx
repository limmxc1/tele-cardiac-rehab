import Link from 'next/link'
import { logoutAction } from '@/app/actions/auth'
import ClinicianDashboardClient from './ClinicianDashboardClient'

export default function ClinicianDashboardPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-800">Clinician Dashboard</h1>
        <form action={logoutAction}>
          <button type="submit" className="text-sm text-slate-400 hover:text-slate-600">
            Logout
          </button>
        </form>
      </header>

      <main className="p-6 space-y-6">
        <ClinicianDashboardClient />

        <nav className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/clinician/exercises"
            className="rounded-xl border border-slate-200 bg-white p-5 hover:border-blue-300 hover:shadow-sm"
          >
            <p className="font-semibold text-slate-800">Exercise Library</p>
            <p className="mt-1 text-sm text-slate-400">Create and manage exercises with demo-mode thresholds</p>
          </Link>
          <div className="rounded-xl border border-slate-200 bg-white p-5 opacity-40">
            <p className="font-semibold text-slate-800">Patients</p>
            <p className="mt-1 text-sm text-slate-400">Phase 3 — prescriptions coming soon</p>
          </div>
        </nav>
      </main>
    </div>
  )
}
