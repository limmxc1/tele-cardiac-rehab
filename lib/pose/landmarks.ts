// MediaPipe Pose Landmarker — 33-point indices
export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const

// Triplet [proximal, joint, distal] for each joint × side
// Angle is measured at the middle landmark.
export const JOINT_TRIPLETS: Record<string, Record<'left' | 'right', [number, number, number]>> = {
  knee: {
    left:  [LM.LEFT_HIP,      LM.LEFT_KNEE,     LM.LEFT_ANKLE],
    right: [LM.RIGHT_HIP,     LM.RIGHT_KNEE,    LM.RIGHT_ANKLE],
  },
  hip: {
    left:  [LM.LEFT_SHOULDER, LM.LEFT_HIP,      LM.LEFT_KNEE],
    right: [LM.RIGHT_SHOULDER,LM.RIGHT_HIP,     LM.RIGHT_KNEE],
  },
  elbow: {
    left:  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW,    LM.LEFT_WRIST],
    right: [LM.RIGHT_SHOULDER,LM.RIGHT_ELBOW,   LM.RIGHT_WRIST],
  },
  shoulder: {
    left:  [LM.LEFT_HIP,      LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
    right: [LM.RIGHT_HIP,     LM.RIGHT_SHOULDER,LM.RIGHT_ELBOW],
  },
  ankle: {
    left:  [LM.LEFT_KNEE,     LM.LEFT_ANKLE,    LM.LEFT_FOOT_INDEX],
    right: [LM.RIGHT_KNEE,    LM.RIGHT_ANKLE,   LM.RIGHT_FOOT_INDEX],
  },
}

export interface TrackedJointLike {
  joint: string
  side: 'left' | 'right' | 'both'
}

/** Sides covered by a tracked-joint spec — `both` expands to `[left, right]`. */
export function expandSides(side: 'left' | 'right' | 'both'): ('left' | 'right')[] {
  return side === 'both' ? ['left', 'right'] : [side]
}

/** Union of every landmark index needed to score the given tracked joints. */
export function trackedLandmarkIndices(tracked: readonly TrackedJointLike[]): number[] {
  const set = new Set<number>()
  for (const t of tracked) {
    const sides = expandSides(t.side)
    const trips = JOINT_TRIPLETS[t.joint]
    if (!trips) continue
    for (const s of sides) {
      const triplet = trips[s]
      if (!triplet) continue
      for (const i of triplet) set.add(i)
    }
  }
  return Array.from(set).sort((a, b) => a - b)
}
