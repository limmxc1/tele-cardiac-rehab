import { JOINT_TRIPLETS } from './landmarks'

interface Vec3 { x: number; y: number; z: number }

// Joint angle at landmark b, measured between vectors ba and bc
export function angleAt(a: Vec3, b: Vec3, c: Vec3): number {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
  const cb = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z }
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z
  const mag = Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z)
  if (mag === 0) return 0
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI)
}

// Returns angle in degrees for the given joint+side from a MediaPipe landmarks array.
// Returns null if required landmarks are missing.
export function getJointAngle(
  landmarks: Vec3[],
  joint: string,
  side: 'left' | 'right' | 'both'
): number | null {
  const triplets = JOINT_TRIPLETS[joint]
  if (!triplets) return null

  if (side === 'both') {
    const l = getSide(landmarks, triplets.left)
    const r = getSide(landmarks, triplets.right)
    if (l !== null && r !== null) return (l + r) / 2
    return l ?? r
  }

  return getSide(landmarks, triplets[side])
}

function getSide(landmarks: Vec3[], triplet: [number, number, number]): number | null {
  const [ai, bi, ci] = triplet
  const a = landmarks[ai]
  const b = landmarks[bi]
  const c = landmarks[ci]
  if (!a || !b || !c) return null
  return angleAt(a, b, c)
}
