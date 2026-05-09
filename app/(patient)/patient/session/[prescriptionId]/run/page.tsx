import Link from 'next/link'

export default async function SessionRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ prescriptionId: string }>
  searchParams: Promise<{ item?: string; set?: string }>
}) {
  const { prescriptionId } = await params
  const { item, set } = await searchParams

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Session Ready</h1>
        <p className="mt-2 text-slate-400 text-sm">
          Set {set ?? '?'} · Item {item?.slice(0, 8)}…
        </p>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 px-6 py-5 text-center max-w-xs w-full">
        <p className="text-slate-300 text-sm font-medium">Hardware integration</p>
        <p className="mt-1 text-slate-500 text-xs">
          Camera + Polar H10 session runtime coming in Phase 5.
        </p>
      </div>

      <Link
        href="/patient/calendar"
        className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        ← Back to calendar
      </Link>
    </div>
  )
}
