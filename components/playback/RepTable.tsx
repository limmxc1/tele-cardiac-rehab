'use client'

import type { PlaybackRep } from '@/lib/playback/loader'

function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface Props {
  reps: PlaybackRep[]
  currentTMs: number
  onSeek: (tMs: number) => void
}

export default function RepTable({ reps, currentTMs, onSeek }: Props) {
  if (reps.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        No reps recorded.
      </div>
    )
  }

  const activeIdx = (() => {
    let best = -1
    for (let i = 0; i < reps.length; i++) {
      if (reps[i].startedTMs <= currentTMs) best = i
      else break
    }
    return best
  })()

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-slate-600">Set</th>
            <th className="px-3 py-2 text-left font-medium text-slate-600">Exercise</th>
            <th className="px-3 py-2 text-right font-medium text-slate-600">Rep</th>
            <th className="px-3 py-2 text-right font-medium text-slate-600">Time</th>
            <th className="px-3 py-2 text-right font-medium text-slate-600">Peak°</th>
            <th className="px-3 py-2 text-right font-medium text-slate-600">ROM°</th>
            <th className="px-3 py-2 text-right font-medium text-slate-600">HR @ peak</th>
          </tr>
        </thead>
        <tbody>
          {reps.map((r, i) => {
            const isActive = i === activeIdx
            return (
              <tr
                key={r.id}
                onClick={() => onSeek(r.startedTMs)}
                className={`cursor-pointer border-b border-slate-100 last:border-0 ${
                  isActive ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <td className="px-3 py-2 text-slate-600">{r.setNumber}</td>
                <td className="px-3 py-2 text-slate-700">{r.exerciseName}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.repNumber}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {fmtMs(r.startedTMs)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {r.peakAngleDegrees != null ? r.peakAngleDegrees.toFixed(0) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {r.romAchievedDegrees != null ? r.romAchievedDegrees.toFixed(0) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {r.hrBpmAtPeak ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
