import { logoutAction } from '@/app/actions/auth'
import CalendarClient from './CalendarClient'

export default function PatientCalendarPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-800">My Rehab</h1>
        <form action={logoutAction}>
          <button type="submit" className="text-sm text-slate-400 hover:text-slate-600">
            Logout
          </button>
        </form>
      </header>
      <main className="p-4">
        <CalendarClient />
      </main>
    </div>
  )
}
