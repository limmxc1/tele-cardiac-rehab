import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { LM } from './landmarks'
import { angleAt } from './angles'

const HOLD_MS = 1500
const Y_THRESHOLD = 0.12        // wrist within 12% of frame height of shoulder
const X_EXT_THRESHOLD = 0.12   // wrist at least 12% of frame width beyond shoulder
const ELBOW_STRAIGHT_MIN = 150 // degrees

export class TPoseDetector {
  private holdStartMs: number | null = null

  constructor(private readonly onDetected: () => void) {}

  // Returns progress 0..1; calls onDetected once per completed hold
  feed(landmarks: NormalizedLandmark[], timestamp_ms: number): number {
    if (!this.isTPose(landmarks)) {
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

  private isTPose(lm: NormalizedLandmark[]): boolean {
    const ls = lm[LM.LEFT_SHOULDER]
    const rs = lm[LM.RIGHT_SHOULDER]
    const lw = lm[LM.LEFT_WRIST]
    const rw = lm[LM.RIGHT_WRIST]
    const le = lm[LM.LEFT_ELBOW]
    const re = lm[LM.RIGHT_ELBOW]
    if (!ls || !rs || !lw || !rw || !le || !re) return false

    // Wrists at shoulder height (y: 0=top, 1=bottom)
    if (Math.abs(lw.y - ls.y) > Y_THRESHOLD) return false
    if (Math.abs(rw.y - rs.y) > Y_THRESHOLD) return false

    // Arms extended laterally (rear cam: left shoulder has smaller x)
    if (ls.x - lw.x < X_EXT_THRESHOLD) return false // left wrist not far enough left
    if (rw.x - rs.x < X_EXT_THRESHOLD) return false // right wrist not far enough right

    // Elbows straight
    if (angleAt(ls, le, lw) < ELBOW_STRAIGHT_MIN) return false
    if (angleAt(rs, re, rw) < ELBOW_STRAIGHT_MIN) return false

    return true
  }
}
