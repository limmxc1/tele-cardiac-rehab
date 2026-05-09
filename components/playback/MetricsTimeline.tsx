'use client'

import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { angleAt } from '@/lib/pose/angles'
import { JOINT_TRIPLETS } from '@/lib/pose/landmarks'
import type { PlaybackBundle, PlaybackPose, PlaybackSet } from '@/lib/playback/loader'

interface Props {
  bundle: PlaybackBundle
  currentTMs: number
  durationMs: number
}

type AnglePoint = { t: number; angle: number | null }
type RepPoint = { t: number; reps: number }

function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function pickActiveSet(sets: PlaybackSet[], tMs: number): PlaybackSet | null {
  if (sets.length === 0) return null
  let candidate: PlaybackSet | null = null
  for (const s of sets) {
    if (s.startedTMs <= tMs) candidate = s
    else break
  }
  return candidate ?? sets[0]
}

function angleFromTuple(
  lm: [number, number, number][],
  triplet: [number, number, number],
): number | null {
  const [ai, bi, ci] = triplet
  const a = lm[ai]
  const b = lm[bi]
  const c = lm[ci]
  if (!a || !b || !c) return null
  return angleAt({ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }, { x: c[0], y: c[1], z: c[2] })
}

function jointAngleAt(
  lm: [number, number, number][],
  joint: string,
  side: 'left' | 'right' | 'both',
): number | null {
  const triplets = JOINT_TRIPLETS[joint]
  if (!triplets) return null
  if (side === 'both') {
    const l = angleFromTuple(lm, triplets.left)
    const r = angleFromTuple(lm, triplets.right)
    if (l !== null && r !== null) return (l + r) / 2
    return l ?? r
  }
  return angleFromTuple(lm, triplets[side])
}

/**
 * For each pose frame, compute the joint angle using whichever set is active
 * at that timestamp. The output is a time-series the same length as the pose
 * frame array, ready for a line chart.
 *
 * Joints with bidirectional motion (e.g. shoulder flexion vs extension) read
 * out as a single positive angle from `angleAt`; the chart's y-axis adapts
 * to the actual data range so the trend remains visible regardless of which
 * direction the joint is moving.
 */
function buildAngleSeries(
  poses: PlaybackPose[],
  sets: PlaybackSet[],
  which: 'primary' | 'secondary',
): AnglePoint[] {
  if (sets.length === 0 || poses.length === 0) return []
  const out: AnglePoint[] = []
  let setI = 0
  for (const p of poses) {
    while (setI + 1 < sets.length && sets[setI + 1].startedTMs <= p.tMs) setI++
    const set = sets[setI]
    const joint = which === 'primary' ? set.primaryJoint : set.secondaryJoint
    const side = which === 'primary' ? set.primarySide : set.secondarySide
    if (!joint || !side) {
      out.push({ t: p.tMs, angle: null })
      continue
    }
    const angle = jointAngleAt(p.lm, joint, side)
    out.push({ t: p.tMs, angle })
  }
  return out
}

function buildRepCountSeries(
  reps: PlaybackBundle['reps'],
  durationMs: number,
): RepPoint[] {
  const out: RepPoint[] = [{ t: 0, reps: 0 }]
  let count = 0
  for (const r of reps) {
    out.push({ t: r.startedTMs, reps: count })
    count++
    out.push({ t: r.startedTMs, reps: count })
  }
  out.push({ t: durationMs, reps: count })
  return out
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
  for (const p of series) {
    if (p.angle === null) continue
    if (p.angle < min) min = p.angle
    if (p.angle > max) max = p.angle
  }
  if (min > max) return [0, 180]
  // Pad the range so the line isn't flush against the edges. Always keep a
  // minimum span so flat traces don't look like a noise floor.
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

export default function MetricsTimeline({ bundle, currentTMs, durationMs }: Props) {
  const hrData = useMemo(
    () => bundle.hr.map((h) => ({ t: h.tMs, bpm: h.bpm })),
    [bundle.hr],
  )

  const primaryAngles = useMemo(
    () => buildAngleSeries(bundle.poses, bundle.sets, 'primary'),
    [bundle.poses, bundle.sets],
  )

  const secondaryAngles = useMemo(
    () => buildAngleSeries(bundle.poses, bundle.sets, 'secondary'),
    [bundle.poses, bundle.sets],
  )

  const repSeries = useMemo(
    () => buildRepCountSeries(bundle.reps, durationMs),
    [bundle.reps, durationMs],
  )

  const activeSet = useMemo(
    () => pickActiveSet(bundle.sets, currentTMs),
    [bundle.sets, currentTMs],
  )

  const hrAt = useMemo(
    () => findValueAt(hrData, currentTMs, (h) => h.bpm),
    [hrData, currentTMs],
  )
  const primaryAngleAt = useMemo(
    () => findValueAt(primaryAngles, currentTMs, (p) => p.angle),
    [primaryAngles, currentTMs],
  )
  const secondaryAngleAt = useMemo(
    () => findValueAt(secondaryAngles, currentTMs, (p) => p.angle),
    [secondaryAngles, currentTMs],
  )
  const repsAt = useMemo(
    () => findValueAt(repSeries, currentTMs, (p) => p.reps) ?? 0,
    [repSeries, currentTMs],
  )

  const primaryDomain = useMemo(() => angleYDomain(primaryAngles), [primaryAngles])
  const secondaryDomain = useMemo(() => angleYDomain(secondaryAngles), [secondaryAngles])

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

  const repMax = bundle.reps.length || 1
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

      <ChartShell
        title={
          activeSet
            ? `Primary · ${activeSet.primaryJoint} (${activeSet.primarySide})`
            : 'Primary joint angle'
        }
        reading={primaryAngleAt === null ? null : `${Math.round(primaryAngleAt)}`}
        unit="°"
      >
        {primaryAngles.length === 0 ? (
          <EmptyChart message="No pose data was recorded." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={primaryAngles} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis {...xAxisProps} />
              <YAxis
                domain={primaryDomain}
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
              {activeSet && (
                <>
                  <ReferenceArea
                    y1={activeSet.startAngleMin}
                    y2={activeSet.startAngleMax}
                    fill="#3b82f6"
                    fillOpacity={0.08}
                  />
                  <ReferenceArea
                    y1={activeSet.endAngleMin}
                    y2={activeSet.endAngleMax}
                    fill="#ef4444"
                    fillOpacity={0.08}
                  />
                </>
              )}
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

      <ChartShell
        title={
          activeSet?.secondaryJoint
            ? `Secondary · ${activeSet.secondaryJoint} (${activeSet.secondarySide ?? 'both'})`
            : 'Secondary joint angle'
        }
        reading={secondaryAngleAt === null ? null : `${Math.round(secondaryAngleAt)}`}
        unit="°"
      >
        {secondaryAngles.length === 0 || !activeSet?.secondaryJoint ? (
          <EmptyChart message="No secondary joint configured for this segment." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={secondaryAngles} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis {...xAxisProps} />
              <YAxis
                domain={secondaryDomain}
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
                stroke="#7c3aed"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartShell>

      <ChartShell title="Reps" reading={`${repsAt}`} unit={`/ ${bundle.reps.length}`}>
        {bundle.reps.length === 0 ? (
          <EmptyChart message="No reps were recorded." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={repSeries} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis {...xAxisProps} />
              <YAxis
                domain={[0, repMax]}
                allowDecimals={false}
                tick={{ fontSize: 10, fill: '#64748b' }}
                stroke="#cbd5e1"
                width={32}
              />
              <Tooltip
                labelFormatter={(v) => fmtMs(Number(v))}
                formatter={(v) => [`${v}`, 'Reps']}
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
              />
              <ReferenceLine x={currentTMs} stroke="#2563eb" strokeWidth={2} />
              <Line
                type="stepAfter"
                dataKey="reps"
                stroke="#16a34a"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartShell>
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
