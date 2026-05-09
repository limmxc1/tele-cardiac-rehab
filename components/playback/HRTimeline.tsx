'use client'

import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PlaybackHR } from '@/lib/playback/loader'

function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function findHrAt(hr: PlaybackHR[], tMs: number): number | null {
  if (hr.length === 0) return null
  // Binary search for the last sample whose tMs <= currentTMs.
  let lo = 0
  let hi = hr.length - 1
  if (tMs < hr[0].tMs) return null
  if (tMs >= hr[hi].tMs) return hr[hi].bpm
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (hr[mid].tMs <= tMs) lo = mid
    else hi = mid - 1
  }
  return hr[lo].bpm
}

interface Props {
  hr: PlaybackHR[]
  currentTMs: number
  durationMs: number
  hrUpperLimit: number
}

export default function HRTimeline({ hr, currentTMs, durationMs, hrUpperLimit }: Props) {
  const data = useMemo(() => hr.map((h) => ({ t: h.tMs, bpm: h.bpm })), [hr])

  const yMax = useMemo(() => {
    let max = hrUpperLimit + 20
    for (const h of hr) if (h.bpm > max) max = h.bpm + 10
    return Math.ceil(max / 10) * 10
  }, [hr, hrUpperLimit])

  const yMin = useMemo(() => {
    let min = 60
    for (const h of hr) if (h.bpm < min) min = h.bpm
    return Math.max(30, Math.floor((min - 5) / 10) * 10)
  }, [hr])

  const currentHr = useMemo(() => findHrAt(hr, currentTMs), [hr, currentTMs])
  const breached = currentHr !== null && hrUpperLimit > 0 && currentHr > hrUpperLimit

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-baseline justify-between px-3 pb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">HR @ {fmtMs(currentTMs)}</span>
          {currentHr === null ? (
            <span className="text-sm text-slate-400">—</span>
          ) : (
            <span
              className={`text-2xl font-semibold tabular-nums ${
                breached ? 'text-red-600' : 'text-slate-800'
              }`}
            >
              {currentHr}
              <span className="ml-1 text-sm font-normal text-slate-500">bpm</span>
            </span>
          )}
        </div>
        <span className="text-xs text-slate-400">{hr.length} samples</span>
      </div>
      <div className="flex-1 min-h-0">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-400">
            No HR data was recorded for this session.
            <br />
            Confirm the H10 was paired before starting.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={[0, durationMs]}
                tickFormatter={fmtMs}
                tick={{ fontSize: 11, fill: '#64748b' }}
                stroke="#cbd5e1"
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fontSize: 11, fill: '#64748b' }}
                stroke="#cbd5e1"
                width={36}
              />
              <Tooltip
                labelFormatter={(v) => fmtMs(Number(v))}
                formatter={(v) => [`${v} bpm`, 'HR']}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              {hrUpperLimit > 0 && (
                <ReferenceLine
                  y={hrUpperLimit}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  label={{
                    value: `Limit ${hrUpperLimit}`,
                    fill: '#ef4444',
                    fontSize: 11,
                    position: 'insideTopRight',
                  }}
                />
              )}
              <ReferenceLine x={currentTMs} stroke="#2563eb" strokeWidth={2} />
              <Line
                type="monotone"
                dataKey="bpm"
                stroke="#dc2626"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
