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

  return (
    <div className="h-full w-full">
      {data.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-slate-400">
          No HR data recorded.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
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
              domain={[40, yMax]}
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
                label={{ value: `Limit ${hrUpperLimit}`, fill: '#ef4444', fontSize: 11, position: 'insideTopRight' }}
              />
            )}
            <ReferenceLine x={currentTMs} stroke="#2563eb" strokeWidth={2} />
            <Line
              type="monotone"
              dataKey="bpm"
              stroke="#dc2626"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
