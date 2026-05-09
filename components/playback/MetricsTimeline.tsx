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
import { angleAt } from '@/lib/pose/angles'
import { JOINT_TRIPLETS } from '@/lib/pose/landmarks'
import type { TrackedJointSpec } from '@/app/actions/exercises'
import type { PlaybackBundle, PlaybackPose, SparseLandmarks } from '@/lib/playback/loader'

interface Props {
  bundle: PlaybackBundle
  currentTMs: number
  durationMs: number
}

type AnglePoint = { t: number; angle: number | null }

function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function angleFromTriplet(
  lm: SparseLandmarks,
  triplet: [number, number, number],
): number | null {
  const a = lm[triplet[0]]
  const b = lm[triplet[1]]
  const c = lm[triplet[2]]
  if (!a || !b || !c) return null
  return angleAt(
    { x: a[0], y: a[1], z: a[2] },
    { x: b[0], y: b[1], z: b[2] },
    { x: c[0], y: c[1], z: c[2] },
  )
}

function buildAngleSeries(
  poses: PlaybackPose[],
  joint: TrackedJointSpec,
): AnglePoint[] {
  const trips = JOINT_TRIPLETS[joint.joint]
  if (!trips) return []
  if (joint.side === 'both') {
    // Average the two sides; if only one side is visible, use that one. The
    // recorder writes both triplets when 'both' is configured, so most frames
    // will have both available.
    return poses.map((p) => {
      const l = angleFromTriplet(p.lm, trips.left)
      const r = angleFromTriplet(p.lm, trips.right)
      let angle: number | null
      if (l !== null && r !== null) angle = (l + r) / 2
      else angle = l ?? r
      return { t: p.tMs, angle }
    })
  }
  const triplet = trips[joint.side]
  return poses.map((p) => ({ t: p.tMs, angle: angleFromTriplet(p.lm, triplet) }))
}

function findValueAt<T extends { t: number }>(
  series: T[],
  tMs: number,
  pick: (s: T) => number | null,
): number | null {
  if (series.length === 0) return null
  let lo = 0
  let hi = series.length - 1
  if (tMs < series[0].t) return null
  if (tMs >= series[hi].t) return pick(series[hi])
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (series[mid].t <= tMs) lo = mid
    else hi = mid - 1
  }
  return pick(series[lo])
}

function angleYDomain(series: AnglePoint[]): [number, number] {
  let min = 180
  let max = 0
  let any = false
  for (const p of series) {
    if (p.angle === null) continue
    any = true
    if (p.angle < min) min = p.angle
    if (p.angle > max) max = p.angle
  }
  if (!any) return [0, 180]
  const span = Math.max(20, max - min)
  const cushion = Math.max(8, span * 0.15)
  const lo = Math.max(0, Math.floor((min - cushion) / 5) * 5)
  const hi = Math.min(180, Math.ceil((max + cushion) / 5) * 5)
  return [lo, hi]
}

interface ChartShellProps {
  title: string
  reading: string | null
  unit?: string
  highlight?: boolean
  children: React.ReactNode
}

function ChartShell({ title, reading, unit, highlight, children }: ChartShellProps) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-baseline justify-between px-3 pt-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </span>
        <span
          className={`text-lg font-semibold tabular-nums ${
            highlight ? 'text-rose-600' : 'text-slate-800'
          }`}
        >
          {reading ?? '—'}
          {reading !== null && unit !== undefined && (
            <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>
          )}
        </span>
      </div>
      <div className="h-32 w-full">{children}</div>
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-3 text-center text-xs text-slate-400">
      {message}
    </div>
  )
}

export default function MetricsTimeline({ bundle, currentTMs, durationMs }: Props) {
  const hrData = useMemo(
    () => bundle.hr.map((h) => ({ t: h.tMs, bpm: h.bpm })),
    [bundle.hr],
  )

  const hrMax = useMemo(() => {
    let max = bundle.hrUpperLimitBpm + 20
    for (const h of bundle.hr) if (h.bpm > max) max = h.bpm + 10
    return Math.ceil(max / 10) * 10
  }, [bundle.hr, bundle.hrUpperLimitBpm])
  const hrMin = useMemo(() => {
    let min = 60
    for (const h of bundle.hr) if (h.bpm < min) min = h.bpm
    return Math.max(30, Math.floor((min - 5) / 10) * 10)
  }, [bundle.hr])

  const hrAt = useMemo(
    () => findValueAt(hrData, currentTMs, (h) => h.bpm),
    [hrData, currentTMs],
  )
  const hrBreached =
    hrAt !== null && bundle.hrUpperLimitBpm > 0 && hrAt > bundle.hrUpperLimitBpm

  const xAxisProps = {
    dataKey: 't',
    type: 'number' as const,
    domain: [0, durationMs],
    tickFormatter: fmtMs,
    tick: { fontSize: 10, fill: '#64748b' },
    stroke: '#cbd5e1',
    height: 18,
  }

  const angleSeriesByJoint = useMemo(
    () =>
      bundle.trackedJoints.map((j) => ({
        joint: j,
        series: buildAngleSeries(bundle.poses, j),
      })),
    [bundle.trackedJoints, bundle.poses],
  )

  return (
    <div className="flex flex-col gap-3">
      <ChartShell
        title={`HR @ ${fmtMs(currentTMs)}`}
        reading={hrAt === null ? null : `${hrAt}`}
        unit="bpm"
        highlight={hrBreached}
      >
        {hrData.length === 0 ? (
          <EmptyChart message="No HR samples — confirm H10 was paired." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={hrData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis {...xAxisProps} />
              <YAxis
                domain={[hrMin, hrMax]}
                tick={{ fontSize: 10, fill: '#64748b' }}
                stroke="#cbd5e1"
                width={32}
              />
              <Tooltip
                labelFormatter={(v) => fmtMs(Number(v))}
                formatter={(v) => [`${v} bpm`, 'HR']}
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
              />
              {bundle.hrUpperLimitBpm > 0 && (
                <ReferenceLine
                  y={bundle.hrUpperLimitBpm}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
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
      </ChartShell>

      {angleSeriesByJoint.length === 0 && (
        <ChartShell title="Joint angles" reading={null}>
          <EmptyChart message="No joints were tracked for this exercise." />
        </ChartShell>
      )}

      {angleSeriesByJoint.map(({ joint, series }) => {
        const reading = findValueAt(series, currentTMs, (p) => p.angle)
        const domain = angleYDomain(series)
        const title = `${joint.side} ${joint.joint}`
        return (
          <ChartShell
            key={`${joint.side}_${joint.joint}`}
            title={title}
            reading={reading === null ? null : `${Math.round(reading)}`}
            unit="°"
          >
            {series.length === 0 ? (
              <EmptyChart message="No pose data was recorded for this joint." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis {...xAxisProps} />
                  <YAxis
                    domain={domain}
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    stroke="#cbd5e1"
                    width={32}
                  />
                  <Tooltip
                    labelFormatter={(v) => fmtMs(Number(v))}
                    formatter={(v) => {
                      const n = typeof v === 'number' ? v : null
                      return [n === null ? '—' : `${Math.round(n)}°`, 'Angle']
                    }}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  />
                  <ReferenceLine x={currentTMs} stroke="#2563eb" strokeWidth={2} />
                  <Line
                    type="monotone"
                    dataKey="angle"
                    stroke="#0f172a"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartShell>
        )
      })}
    </div>
  )
}
