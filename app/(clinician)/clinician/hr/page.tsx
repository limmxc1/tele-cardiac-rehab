import Link from 'next/link'
import { HR_DASHBOARD_MAX_PATIENTS, HR_SESSION_MAX_HOURS } from '@/lib/hr/hrSupabase'

export default function HRMonitoringHomePage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/clinician" className="text-sm text-slate-400 hover:text-slate-600">
          ← Dashboard
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">HR Monitoring</h1>
      </header>

      <main className="p-6">
        <div className="mb-8 max-w-2xl">
          <p className="text-sm text-slate-500">
            Live Polar H10 streaming, multi-patient grid, and 7-day workout history. Patients pair
            their strap on a phone and the dashboard updates in real time.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/clinician/hr/dashboard"
            className="rounded-xl border border-slate-200 bg-white p-5 hover:border-blue-300 hover:shadow-sm"
          >
            <p className="font-semibold text-slate-800">Live Dashboard</p>
            <p className="mt-1 text-sm text-slate-500">
              Watch up to {HR_DASHBOARD_MAX_PATIENTS} patients in real time. Zones colour-coded;
              auto-stops at {HR_SESSION_MAX_HOURS}h.
            </p>
          </Link>

          <Link
            href="/clinician/hr/patients"
            className="rounded-xl border border-slate-200 bg-white p-5 hover:border-blue-300 hover:shadow-sm"
          >
            <p className="font-semibold text-slate-800">Patient Profiles</p>
            <p className="mt-1 text-sm text-slate-500">
              Map a patient name to their Polar H10 strap, set HR range, fall risk, and precautions.
            </p>
          </Link>

          <Link
            href="/clinician/hr/history"
            className="rounded-xl border border-slate-200 bg-white p-5 hover:border-blue-300 hover:shadow-sm"
          >
            <p className="font-semibold text-slate-800">History</p>
            <p className="mt-1 text-sm text-slate-500">
              Browse past workouts (last 7 days). Auto-deleted after that.
            </p>
          </Link>

          <Link
            href="/hr"
            className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-5 hover:border-emerald-400 hover:shadow-sm"
          >
            <p className="font-semibold text-slate-800">
              Patient page <span className="ml-1 rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-800">phone</span>
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Patient-facing entry: pair Polar H10 strap, start/stop workouts. Open this URL on the
              patient&apos;s Android Chrome.
            </p>
          </Link>
        </div>
      </main>
    </div>
  )
}
