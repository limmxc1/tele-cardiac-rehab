import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase/server'
import DeleteExerciseButton from './DeleteExerciseButton'

export default async function ExercisesPage() {
  const { data: exercises } = await supabaseServer
    .from('exercises')
    .select('id, name, primary_joint, primary_side, direction, view_orientation, created_at')
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/clinician" className="text-sm text-slate-400 hover:text-slate-600">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold text-slate-800">Exercise Library</h1>
        </div>
        <Link
          href="/clinician/exercises/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          + New Exercise
        </Link>
      </header>

      <main className="p-6">
        {!exercises || exercises.length === 0 ? (
          <div className="mt-16 text-center text-slate-400">
            <p className="text-lg">No exercises yet.</p>
            <p className="mt-1 text-sm">Create your first exercise to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Joint</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Side</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">View</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Direction</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Created</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600"></th>
                </tr>
              </thead>
              <tbody>
                {exercises.map((ex) => (
                  <tr key={ex.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{ex.name}</td>
                    <td className="px-4 py-3 capitalize text-slate-600">{ex.primary_joint}</td>
                    <td className="px-4 py-3 capitalize text-slate-600">{ex.primary_side}</td>
                    <td className="px-4 py-3 capitalize text-slate-600">
                      {ex.view_orientation === 'side' ? 'Side view' : 'Front view'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {ex.direction === 'flexion_first' ? 'Flex first' : 'Extend first'}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(ex.created_at).toLocaleDateString('en-SG')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DeleteExerciseButton id={ex.id} name={ex.name} />
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
