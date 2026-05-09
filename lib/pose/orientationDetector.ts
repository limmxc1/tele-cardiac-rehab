import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { LM } from './landmarks'

export type ViewOrientation = 'front' | 'side'

// Front view: shoulders + hips spread horizontally (patient faces camera).
// Side view: shoulders + hips appear stacked in x (one in front of the other).
const FRONT_X_MIN = 0.10
const SIDE_X_MAX = 0.06

/**
 * Classify pose orientation from normalized landmarks. Returns null if the
 * needed shoulder/hip landmarks aren't visible enough to call it confidently.
 */
export function detectOrientation(landmarks: NormalizedLandmark[]): ViewOrientation | null {
  const ls = landmarks[LM.LEFT_SHOULDER]
  const rs = landmarks[LM.RIGHT_SHOULDER]
  const lh = landmarks[LM.LEFT_HIP]
  const rh = landmarks[LM.RIGHT_HIP]
  if (!ls || !rs || !lh || !rh) return null
  const minVis = Math.min(
    ls.visibility ?? 0,
    rs.visibility ?? 0,
    lh.visibility ?? 0,
    rh.visibility ?? 0,
  )
  if (minVis < 0.4) return null

  const shoulderDx = Math.abs(ls.x - rs.x)
  const hipDx = Math.abs(lh.x - rh.x)
  const widest = Math.max(shoulderDx, hipDx)
  const narrowest = Math.min(shoulderDx, hipDx)

  if (widest >= FRONT_X_MIN) return 'front'
  if (narrowest <= SIDE_X_MAX) return 'side'
  return null
}

/**
 * Hold-based orientation gate — patient must maintain the requested view for
 * `holdMs` continuous milliseconds. Returns 0..1 progress.
 */
export class OrientationGate {
  private holdStart: number | null = null

  constructor(private readonly required: ViewOrientation, private readonly holdMs = 1000) {}

  /** Returns progress 0..1; ===1 means satisfied. */
  feed(landmarks: NormalizedLandmark[], timestamp_ms: number): number {
    const detected = detectOrientation(landmarks)
    if (detected !== this.required) {
      this.holdStart = null
      return 0
    }
    if (this.holdStart === null) this.holdStart = timestamp_ms
    const elapsed = timestamp_ms - this.holdStart
    if (elapsed >= this.holdMs) return 1
    return elapsed / this.holdMs
  }

  reset(): void {
    this.holdStart = null
  }
}
