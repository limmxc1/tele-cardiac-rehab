'use client'

import { useMemo } from 'react'
import { JOINT_TRIPLETS } from '@/lib/pose/landmarks'
import { angleAt } from '@/lib/pose/angles'

interface Props {
  // Interpolated landmark frame at the current scrubber position.
  landmarks: [number, number, number][] | null
  primaryJoint: string
  primarySide: 'left' | 'right' | 'both'
  primaryStartMin: number
  primaryStartMax: number
  primaryEndMin: number
  primaryEndMax: number
  secondaryJoint: string | null
  secondarySide: 'left' | 'right' | 'both' | null
}

function tupleToVec(t: [number, number, number]) {
  return { x: t[0], y: t[1], z: t[2] }
}

function angleFromTuples(
  lm: [number, number, number][],
  triplet: [number, number, number],
): number | null {
  const [ai, bi, ci] = triplet
  const a = lm[ai]
  const b = lm[bi]
  const c = lm[ci]
  if (!a || !b || !c) return null
  return angleAt(tupleToVec(a), tupleToVec(b), tupleToVec(c))
}

function computeAngle(
  lm: [number, number, number][] | null,
  joint: string,
  side: 'left' | 'right' | 'both',
): number | null {
  if (!lm) return null
  const triplets = JOINT_TRIPLETS[joint]
  if (!triplets) return null
  if (side === 'both') {
    const l = angleFromTuples(lm, triplets.left)
    const r = angleFromTuples(lm, triplets.right)
    if (l !== null && r !== null) return (l + r) / 2
    return l ?? r
  }
  return angleFromTuples(lm, triplets[side])
}

function classify(
  angle: number | null,
  startMin: number,
  startMax: number,
  endMin: number,
  endMax: number,
): { label: string; color: string } {
  if (angle === null) return { label: '—', color: 'text-slate-400' }
  if (angle >= startMin && angle <= startMax) return { label: 'start zone', color: 'text-blue-600' }
  if (angle >= endMin && angle <= endMax) return { label: 'end zone', color: 'text-red-600' }
  return { label: 'in transit', color: 'text-slate-500' }
}

export default function JointAngleReadout({
  landmarks,
  primaryJoint,
  primarySide,
  primaryStartMin,
  primaryStartMax,
  primaryEndMin,
  primaryEndMax,
  secondaryJoint,
  secondarySide,
}: Props) {
  const primaryAngle = useMemo(
    () => computeAngle(landmarks, primaryJoint, primarySide),
    [landmarks, primaryJoint, primarySide],
  )
  const secondaryAngle = useMemo(
    () => computeAngle(landmarks, secondaryJoint ?? '', secondarySide ?? 'both'),
    [landmarks, secondaryJoint, secondarySide],
  )

  const primaryZone = classify(primaryAngle, primaryStartMin, primaryStartMax, primaryEndMin, primaryEndMax)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Joint angles
      </h3>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Primary · {primaryJoint} · {primarySide}
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-800">
            {primaryAngle === null ? '—' : `${Math.round(primaryAngle)}°`}
          </p>
          <p className={`text-xs ${primaryZone.color}`}>{primaryZone.label}</p>
          <p className="mt-1 text-[11px] text-slate-400">
            start {primaryStartMin}–{primaryStartMax}° · end {primaryEndMin}–{primaryEndMax}°
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            {secondaryJoint
              ? `Secondary · ${secondaryJoint} · ${secondarySide ?? 'both'}`
              : 'Secondary'}
          </p>
          {secondaryJoint ? (
            <>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-800">
                {secondaryAngle === null ? '—' : `${Math.round(secondaryAngle)}°`}
              </p>
              <p className="text-xs text-slate-500">co-constraint</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-400">Not configured</p>
          )}
        </div>
      </div>
    </div>
  )
}
