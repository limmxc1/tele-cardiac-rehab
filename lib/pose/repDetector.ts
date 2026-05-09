import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { getJointAngle } from './angles'

type RepState = 'AT_START' | 'TRAVELING_TO_END' | 'AT_END' | 'TRAVELING_TO_START'

export interface RepEvent {
  startedAt: number
  completedAt: number
  peakAngleDegrees: number
  romDegrees: number
  hrBpmAtPeak: number | null
}

export interface RepConfig {
  primaryJoint: string
  primarySide: 'left' | 'right' | 'both'
  startAngleMin: number
  startAngleMax: number
  endAngleMin: number
  endAngleMax: number
  direction: 'flexion_first' | 'extension_first'
  secondaryJoint?: string
  secondaryStartMin?: number
  secondaryStartMax?: number
  secondaryEndMin?: number
  secondaryEndMax?: number
}

export class RepDetector {
  private state: RepState = 'AT_START'
  private repStartTs = 0
  private peakAngle: number | null = null
  private peakHr: number | null = null

  constructor(
    private readonly config: RepConfig,
    private readonly onRep: (event: RepEvent) => void,
  ) {}

  feed(landmarks: NormalizedLandmark[], currentHr: number | null, timestamp_ms: number): void {
    const primary = getJointAngle(landmarks, this.config.primaryJoint, this.config.primarySide)
    if (primary === null) return

    // Optional secondary-joint co-constraint. Both joints must sit inside
    // their respective zones for the rep state machine to consider the body
    // as inStart / inEnd. All four secondary thresholds must be present.
    const hasSecondary =
      typeof this.config.secondaryJoint === 'string' &&
      typeof this.config.secondaryStartMin === 'number' &&
      typeof this.config.secondaryStartMax === 'number' &&
      typeof this.config.secondaryEndMin === 'number' &&
      typeof this.config.secondaryEndMax === 'number'
    let secondary: number | null = null
    if (hasSecondary) {
      secondary = getJointAngle(
        landmarks,
        this.config.secondaryJoint!,
        this.config.primarySide,
      )
      // Skip the frame on a half-measurement so we don't drift through the
      // SM with only the primary angle.
      if (secondary === null) return
    }

    const primaryInStart = primary >= this.config.startAngleMin && primary <= this.config.startAngleMax
    const primaryInEnd = primary >= this.config.endAngleMin && primary <= this.config.endAngleMax
    const secondaryInStart =
      !hasSecondary ||
      (secondary! >= this.config.secondaryStartMin! &&
        secondary! <= this.config.secondaryStartMax!)
    const secondaryInEnd =
      !hasSecondary ||
      (secondary! >= this.config.secondaryEndMin! &&
        secondary! <= this.config.secondaryEndMax!)
    const inStart = primaryInStart && secondaryInStart
    const inEnd = primaryInEnd && secondaryInEnd
    const extending = this.config.direction === 'extension_first'

    switch (this.state) {
      case 'AT_START':
        if (!inStart) {
          this.state = 'TRAVELING_TO_END'
          this.repStartTs = timestamp_ms
          this.peakAngle = primary
          this.peakHr = currentHr
        }
        break

      case 'TRAVELING_TO_END':
        // Recovery: patient bounced back to the start zone without reaching
        // end (range too narrow). Drop the attempt rather than wedging the
        // SM in TRAVELING_TO_END forever — without this, one missed peak
        // silently kills every subsequent rep.
        if (inStart) {
          this.state = 'AT_START'
          this.peakAngle = null
          this.peakHr = null
          break
        }
        if (
          this.peakAngle === null ||
          (extending ? primary > this.peakAngle : primary < this.peakAngle)
        ) {
          this.peakAngle = primary
          this.peakHr = currentHr
        }
        if (inEnd) this.state = 'AT_END'
        break

      case 'AT_END':
        if (!inEnd) this.state = 'TRAVELING_TO_START'
        break

      case 'TRAVELING_TO_START':
        // Symmetric recovery: bounced back into end without crossing start.
        // Treat as a partial pump so the SM stays healthy.
        if (inEnd) {
          this.state = 'AT_END'
          break
        }
        if (inStart) {
          const peak = this.peakAngle ?? primary
          this.onRep({
            startedAt: this.repStartTs,
            completedAt: timestamp_ms,
            peakAngleDegrees: peak,
            romDegrees: Math.abs(
              peak - (extending ? this.config.startAngleMin : this.config.startAngleMax),
            ),
            hrBpmAtPeak: this.peakHr,
          })
          this.state = 'AT_START'
          this.peakAngle = null
          this.peakHr = null
        }
        break
    }
  }

  reset(): void {
    this.state = 'AT_START'
    this.peakAngle = null
    this.peakHr = null
  }
}
