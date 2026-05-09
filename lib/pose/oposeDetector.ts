import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { LM } from './landmarks'

const HOLD_MS = 1500
/** Wrists must be at least this fraction of frame height above shoulders. */
const ABOVE_SHOULDER = 0.05
/** Wrists must be at or above the nose (small slack). */
const ABOVE_NOSE_SLACK = 0.02
/** Hands "touching" — wrist-to-wrist distance below this fraction of the frame width. */
const HANDS_CLOSE = 0.12

/**
 * O-pose: arms raised overhead, hands meeting near the top of the head so the
 * arms form an "O" shape. Used as the deliberate start-of-set gesture so the
 * patient signals readiness instead of being auto-started by a countdown.
 */
export class OPoseDetector {
  private holdStartMs: number | null = null

  constructor(private readonly onDetected: () => void) {}

  feed(landmarks: NormalizedLandmark[], timestamp_ms: number): number {
    if (!this.isOPose(landmarks)) {
      this.holdStartMs = null
      return 0
    }
    if (this.holdStartMs === null) this.holdStartMs = timestamp_ms
    const elapsed = timestamp_ms - this.holdStartMs
    if (elapsed >= HOLD_MS) {
      this.holdStartMs = null
      this.onDetected()
      return 1
    }
    return elapsed / HOLD_MS
  }

  reset(): void { this.holdStartMs = null }

  private isOPose(lm: NormalizedLandmark[]): boolean {
    const ls = lm[LM.LEFT_SHOULDER]
    const rs = lm[LM.RIGHT_SHOULDER]
    const lw = lm[LM.LEFT_WRIST]
    const rw = lm[LM.RIGHT_WRIST]
    const nose = lm[LM.NOSE]
    if (!ls || !rs || !lw || !rw || !nose) return false

    // Both wrists must sit clearly above the shoulders (smaller y = higher in frame).
    if (ls.y - lw.y < ABOVE_SHOULDER) return false
    if (rs.y - rw.y < ABOVE_SHOULDER) return false

    // …and at or above the nose, so it really is "above the head".
    if (lw.y > nose.y + ABOVE_NOSE_SLACK) return false
    if (rw.y > nose.y + ABOVE_NOSE_SLACK) return false

    // Hands meet — wrist-to-wrist distance is small.
    const dx = lw.x - rw.x
    const dy = lw.y - rw.y
    const dist = Math.hypot(dx, dy)
    if (dist > HANDS_CLOSE) return false

    return true
  }
}
