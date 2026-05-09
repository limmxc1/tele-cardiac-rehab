import Link from 'next/link'
import HrWorkoutDetailClient from './HrWorkoutDetailClient'

export default async function HrWorkoutDetailPage({
  params,
}: {
  params: Promise<{ workoutId: string }>
}) {
  const { workoutId } = await params
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/clinician/hr/history" className="text-sm text-slate-400 hover:text-slate-600">
          ← History
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">Workout detail</h1>
      </header>
      <main className="p-6">
        <HrWorkoutDetailClient workoutId={workoutId} />
      </main>
    </div>
  )
}
